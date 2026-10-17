/* ---------- quality presets and resolution ---------- */
// cap: highest pixel ratio the 3D scene renders at; res: scene scale before auto-resolution
const QUALITY = {
  low: { cap: 1, res: 0.7, msaa: 0, shadow: 0, shadowEvery: 1, grass: 9000, bloom: false, fx: false },
  medium: { cap: 1.5, res: 0.8, msaa: 2, shadow: 1024, shadowEvery: 2, grass: 16000, bloom: true, fx: true },
  high: { cap: 2, res: 0.9, msaa: 4, shadow: 2048, shadowEvery: 1, grass: 30000, bloom: true, fx: true },
  ultra: { cap: 2, res: 1.0, msaa: 4, shadow: 4096, shadowEvery: 1, grass: 40000, bloom: true, fx: true },
};
const CANVAS_PR = Math.min(window.devicePixelRatio || 1, 2); // the HUD always draws at full sharpness
renderer.setPixelRatio(CANVAS_PR);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // used only when a scene renders straight to the screen
const perf = { ema: 1 / 60, dyn: 1, lastAdj: 0, fps: 60, shown: 0, scenePR: 1 };
const Q = () => QUALITY[settings.quality] || QUALITY.high;
const GPU = (() => { try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e) { return ''; } })();
const GPU_HIGH = /Adreno \(TM\) (7[3-9]\d|8\d\d)|Apple (M\d|GPU)|Immortalis|Mali-G7[1-9]\d|Mali-G9\d\d|Xclipse 9/i.test(GPU);
if (TOUCH && !userQuality && GPU_HIGH) settings.quality = 'high';

/* ---------- render targets ---------- */
const RT_OPTS = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
const HDR_OPTS = { ...RT_OPTS, type: HDR_TYPE };
const rtScene = new THREE.WebGLRenderTarget(4, 4, { ...HDR_OPTS, samples: 4 });
const rtThermal = [new THREE.WebGLRenderTarget(4, 4, RT_OPTS), new THREE.WebGLRenderTarget(4, 4, RT_OPTS)];
const rtDrone = new THREE.WebGLRenderTarget(640, 360, HDR_OPTS);
const rtMirror = new THREE.WebGLRenderTarget(720, 170, HDR_OPTS);
const BL = { depthBuffer: false, type: HDR_TYPE, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
const rtB = [new THREE.WebGLRenderTarget(4, 4, BL), new THREE.WebGLRenderTarget(4, 4, BL), new THREE.WebGLRenderTarget(4, 4, BL), new THREE.WebGLRenderTarget(4, 4, BL)];

const GLSL_COMMON = `
float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 teal(float l){ return vec3(0.05, 0.80, 0.76) * l + vec3(0.0, 0.03, 0.04); }
vec3 kRRTODT(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 kAces(vec3 c, float exposure){
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= exposure / 0.6; c = O * kRRTODT(I * c); return clamp(c, 0.0, 1.0);
}
`;
const FS_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `
uniform sampler2D tScene; uniform sampler2D tThermal; uniform sampler2D tBloom1; uniform sampler2D tBloom2; uniform sampler2D tRays; uniform sampler2D tAdapt; uniform sampler2D tDirt;
uniform int uMode; uniform float uTime; uniform float uNight; uniform float uGlasses; uniform float uExposure; uniform float uBloom; uniform float uSharp; uniform float uGain;
uniform float uRays; uniform vec3 uRayCol; uniform float uShimmer; uniform float uHorizon; uniform float uAdaptOn; uniform float uFx; uniform vec3 uGradeLo; uniform vec3 uGradeHi; uniform float uSat;
uniform vec2 uRes; uniform vec2 uTexel; uniform vec4 uRect;
varying vec2 vUv;
${GLSL_COMMON}
vec3 bloomAt(vec2 uv){ return (texture2D(tBloom1, uv).rgb * 0.55 + texture2D(tBloom2, uv).rgb * 0.75) * uBloom; }
// eye adaptation: fast average vs slow average scene luminance (r = fast, g = slow)
float adaptK(float p){ if (uAdaptOn < 0.5) return 1.0; vec2 a = texture2D(tAdapt, vec2(0.5)).rg; return clamp(pow(max(a.g, 1e-4) / max(a.r, 1e-4), p), 0.55, 1.9); }
// image-intensifier style gain with automatic brightness control; bright sources halo through the bloom chain
float amp(vec2 uv){ float l = luma(texture2D(tScene, uv).rgb + bloomAt(uv) * 1.6); return 1.0 - exp(-l * uGain * adaptK(0.6)); }
vec3 heatPal(float h){
  vec3 c = mix(vec3(0.02, 0.16, 0.38), vec3(0.08, 0.66, 0.82), smoothstep(0.05, 0.45, h));
  c = mix(c, vec3(1.0, 0.86, 0.22), smoothstep(0.52, 0.72, h));
  c = mix(c, vec3(1.0, 0.48, 0.12), smoothstep(0.74, 0.88, h));
  return mix(c, vec3(1.0, 0.96, 0.88), smoothstep(0.9, 1.0, h));
}
float therm(vec2 uv){
  // microbolometer: soft optics, slight halo around warm objects
  vec2 t = uTexel * 2.0;
  float c = texture2D(tThermal, uv).r * 0.4;
  c += (texture2D(tThermal, uv + vec2(t.x, 0.0)).r + texture2D(tThermal, uv - vec2(t.x, 0.0)).r + texture2D(tThermal, uv + vec2(0.0, t.y)).r + texture2D(tThermal, uv - vec2(0.0, t.y)).r) * 0.15;
  return c;
}
vec3 grade(vec3 c){
  float l = luma(c);
  c = mix(vec3(l), c, uSat);
  c *= mix(uGradeLo, uGradeHi, smoothstep(0.05, 0.75, l));   // split tone: cool shadows, warm highlights
  c = c * c * (3.0 - 2.0 * c) * 0.18 + c * 0.82;              // gentle S-curve
  return c;
}
void main(){
  vec2 uv = vUv;
  bool inside = uGlasses < 0.5 || (uv.x > uRect.x && uv.x < uRect.z && uv.y > uRect.y && uv.y < uRect.w);
  vec3 col;
  float n = hh(floor(uv * uRes) + fract(uTime * 7.31) * 91.7) - 0.5;
  vec2 d = uv - 0.5;
  if (!inside || uMode == 0) {
    // heat shimmer: a thin band of rising air just below the horizon
    vec2 su = uv;
    if (uShimmer > 0.0) {
      float band = smoothstep(uHorizon - 0.16, uHorizon - 0.01, uv.y) * (1.0 - smoothstep(uHorizon - 0.01, uHorizon + 0.015, uv.y));
      float w = sin(uv.y * 520.0 - uTime * 7.0 + sin(uv.x * 37.0 + uTime * 1.3) * 2.0) * 0.6 + sin(uv.y * 260.0 + uv.x * 70.0 - uTime * 4.1) * 0.4;
      su += vec2(w * 0.7, w) * uShimmer * band;
    }
    // slight chromatic aberration toward the edges of the visor
    float ca = uFx * dot(d, d) * 0.006;
    vec3 c = vec3(texture2D(tScene, su + d * ca).r, texture2D(tScene, su).g, texture2D(tScene, su - d * ca).b);
    if (uSharp > 0.0) {
      vec3 s = texture2D(tScene, su + vec2(uTexel.x, 0.0)).rgb + texture2D(tScene, su - vec2(uTexel.x, 0.0)).rgb + texture2D(tScene, su + vec2(0.0, uTexel.y)).rgb + texture2D(tScene, su - vec2(0.0, uTexel.y)).rgb;
      c = max(c + (c - s * 0.25) * uSharp, 0.0);
    }
    vec3 bl = bloomAt(uv);
    c += bl;
    c += texture2D(tRays, uv).rgb * uRays * uRayCol;
    col = grade(toSRGB(kAces(c, uExposure * adaptK(0.45))));
    // smudges on the visor light up when a bright source is in view
    col += texture2D(tDirt, uv).rgb * min(luma(bl) * 0.35 + luma(texture2D(tRays, uv).rgb) * uRays * 0.2, 0.7) * uFx;
    col *= 1.0 - dot(d, d) * 0.26;
    col += n * (0.010 + 0.02 * (1.0 - luma(col)) * uNight);
  } else {
    if (uMode == 1) {
      float l = pow(amp(uv), 0.85);
      l += n * (0.06 + 0.22 * uNight * (1.0 - l)); // scintillation is strongest in the dark areas
      col = teal(clamp(l, 0.0, 1.0));
      col += texture2D(tDirt, uv).rgb * luma(bloomAt(uv)) * 2.0 * uFx * vec3(0.3, 1.0, 0.95);
    } else if (uMode == 2) {
      float h = therm(uv) + n * 0.035;
      col = vec3(h);
    } else if (uMode == 3) {
      vec2 px = 1.5 / uRes;
      float tl = amp(uv + px * vec2(-1.0, 1.0)), tc = amp(uv + px * vec2(0.0, 1.0)), tr = amp(uv + px * vec2(1.0, 1.0));
      float ml = amp(uv + px * vec2(-1.0, 0.0)), mr = amp(uv + px * vec2(1.0, 0.0));
      float bl = amp(uv + px * vec2(-1.0, -1.0)), bc = amp(uv + px * vec2(0.0, -1.0)), br = amp(uv + px * vec2(1.0, -1.0));
      float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br, gy = tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
      float e = smoothstep(0.12, 0.55, length(vec2(gx, gy)));
      col = vec3(e) + n * 0.035;
    } else {
      float l = amp(uv), h = therm(uv);
      vec3 base = mix(vec3(0.01, 0.07, 0.12), vec3(0.12, 0.58, 0.76), l);
      float m = smoothstep(0.42, 0.72, h);
      col = mix(base, heatPal(h), m * 0.9) + n * 0.04;
    }
    col *= 1.0 - dot(d, d) * 0.55;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
const postMat = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null }, tThermal: { value: null }, tBloom1: { value: null }, tBloom2: { value: null }, tRays: { value: null }, tAdapt: { value: null }, tDirt: { value: null },
    uMode: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 }, uGlasses: { value: 0 },
    uExposure: { value: 1 }, uBloom: { value: 1 }, uSharp: { value: 0 }, uGain: { value: 3 }, uRays: { value: 0 }, uRayCol: { value: new THREE.Color(1, 0.8, 0.6) }, uShimmer: { value: 0 }, uHorizon: { value: 0.5 },
    uAdaptOn: { value: 0 }, uFx: { value: 1 }, uGradeLo: { value: new THREE.Vector3(1, 1, 1) }, uGradeHi: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1, 1) }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  },
  vertexShader: FS_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
});
const postScene = new THREE.Scene(); const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat); postQuad.frustumCulled = false; postScene.add(postQuad);
function fsPass(mat, target) { postQuad.material = mat; renderer.setRenderTarget(target); renderer.render(postScene, postCam); postQuad.material = postMat; }
// night-vision gain: an intensifier tube runs at very high gain under starlight and lower in daylight
const NV_GAIN = { golden: 4, noon: 2.5, night: 8 };

/* ---------- bloom: bright pass at 1/4, blur, second level at 1/8 ---------- */
const brightMat = new THREE.ShaderMaterial({
  uniforms: { tMap: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uThresh: { value: 1 } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tMap; uniform vec2 uTexel; uniform float uExposure; uniform float uThresh; varying vec2 vUv;
  void main(){
    vec3 c = (texture2D(tMap, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tMap, vUv + uTexel * vec2(1.0, -1.0)).rgb + texture2D(tMap, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tMap, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
    c = min(c, vec3(60.0));
    float l = max(max(c.r, c.g), c.b) * uExposure;
    float k = clamp(l - uThresh, 0.0, 4.0); k = k * k / (k + 0.5) / max(l, 1e-4);
    gl_FragColor = vec4(c * k, 1.0);
  }`,
});
const blurMat = new THREE.ShaderMaterial({
  uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
  void main(){
    vec3 c = texture2D(tMap, vUv).rgb * 0.227027;
    c += (texture2D(tMap, vUv + uDir * 1.384615).rgb + texture2D(tMap, vUv - uDir * 1.384615).rgb) * 0.316216;
    c += (texture2D(tMap, vUv + uDir * 3.230769).rgb + texture2D(tMap, vUv - uDir * 3.230769).rgb) * 0.070270;
    gl_FragColor = vec4(c, 1.0);
  }`,
});
const copyMat = new THREE.ShaderMaterial({ uniforms: { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv; void main(){ gl_FragColor = vec4((texture2D(tMap, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tMap, vUv + uTexel * vec2(1.0, -1.0)).rgb + texture2D(tMap, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tMap, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25, 1.0); }` });
function bloomPass(src, srcW, srcH, thresh, expo = exposure) {
  brightMat.uniforms.tMap.value = src; brightMat.uniforms.uTexel.value.set(1 / srcW, 1 / srcH); brightMat.uniforms.uExposure.value = expo; brightMat.uniforms.uThresh.value = thresh;
  fsPass(brightMat, rtB[0]);
  const blur = (a, b) => {
    blurMat.uniforms.tMap.value = a.texture; blurMat.uniforms.uDir.value.set(1 / a.width, 0); fsPass(blurMat, b);
    blurMat.uniforms.tMap.value = b.texture; blurMat.uniforms.uDir.value.set(0, 1 / b.height); fsPass(blurMat, a);
  };
  blur(rtB[0], rtB[1]);
  copyMat.uniforms.tMap.value = rtB[0].texture; copyMat.uniforms.uTexel.value.set(1 / rtB[0].width, 1 / rtB[0].height); fsPass(copyMat, rtB[2]);
  blur(rtB[2], rtB[3]); blur(rtB[2], rtB[3]);
}
const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blackTex.needsUpdate = true;

/* ---------- god rays: radial blur of the bright pass toward the sun (light shafts through trees and gaps) ---------- */
const raysMat = new THREE.ShaderMaterial({
  uniforms: { tMap: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tMap; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
  float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec2 dir = (uSun - vUv); float len = length(dir * vec2(uAspect, 1.0));
    vec2 st = dir / 36.0; vec2 p = vUv + st * hh(vUv * 913.0);
    vec3 acc = vec3(0.0); float w = 1.0;
    for (int i = 0; i < 36; i++) { acc += texture2D(tMap, p).rgb * w; w *= 0.955; p += st; }
    gl_FragColor = vec4(acc * (0.028 / (1.0 + len * 1.6)), 1.0);
  }`,
});
const _sunNdc = new THREE.Vector3(), _camDir = new THREE.Vector3();
function raysPass(cam) {
  // only by day, only when the sun is roughly ahead
  if (settings.night || !skyInfo[skyKey()]) return 0;
  cam.getWorldDirection(_camDir);
  const facing = _camDir.dot(sunDir);
  if (facing < 0.15) return 0;
  _sunNdc.copy(sunDir).multiplyScalar(500).add(cam.position).project(cam);
  raysMat.uniforms.uSun.value.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5);
  raysMat.uniforms.uAspect.value = rtB[0].width / rtB[0].height;
  raysMat.uniforms.tMap.value = rtB[0].texture;
  fsPass(raysMat, rtB[1]);
  return sstep(0.15, 0.75, facing);
}

/* ---------- eye adaptation: log-average luminance → 1x1 fast and slow averages ---------- */
const AD = { type: HDR_TYPE, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
const rtLum = new THREE.WebGLRenderTarget(16, 16, AD), rtAdapt = [new THREE.WebGLRenderTarget(1, 1, AD), new THREE.WebGLRenderTarget(1, 1, AD)];
let adaptIdx = 0, adaptInit = true;
const lumMat = new THREE.ShaderMaterial({ uniforms: { tMap: { value: null } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tMap; varying vec2 vUv; void main(){ vec3 c = texture2D(tMap, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(log(l + 1e-3), 0.0, 0.0, 1.0); }` });
const adaptMat = new THREE.ShaderMaterial({ uniforms: { tLum: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uInit: { value: 1 } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uDt; uniform float uInit; varying vec2 vUv;
  void main(){
    float s = 0.0; for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) s += texture2D(tLum, (vec2(float(x), float(y)) + 0.5) / 16.0).r;
    float cur = exp(s / 256.0);
    vec2 prev = texture2D(tPrev, vec2(0.5)).rg;
    if (uInit > 0.5) prev = vec2(cur);
    // brighter scenes adapt faster than darker ones, as eyes and cameras do
    float kf = 1.0 - exp(-uDt / (cur > prev.x ? 0.5 : 1.6)), ks = 1.0 - exp(-uDt / 40.0);
    gl_FragColor = vec4(prev.x + (cur - prev.x) * kf, prev.y + (cur - prev.y) * ks, 0.0, 1.0);
  }` });
function adaptPass(src, dt) {
  lumMat.uniforms.tMap.value = src; fsPass(lumMat, rtLum);
  const prev = rtAdapt[adaptIdx], next = rtAdapt[1 - adaptIdx];
  adaptMat.uniforms.tLum.value = rtLum.texture; adaptMat.uniforms.tPrev.value = prev.texture; adaptMat.uniforms.uDt.value = dt; adaptMat.uniforms.uInit.value = adaptInit ? 1 : 0;
  fsPass(adaptMat, next); adaptIdx = 1 - adaptIdx; adaptInit = false;
  return next.texture;
}

/* ---------- visor smudges and fine scratches (lit only by bright light) ---------- */
const dirtTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  const R = mulberry32(77);
  for (let i = 0; i < 70; i++) {
    const x = R() * 512, y = R() * 512, r = 8 + R() * 60, a = 0.03 + R() * 0.09;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,248,235,${a})`); gr.addColorStop(1, 'rgba(255,248,235,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 0.7;
  for (let i = 0; i < 40; i++) { const x = R() * 512, y = R() * 512, l = 10 + R() * 70, an = R() * 6.28; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(an) * l * 0.5 + R() * 6, y + Math.sin(an) * l * 0.5, x + Math.cos(an) * l, y + Math.sin(an) * l); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
})();

/* per-sky look: colour grade, shimmer and light-shaft colour */
const LOOK = {
  golden: { lo: [0.96, 0.99, 1.05], hi: [1.06, 1.0, 0.92], sat: 1.06, shimmer: 0.0007, rays: 1.0 },
  noon: { lo: [0.98, 1.0, 1.03], hi: [1.03, 1.01, 0.97], sat: 1.03, shimmer: 0.0014, rays: 0.6 },
  night: { lo: [0.94, 0.98, 1.08], hi: [1.04, 0.99, 0.94], sat: 0.92, shimmer: 0, rays: 0 },
};

/* ---------- screen-space video quads (drone feed, mirror) ---------- */
const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const screenScene = new THREE.Scene(); const screenCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
const droneQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
  uniforms: { tMap: { value: rtDrone.texture }, uTime: { value: 0 }, uAlpha: { value: 1 }, uIR: { value: 0 }, uExposure: { value: 1 } }, vertexShader: QUAD_VS, transparent: true, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tMap; uniform float uTime; uniform float uAlpha; uniform float uIR; uniform float uExposure; varying vec2 vUv; ${GLSL_COMMON}
  void main(){
    // compressed video link: 8x8 macroblocks partly visible, chroma coarser than luma
    vec2 res = vec2(640.0, 360.0), blk = (floor(vUv * res / 8.0) + 0.5) * 8.0 / res;
    float nz = hh(floor(vUv * res) + fract(uTime * 5.3) * 40.0) - 0.5;
    vec3 o;
    if (uIR > 0.5) {
      float h = mix(texture2D(tMap, vUv).r, texture2D(tMap, blk).r, 0.18) + nz * 0.05;
      o = vec3(h);
    } else {
      vec3 c = texture2D(tMap, vUv).rgb, cb = texture2D(tMap, blk).rgb;
      float l = luma(c); vec3 chroma = cb - luma(cb);
      c = mix(c, vec3(l) + chroma, 0.7);
      c = mix(c, cb, 0.12);
      o = toSRGB(kAces(c, uExposure * 1.1)) + nz * 0.03;
      o = mix(vec3(luma(o)), o, 0.85);
    }
    vec2 d = vUv - 0.5; o *= 1.0 - dot(d, d) * 0.7;
    gl_FragColor = vec4(o, uAlpha);
  }`,
}));
const mirrorQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
  uniforms: { tMap: { value: rtMirror.texture }, uNight: { value: 0 }, uAlpha: { value: 1 }, uExposure: { value: 1 }, uGain: { value: 900 } }, vertexShader: QUAD_VS, transparent: true, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tMap; uniform float uNight; uniform float uAlpha; uniform float uExposure; uniform float uGain; varying vec2 vUv; ${GLSL_COMMON}
  void main(){ vec3 c = texture2D(tMap, vec2(1.0 - vUv.x, vUv.y)).rgb; float l = 1.0 - exp(-luma(c) * uGain);
    vec3 o = uNight > 0.5 ? teal(l) : toSRGB(kAces(c, uExposure)); gl_FragColor = vec4(o, uAlpha); }`,
}));
for (const q of [droneQuad, mirrorQuad]) { q.matrixAutoUpdate = false; q.frustumCulled = false; screenScene.add(q); }
function setQuad(mesh, x, y, w, h, skew) { mesh.matrix.set(w, 0, 0, x + w / 2, skew, h, 0, y + h / 2 + skew / 2, 0, 0, 1, 0, 0, 0, 0, 1); mesh.matrixWorldNeedsUpdate = true; }

/* ---------- satellite image for the minimap (rendered once from above, under the noon sky) ---------- */
const sat = document.createElement('canvas'); sat.width = sat.height = 1024;
const tmMat = new THREE.ShaderMaterial({ uniforms: { tMap: { value: null }, uExposure: { value: 1 } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tMap; uniform float uExposure; varying vec2 vUv; ${GLSL_COMMON} void main(){ vec3 c = toSRGB(kAces(texture2D(tMap, vUv).rgb, uExposure)); gl_FragColor = vec4(clamp((c - 0.5) * 1.1 + 0.5, 0.0, 1.0), 1.0); }` });
function captureSatellite() {
  const hide = [D.g, ...MATES.map((m) => m.h.root), ...KITES.map((b) => b.k.g)]; hide.forEach((o) => (o.visible = false));
  const was = { night: settings.night, sun: settings.sun };
  settings.night = false; if (skyInfo.noon) settings.sun = 'noon'; applySky();
  const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 800);
  cam.position.set(0, 400, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const rtH = new THREE.WebGLRenderTarget(1024, 1024, { ...HDR_OPTS, samples: 4 }), rt8 = new THREE.WebGLRenderTarget(1024, 1024, RT_OPTS);
  const fog = scene.fog; scene.fog = null; grass.visible = false;
  if (renderer.shadowMap.enabled) { updateSunShadow(0, 0); renderer.shadowMap.needsUpdate = true; }
  renderer.setRenderTarget(rtH); renderer.render(scene, cam);
  tmMat.uniforms.tMap.value = rtH.texture; tmMat.uniforms.uExposure.value = exposure * 1.15; fsPass(tmMat, rt8);
  renderer.setRenderTarget(null);
  scene.fog = fog; grass.visible = true;
  const px = new Uint8Array(1024 * 1024 * 4); renderer.readRenderTargetPixels(rt8, 0, 0, 1024, 1024, px); rtH.dispose(); rt8.dispose();
  const g = sat.getContext('2d'), img = g.createImageData(1024, 1024);
  for (let y = 0; y < 1024; y++) img.data.set(px.subarray((1023 - y) * 4096, (1024 - y) * 4096), y * 4096);
  g.putImageData(img, 0, 0);
  hide.forEach((o) => (o.visible = true));
  settings.night = was.night; settings.sun = was.sun; applySky();
}

/* ---------- quality and resolution ---------- */
function applyQuality() {
  const q = Q();
  const wantShadows = q.shadow > 0;
  if (renderer.shadowMap.enabled !== wantShadows) {
    renderer.shadowMap.enabled = wantShadows;
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
    swaps.forEach((s) => (s.visual.needsUpdate = true)); terrainMat.needsUpdate = true;
  }
  if (wantShadows && sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  sun.castShadow = wantShadows;
  grass.count = q.grass;
  if (rtScene.samples !== q.msaa) { rtScene.samples = q.msaa; rtScene.dispose(); }
  perf.dyn = 1; resizeScene();
}
function resizeScene() {
  const q = Q(), ew = settings.stereo ? VW / 2 : VW;
  perf.scenePR = Math.min(window.devicePixelRatio || 1, q.cap) * q.res * perf.dyn;
  const w = Math.max(64, Math.round(ew * perf.scenePR)), h = Math.max(64, Math.round(VH * perf.scenePR));
  rtScene.setSize(w, h);
  const bw = Math.max(8, w >> 2), bh = Math.max(8, h >> 2);
  rtB[0].setSize(bw, bh); rtB[1].setSize(bw, bh); rtB[2].setSize(Math.max(4, bw >> 1), Math.max(4, bh >> 1)); rtB[3].setSize(Math.max(4, bw >> 1), Math.max(4, bh >> 1));
  rtThermal.forEach((t) => t.setSize(Math.max(64, Math.round(w * 0.5)), Math.max(64, Math.round(h * 0.5))));
}
// automatic resolution: hold the frame rate near 60 fps by scaling the 3D render (the HUD stays sharp)
function autoResolution(real) {
  perf.ema = lerp(perf.ema, Math.min(real, 0.2), 0.05);
  perf.fps = 1 / perf.ema;
  if (!settings.autoRes || state.rt - perf.lastAdj < 1) return;
  perf.lastAdj = state.rt;
  let d = perf.dyn;
  if (perf.ema > 1 / 48) d = Math.max(0.5, d - 0.1);
  else if (perf.ema < 1 / 58 && d < 1) d = Math.min(1, d + 0.05);
  if (Math.abs(d - perf.dyn) > 0.01) { perf.dyn = d; resizeScene(); }
}

/* ---------- layout (shared by WebGL quads and the 2D HUD) ---------- */
let VW = 1, VH = 1, DPR = 1;
const GLASS_H = 25.3, GLASS_V = 14.6; // half-angles of the XREAL One Pro display, degrees
function eyeLayout(ex, ew, eh, cam) {
  const tv = Math.tan((cam.fov * DEG) / 2), th = tv * (ew / eh);
  let r = { x: ex, y: 0, w: ew, h: eh }, halfV = cam.fov / 2, halfH = Math.atan(th) / DEG, fx = 1, fy = 1;
  if (settings.glassesFov) {
    fx = Math.min(1, Math.tan(GLASS_H * DEG) / th); fy = Math.min(1, Math.tan(GLASS_V * DEG) / tv);
    r = { x: ex + (ew * (1 - fx)) / 2, y: (eh * (1 - fy)) / 2, w: ew * fx, h: eh * fy };
    halfV = Math.atan(tv * fy) / DEG; halfH = Math.atan(th * fx) / DEG;
  }
  const u = clamp(Math.min(r.h / 64, r.w / 64), 5, 15);
  const m = u * 2.2, sb = TOUCH && !settings.stereo && FOLD.mode !== 'tabletop' ? clamp(r.h * 0.22, 140, 165) : 0; // keep panels above the touch controls
  const L = { ex, ew, eh, r, halfV, halfH, u, m, cam, uv: [(r.x - ex) / ew, 1 - (r.y + r.h) / eh, (r.x - ex + r.w) / ew, 1 - r.y / eh] };
  // ring height on screen (see compass section): world elevation keeps it 60–86 % of the way to the top edge
  const pitch = player.pitch / DEG, E0 = 0.78 * halfV;
  L.ringElev = pitch + clamp(E0 - pitch, 0.6 * halfV, 0.86 * halfV);
  const inView = L.ringElev - pitch;
  L.ringY = r.y + r.h / 2 - (Math.tan(inView * DEG) / Math.tan(halfV * DEG)) * (r.h / 2);
  L.band = u * 2.1;
  const mmR = clamp(Math.min(r.w * 0.12, r.h * 0.15), 44, 150);
  L.bottom = r.y + r.h - sb;
  L.mini = { r: mmR, cx: r.x + m + mmR * 1.18, cy: L.bottom - m - mmR * 1.02 };
  const dw = clamp(r.w * 0.2, 150, 330), dh = dw * 0.95;
  L.drone = { x: r.x + r.w - m - dw, y: L.bottom - m - dh, w: dw, h: dh, skew: dw * 0.07 };
  L.drone.v = { x: dw * 0.06, y: dh * 0.44, w: dw * 0.88, h: dw * 0.88 * 9 / 16 };
  const aw = clamp(r.w * 0.25, 190, 380), ah = aw * 0.34;
  L.alert = { x: r.x + r.w - m - aw, y: Math.max(L.ringY + L.band * 2.6, r.y + r.h * 0.2), w: aw, h: ah, skew: aw * 0.06 };
  const mw = clamp(r.w * 0.4, 200, 620), mh = mw * 0.2;
  L.mirror = { x: r.x + (r.w - mw) / 2, y: L.ringY + L.band * 2.4, w: mw, h: mh };
  L.menu = { cx: r.x + r.w / 2, cy: r.y + r.h / 2, Ro: Math.min(r.w, r.h) * 0.21 };
  return L;
}

/* ---------- field render ---------- */
let eyes = [];
let shadowPending = false;
function mirrorVisible() { return state.mirrorManual || state.t < state.mirrorUntil; }
// renders with the normal (visual) materials; the shadow map is refreshed here, never during a thermal pass
function visualRender(cam, target) {
  if (shadowPending) { renderer.shadowMap.needsUpdate = true; shadowPending = false; }
  renderer.setRenderTarget(target); renderer.render(scene, cam);
}
function renderField() {
  const W = VW, H = VH, q = Q();
  const mode = { clear: 0, lowlight: 1, thermal: 2, outline: 3, fused: 4 }[state.vision];
  if (settings.stereo) {
    camera.aspect = W / 2 / H; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    stereo.aspect = 1; stereo.update(camera);
    eyes = [{ x: 0, w: W / 2, cam: stereo.cameraL }, { x: W / 2, w: W / 2, cam: stereo.cameraR }];
  } else {
    camera.aspect = W / H; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    eyes = [{ x: 0, w: W, cam: camera }];
  }
  eyes.forEach((e) => { e.cam.matrixWorldInverse.copy(e.cam.matrixWorld).invert(); e.L = eyeLayout(e.x, e.w, H, e.cam); });
  const now = state.t;
  grassUni.uPlayer.value.set(camera.position.x, camera.position.z); grassUni.uTime.value = REDUCED ? 0 : now; cloudUni.uTime.value = now; WIND.uTime.value = REDUCED ? 0 : now; dustUni.uScale.value = rtScene.height / (2 * Math.tan((camera.fov * DEG) / 2));
  if (renderer.shadowMap.enabled) { updateSunShadow(player.pos.x, player.pos.z); shadowPending = state.frame % q.shadowEvery === 0; }
  scene.backgroundIntensity = mode === 3 && settings.night ? 0 : 1; // stars are single pixels: the edge filter turns them into noise

  const needThermal = mode === 2 || mode === 4;
  const video = droneVideo(now) && state.view !== 'helmet';
  const needDrone = video && state.frame % 2 === 0;
  const droneIR = settings.night; // the gimbal switches to its thermal core at night
  if (needDrone && !droneIR) visualRender(droneCam, rtDrone);
  if (needThermal || (needDrone && droneIR)) {
    setThermal(true);
    if (needDrone && droneIR) { renderer.setRenderTarget(rtDrone); renderer.render(scene, droneCam); }
    if (needThermal) eyes.forEach((e, i) => { renderer.setRenderTarget(rtThermal[i]); renderer.render(scene, e.cam); });
    setThermal(false);
  }
  const mirVis = mirrorVisible();
  state.mirrorAnim = damp(state.mirrorAnim, mirVis ? 1 : 0, 10, 1 / 60);
  if (state.mirrorAnim > 0.02) {
    rearCam.position.copy(camera.position); rearCam.rotation.set(-0.05, -player.yaw + Math.PI, 0); rearCam.updateMatrixWorld();
    visualRender(rearCam, rtMirror);
  }

  const bloomOn = q.bloom && mode !== 2, fxOn = q.fx;
  const gain = NV_GAIN[skyKey()] || 4, look = LOOK[skyKey()] || LOOK.golden;
  const fdt = clamp(state.rt - (renderField.lastRT || state.rt), 0.001, 0.25); renderField.lastRT = state.rt;
  const tanHalf = Math.tan((camera.fov * DEG) / 2), horizonV = 0.5 - 0.5 * Math.tan(player.pitch) / tanHalf;
  let adaptTex = blackTex;
  for (let i = 0; i < eyes.length; i++) {
    const e = eyes[i], L = e.L;
    visualRender(e.cam, rtScene);
    let rays = 0;
    if (bloomOn) {
      bloomPass(rtScene.texture, rtScene.width, rtScene.height, mode === 0 ? 1.0 : 0.6 / gain, mode === 0 ? exposure : 1);
      if (mode === 0 && fxOn && look.rays > 0) rays = raysPass(e.cam) * look.rays;
    }
    if (i === 0) adaptTex = adaptPass(rtScene.texture, fdt);
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true); renderer.setViewport(e.x, 0, e.w, H); renderer.setScissor(e.x, 0, e.w, H);
    const u = postMat.uniforms;
    u.tScene.value = rtScene.texture; u.tThermal.value = rtThermal[i].texture;
    u.tBloom1.value = bloomOn ? rtB[0].texture : blackTex; u.tBloom2.value = bloomOn ? rtB[2].texture : blackTex; u.uBloom.value = bloomOn ? 1 : 0;
    u.tRays.value = rays > 0 ? rtB[1].texture : blackTex; u.uRays.value = rays; u.uRayCol.value.copy(sun.color).multiplyScalar(0.42);
    u.tAdapt.value = adaptTex; u.uAdaptOn.value = 1; u.tDirt.value = dirtTex; u.uFx.value = fxOn ? 1 : 0;
    u.uShimmer.value = fxOn && !REDUCED ? look.shimmer : 0; u.uHorizon.value = horizonV;
    u.uGradeLo.value.set(...look.lo); u.uGradeHi.value.set(...look.hi); u.uSat.value = look.sat;
    u.uMode.value = mode; u.uTime.value = now; u.uNight.value = settings.night ? 1 : 0; u.uExposure.value = exposure; u.uGain.value = gain;
    u.uSharp.value = perf.scenePR < CANVAS_PR * 0.95 ? 0.35 : 0.12;
    u.uGlasses.value = settings.glassesFov ? 1 : 0; u.uRes.value.set(e.w * DPR, H * DPR); u.uTexel.value.set(1 / rtScene.width, 1 / rtScene.height);
    u.uRect.value.set(L.uv[0], L.uv[1], L.uv[2], L.uv[3]);
    renderer.render(postScene, postCam);
    // video quads in eye-local pixels (y up)
    screenCam.left = 0; screenCam.right = e.w; screenCam.top = H; screenCam.bottom = 0; screenCam.updateProjectionMatrix();
    const dp = L.drone, v = dp.v;
    droneQuad.visible = video;
    if (video) setQuad(droneQuad, dp.x - e.x + v.x, H - (dp.y + v.y + v.h - (dp.skew * v.x) / dp.w), v.w, v.h, (dp.skew * v.w) / dp.w);
    const du = droneQuad.material.uniforms; du.uTime.value = now; du.uIR.value = droneIR ? 1 : 0; du.uExposure.value = exposure;
    const mr = L.mirror, ma = state.mirrorAnim;
    mirrorQuad.visible = ma > 0.02;
    if (mirrorQuad.visible) { const ih = (mr.h - 6) * ma; setQuad(mirrorQuad, mr.x - e.x + 3, H - (mr.y + 3 + ih), mr.w - 6, ih, 0); }
    const mu = mirrorQuad.material.uniforms; mu.uNight.value = settings.night ? 1 : 0; mu.uAlpha.value = ma; mu.uExposure.value = exposure; mu.uGain.value = gain;
    renderer.autoClear = false; renderer.render(screenScene, screenCam); renderer.autoClear = true;
    renderer.setScissorTest(false);
  }
  renderer.setViewport(0, 0, W, H);
}

/* ---------- foldables: in Flex mode (half-folded, hinge across the screen) the 3D view takes the top half
   and the controls take the bottom half, like a handheld console. Viewport Segments API, Device Posture API,
   or ?flex=1 to force it. ---------- */
const FOLD = { mode: 'full', seg: null };
const FORCE_FLEX = URLP.get('flex') === '1';
const segRect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
function detectFold() {
  const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
  let mode = 'full', seg = null;
  const vs = window.viewport && window.viewport.segments;
  if (settings.foldLayout !== false) {
    if (vs && vs.length === 2 && Math.abs(vs[0].y - vs[1].y) > 20) {
      const [a, b] = vs[0].y < vs[1].y ? [vs[0], vs[1]] : [vs[1], vs[0]]; seg = [segRect(a), segRect(b)]; mode = 'tabletop';
    } else if ((FORCE_FLEX || (navigator.devicePosture && navigator.devicePosture.type === 'folded' && !(vs && vs.length === 2))) && H > W * 0.9) {
      const hinge = Math.round(H / 2); seg = [{ x: 0, y: 0, width: W, height: hinge - 6 }, { x: 0, y: hinge + 6, width: W, height: H - hinge - 6 }]; mode = 'tabletop';
    }
  }
  FOLD.mode = mode; FOLD.seg = seg;
  document.body.classList.toggle('tabletop', mode === 'tabletop');
  const top = mode === 'tabletop' ? seg[0] : { x: 0, y: 0, width: W, height: H };
  for (const c of [glCanvas, hudCanvas]) Object.assign(c.style, { left: top.x + 'px', top: top.y + 'px', width: top.width + 'px', height: top.height + 'px' });
  const t = $('#touch');
  if (mode === 'tabletop') Object.assign(t.style, { top: seg[1].y + 'px', height: seg[1].height + 'px', bottom: 'auto' }); else Object.assign(t.style, { top: '', height: '', bottom: '' });
  return top;
}
function resizeAll() {
  const top = detectFold();
  VW = Math.max(1, Math.round(top.width)); VH = Math.max(1, Math.round(top.height));
  DPR = renderer.getPixelRatio();
  renderer.setSize(VW, VH, false);
  resizeScene();
  hudCanvas.width = Math.round(VW * DPR); hudCanvas.height = Math.round(VH * DPR);
}
