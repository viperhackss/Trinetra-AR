/* ---------- renderer, scene, cameras ---------- */
const glCanvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = false; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
const HDR_TYPE = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(TOUCH ? 66 : 62, 1, 0.05, 1600);
camera.rotation.order = 'YXZ';
const stereo = new THREE.StereoCamera(); stereo.eyeSep = 0.064;
const manager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(manager);

/* World axes: +X = east, -Z = north, +Y = up. Bearings are clockwise from north. */
const WORLD = 640, HALF = WORLD / 2;
function hash2(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// keep in step with terrainH() in the grass shader
function heightAt(x, z) {
  const base = 2.4 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011 - 0.7) + 1.3 * Math.sin(x * 0.029 + z * 0.021) + 0.45 * Math.sin(x * 0.071 - z * 0.053);
  const f = sstep(42, 95, Math.hypot(x, z));
  const ridge = 20 * sstep(150, 310, Math.hypot(x * 0.85, z + 30)) * (0.65 + 0.35 * Math.sin(x * 0.021 + 0.4));
  return base * f + ridge;
}
const ZONE = [[58, -88], [102, -80], [114, -46], [82, -32], [50, -52]];
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// dirt tracks: from the start point into the yard, a loop road, and a track to the windmill
const TRACKS = [
  [[0, 90], [1, 60], [3, 40], [4, 26]],
  [[38, 4], [33, -22], [16, -38], [-10, -40], [-34, -26], [-39, 2], [-28, 30], [-4, 40], [22, 32], [38, 4]],
  [[-14, -38], [-30, -62], [-50, -84], [-60, -94]],
];
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1); return Math.hypot(px - ax - dx * t, pz - az - dz * t); }
function trackDist(x, z) { let d = 1e9; for (const tr of TRACKS) for (let i = 0; i < tr.length - 1; i++) d = Math.min(d, segDist(x, z, tr[i][0], tr[i][1], tr[i + 1][0], tr[i + 1][1])); return d; }
function dirtAt(x, z) {
  const yard = 1 - sstep(28, 42, Math.hypot(x, z));
  const td = trackDist(x, z), track = (1 - sstep(1.0, 2.6, td)) * (0.75 + 0.25 * (1 - sstep(0.2, 0.7, Math.abs(td - 0.95))));
  return Math.max(yard * (0.75 + 0.25 * vnoise(x * 0.3, z * 0.3)), track);
}
function grassDensity(x, z) {
  if (inPoly(x, z, ZONE)) return 0.3;
  return clamp(1 - dirtAt(x, z) * 1.5, 0, 1) * (0.55 + 0.45 * vnoise(x * 0.07 + 3, z * 0.07 - 2));
}

/* ---------- lights, sky, fog ---------- */
const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3020, 0.12); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0bd, 3); scene.add(sun, sun.target);
{ const sc = sun.shadow.camera; sc.left = -64; sc.right = 64; sc.top = 64; sc.bottom = -64; sc.near = 1; sc.far = 600; sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.04; sun.shadow.mapSize.set(2048, 2048); }
const sunDir = new THREE.Vector3(-0.6, 0.35, 0.7).normalize();
function updateSunShadow(cx, cz) {
  const texel = 128 / sun.shadow.mapSize.x;
  const x = Math.round(cx / texel) * texel, z = Math.round(cz / texel) * texel;
  sun.target.position.set(x, heightAt(x, z), z); sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);
  sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
}
scene.fog = new THREE.FogExp2(0xc8b49a, 0.0024);
/* Fog with sun in-scatter: haze glows toward the sun. Patched into every lit material. */
const FOG_UNI = { fogSunDir: { value: new THREE.Vector3(0, 1, 0) }, fogSunCol: { value: new THREE.Color(0, 0, 0) } };
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogDirW;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogDirW = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor; uniform vec3 fogSunDir; uniform vec3 fogSunCol;
	varying float vFogDepth; varying vec3 vFogDirW;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear; uniform float fogFar;
	#endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	float fogSun = max( dot( normalize( vFogDirW ), fogSunDir ), 0.0 );
	vec3 fogC = fogColor + fogSunCol * ( pow( fogSun, 6.0 ) * 0.8 + pow( fogSun, 48.0 ) * 1.6 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogFactor );
#endif`;
THREE.Material.prototype.onBeforeCompile = function (sh) { if (sh.uniforms && sh.uniforms.fogColor) Object.assign(sh.uniforms, FOG_UNI); };

/* Day: analytic (Preetham) sky with a drifting cloud layer; image-based light is made from the same sky.
   Night: a photographed moonless sky (stars, sodium-lit treeline). */
const SKIES = {
  // Delhi, mid-October: sunset bearing ~255°, noon elevation ~52° to the south
  golden: { az: 252, el: 11, turbidity: 9, rayleigh: 2.4, mie: 0.0065, mieG: 0.86, exposure: 0.62, sun: 3.2, sunColor: 0xffc58a, fog: 0.0026, cover: 0.58, cloudA: 0.75 },
  noon: { az: 180, el: 52, turbidity: 6.5, rayleigh: 1.1, mie: 0.004, mieG: 0.8, exposure: 0.36, sun: 4.6, sunColor: 0xfff2e2, fog: 0.0019, cover: 0.62, cloudA: 0.7 },
  night: { file: 'sky_night', exposure: 0.14, sun: 0.07, sunColor: 0x9fb4e0, fog: 0.004 },
};
const skyMesh = new Sky(); skyMesh.scale.setScalar(450000); scene.add(skyMesh);
skyMesh.material.uniforms.skyGain = { value: 1 };
skyMesh.material.fragmentShader = skyMesh.material.fragmentShader.replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float skyGain;').replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
const cloudUni = { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uSkyCol: { value: new THREE.Color() }, uTime: { value: 0 }, uCover: { value: 0.58 }, uOpacity: { value: 0.75 } };
const clouds = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
  uniforms: cloudUni, transparent: true, depthWrite: false, side: THREE.BackSide,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform float uTime; uniform float uCover; uniform float uOpacity; varying vec3 vDir;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ v += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
  void main(){
    vec3 d = normalize(vDir);
    if (d.y <= 0.0) discard;
    vec2 p = d.xz / (d.y + 0.1) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(p) * 0.7 + fbm(p * 3.7 + 11.0) * 0.3;
    float c = smoothstep(uCover, uCover + 0.22, n);
    if (c < 0.004) discard;
    float sun = max(dot(d, uSunDir), 0.0), thick = smoothstep(uCover, uCover + 0.42, n);
    vec3 lit = uSkyCol * 0.9 + uSunCol * (0.2 + 0.8 * pow(sun, 3.0) + 2.5 * pow(sun, 24.0) * (1.0 - thick));
    lit *= mix(1.08, 0.6, thick);
    gl_FragColor = vec4(lit, c * smoothstep(0.015, 0.2, d.y) * uOpacity);
  }`,
}));
clouds.frustumCulled = false; scene.add(clouds);
const skyInfo = {}; // key -> { tex?, env, horizon, dir }
let pmrem = null;
const probeRT = new THREE.WebGLRenderTarget(16, 16, { type: HDR_TYPE, depthBuffer: false });
const probeCam = new THREE.PerspectiveCamera(90, 1, 0.1, 100); probeCam.rotation.order = 'YXZ';
// average sky radiance a few degrees above the horizon, all round: this becomes the fog colour
function probeHorizon(pScene) {
  const half = HDR_TYPE === THREE.HalfFloatType, buf = half ? new Uint16Array(16 * 16 * 4) : new Uint8Array(16 * 16 * 4);
  const rd = (v) => (half ? THREE.DataUtils.fromHalfFloat(v) : v / 255);
  const acc = [0, 0, 0]; let n = 0;
  for (let k = 0; k < 4; k++) {
    probeCam.rotation.set(4 * DEG, (k * Math.PI) / 2, 0); probeCam.updateMatrixWorld();
    renderer.setRenderTarget(probeRT); renderer.render(pScene, probeCam);
    renderer.readRenderTargetPixels(probeRT, 0, 0, 16, 16, buf);
    for (let y = 5; y < 9; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; acc[0] += rd(buf[i]); acc[1] += rd(buf[i + 1]); acc[2] += rd(buf[i + 2]); n++; }
  }
  renderer.setRenderTarget(null);
  return new THREE.Color(acc[0] / n, acc[1] / n, acc[2] / n);
}
function dirFromAzEl(az, el) { const a = az * DEG, e = el * DEG; return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)); }
function buildDaySky(key) {
  const s = SKIES[key], u = skyMesh.material.uniforms, dir = dirFromAzEl(s.az, s.el);
  u.turbidity.value = s.turbidity; u.rayleigh.value = s.rayleigh; u.mieCoefficient.value = s.mie; u.mieDirectionalG.value = s.mieG; u.sunPosition.value.copy(dir);
  if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
  const pScene = new THREE.Scene(); pScene.add(skyMesh);
  const horizon = probeHorizon(pScene);
  // env light: the sky above, sunlit ground below
  const k = (s.sun * Math.max(dir.y, 0.12)) / Math.PI;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.36 * k, 0.29 * k, 0.21 * k) }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2; pScene.add(ground);
  const env = pmrem.fromScene(pScene, 0.02, 0.1, 200).texture;
  ground.geometry.dispose(); ground.material.dispose();
  scene.add(skyMesh);
  skyInfo[key] = { env, horizon, dir, u: { turbidity: s.turbidity, rayleigh: s.rayleigh, mie: s.mie, mieG: s.mieG } };
}
const skyPending = {};
function loadSky(key, onProg) {
  if (skyPending[key]) return skyPending[key];
  if (!SKIES[key].file) return (skyPending[key] = Promise.resolve().then(() => buildDaySky(key)));
  return (skyPending[key] = loadRGBEPair(ASSETS + SKIES[key].file).then((tex) => {
    if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
    const pScene = new THREE.Scene(); pScene.background = tex;
    skyInfo[key] = { tex, env: pmrem.fromEquirectangular(tex).texture, horizon: probeHorizon(pScene).multiplyScalar(0.8), dir: new THREE.Vector3(0.3, 1, -0.4).normalize() };
    if (onProg) onProg({ loaded: 1, total: 1 });
  }).catch(() => { skyInfo[key] = null; }));
}
// The night sky ships as two lossless PNGs: RGB mantissas and the shared exponent of the original Radiance HDR.
async function loadRGBEPair(base) {
  const get = async (url) => {
    const r = await fetch(url); if (!r.ok) throw new Error('missing ' + url);
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, c.width, c.height);
  };
  const [a, e] = await Promise.all([get(base + '_rgb.png'), get(base + '_exp.png')]);
  const W = a.width, H = a.height, out = new Uint16Array(W * H * 4), toH = THREE.DataUtils.toHalfFloat, one = toH(1);
  for (let i = 0; i < W * H; i++) {
    const ex = e.data[i * 4], f = ex ? Math.pow(2, ex - 136) : 0;
    out[i * 4] = toH(Math.min(65000, a.data[i * 4] * f)); out[i * 4 + 1] = toH(Math.min(65000, a.data[i * 4 + 1] * f)); out[i * 4 + 2] = toH(Math.min(65000, a.data[i * 4 + 2] * f)); out[i * 4 + 3] = one;
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.flipY = true; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.needsUpdate = true;
  return tex;
}
let exposure = 1;
function skyKey() { return settings.night ? 'night' : settings.sun; }
function applySky() {
  const key = skyKey(), s = SKIES[key], info = skyInfo[key], day = !s.file;
  exposure = s.exposure;
  skyMesh.visible = clouds.visible = day && !!info;
  if (info) {
    scene.environment = info.env;
    sunDir.copy(info.dir);
    if (day) {
      scene.background = null;
      const u = skyMesh.material.uniforms; u.turbidity.value = info.u.turbidity; u.rayleigh.value = info.u.rayleigh; u.mieCoefficient.value = info.u.mie; u.mieDirectionalG.value = info.u.mieG; u.sunPosition.value.copy(info.dir);
      cloudUni.uSunDir.value.copy(info.dir); cloudUni.uSkyCol.value.copy(info.horizon); cloudUni.uSunCol.value.set(s.sunColor).multiplyScalar(s.sun * 0.32);
      cloudUni.uCover.value = s.cover; cloudUni.uOpacity.value = s.cloudA;
    } else scene.background = info.tex;
    scene.fog.color.copy(info.horizon);
  } else {
    scene.background = new THREE.Color(settings.night ? 0x05070b : 0x9fb6cc); scene.environment = null;
    scene.fog.color.set(settings.night ? 0x05070b : 0xb9c6cf);
  }
  FOG_UNI.fogSunDir.value.copy(sunDir);
  FOG_UNI.fogSunCol.value.set(s.sunColor).multiplyScalar(day ? s.sun * 0.16 : 0);
  sun.color.set(s.sunColor); sun.intensity = s.sun; scene.fog.density = s.fog;
  hemi.intensity = info ? (settings.night ? 0.02 : 0.08) : (settings.night ? 0.05 : 0.9);
  lampLight.intensity = settings.night ? 30 : 0;
  lampBulb.material.emissiveIntensity = settings.night ? 60 : 0.2;
  VEHICLES.forEach((v, i) => { const on = settings.night && i === 0; v.lights.forEach((m) => (m.material.emissiveIntensity = on ? 40 : 0)); if (v.beam) v.beam.intensity = on ? 90 : 0; });
  updateTerrainHeat();
}
function setNight(on) { settings.night = on; saveSettings(); applySky(); }

/* ---------- thermal material system ---------- */
const TH_VS = `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN; varying vec3 vW; varying vec2 vUv2;
void main(){
  vUv2 = uv;
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 p = vec4(transformed, 1.0); vec3 n = objectNormal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
  #endif
  vec4 w = modelMatrix * p; vW = w.xyz; vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const TH_FS = `
uniform float uHeat; uniform sampler2D tAlpha; uniform float uUseAlpha;
varying vec3 vN; varying vec3 vW; varying vec2 vUv2;
float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), f.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  if (uUseAlpha > 0.5 && texture2D(tAlpha, vUv2).a < 0.45) discard;
  float sh = 0.84 + 0.16 * max(dot(normalize(vN), normalize(vec3(-0.4, 0.8, 0.3))), 0.0);
  float h = uHeat * sh + (vn(vW.xz * 1.7 + vW.y * 1.3) - 0.5) * 0.04;
  h = mix(h, 0.27, smoothstep(90.0, 480.0, distance(vW, cameraPosition)));
  gl_FragColor = vec4(vec3(h), 1.0);
}`;
const thermalCache = new Map();
function thermalMat(heat, alphaTex = null) {
  const key = heat.toFixed(3) + (alphaTex ? alphaTex.uuid : '');
  if (!thermalCache.has(key)) thermalCache.set(key, new THREE.ShaderMaterial({ uniforms: { uHeat: { value: heat }, tAlpha: { value: alphaTex }, uUseAlpha: { value: alphaTex ? 1 : 0 } }, vertexShader: TH_VS, fragmentShader: TH_FS, side: alphaTex ? THREE.DoubleSide : THREE.FrontSide }));
  return thermalCache.get(key);
}
const swaps = []; // { mesh, visual, dayHeat, nightHeat, alpha }
function regHeat(mesh, dayHeat, nightHeat = dayHeat, alpha = null) { swaps.push({ mesh, visual: mesh.material, dayHeat, nightHeat, alpha }); return mesh; }
const hideInThermal = [skyMesh, clouds];
let thermalOn = false, savedBg = null, savedFog = null;
function setThermal(on) {
  if (on === thermalOn) return;
  thermalOn = on;
  for (const s of swaps) s.mesh.material = on ? thermalMat(settings.night ? s.nightHeat : s.dayHeat, s.alpha) : s.visual;
  terrain.material = on ? terrainThermalMat : terrainMat;
  hideInThermal.forEach((o) => { if (on) { o.userData.vis = o.visible; o.visible = false; } else o.visible = o.userData.vis !== undefined ? o.userData.vis : true; });
  if (on) { savedBg = scene.background; savedFog = scene.fog; scene.background = new THREE.Color(0x000000); scene.fog = null; }
  else { scene.background = savedBg; scene.fog = savedFog; }
}

const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, ...o });
const occluders = [];
const obbs = [];
function addObb(x, z, hw, hd, rot) { obbs.push({ x, z, hw, hd, c: Math.cos(rot), s: Math.sin(rot) }); }
function collide(p, rad) {
  for (const o of obbs) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
    if (Math.abs(lx) > o.hw + rad || Math.abs(lz) > o.hd + rad) continue;
    const qx = clamp(lx, -o.hw, o.hw), qz = clamp(lz, -o.hd, o.hd);
    let px = lx - qx, pz = lz - qz; const d = Math.hypot(px, pz);
    if (d >= rad) continue;
    if (d < 1e-4) {
      const ox = o.hw - Math.abs(lx), oz = o.hd - Math.abs(lz);
      if (ox < oz) { const push = (ox + rad) * (Math.sign(lx) || 1); p.x += o.c * push; p.z += -o.s * push; }
      else { const push = (oz + rad) * (Math.sign(lz) || 1); p.x += o.s * push; p.z += o.c * push; }
      continue;
    }
    const k = (rad - d) / d; px *= k; pz *= k;
    p.x += o.c * px + o.s * pz; p.z += -o.s * px + o.c * pz;
  }
}
const shadowed = (m, cast = true, receive = true) => { m.castShadow = cast; m.receiveShadow = receive; return m; };

/* ---------- terrain ---------- */
const grassMap = texLoader.load(ASSETS + 'grass_dry.jpg');
const grassNormal = texLoader.load(ASSETS + 'grass_normal.jpg');
for (const t of [grassMap, grassNormal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(128, 128); t.anisotropy = MAX_ANISO; }
grassMap.colorSpace = THREE.SRGBColorSpace;
const terrainGeo = new THREE.PlaneGeometry(WORLD, WORLD, 256, 256);
terrainGeo.rotateX(-Math.PI / 2);
{
  const tp = terrainGeo.attributes.position, n = tp.count;
  const col = new Float32Array(n * 3), dirt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    tp.setY(i, heightAt(x, z));
    const m1 = vnoise(x * 0.025 + 7, z * 0.025 - 3), m2 = vnoise(x * 0.11, z * 0.11);
    let r = 1.0 + m2 * 0.15, g = 0.9 + m2 * 0.12, b = 0.76 + m2 * 0.1; // dusty tan soil
    const green = sstep(0.62, 0.85, m1); r -= green * 0.2; b -= green * 0.18; g -= green * 0.02;
    const dark = sstep(0.3, 0.05, m1) * 0.18; r -= dark; g -= dark; b -= dark;
    if (inPoly(x, z, ZONE)) { r *= 0.62; g *= 0.6; b *= 0.55; }
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    dirt[i] = dirtAt(x, z);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  terrainGeo.setAttribute('dirt', new THREE.BufferAttribute(dirt, 1));
  terrainGeo.setAttribute('heat', new THREE.BufferAttribute(new Float32Array(n), 1));
  terrainGeo.computeVertexNormals();
}
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grassMap, normalMap: grassNormal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0 });
terrainMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, FOG_UNI);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float dirt;\nvarying float vDirt;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDirt = dirt;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDirt;')
    .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 tA = texture2D(map, vMapUv);
  vec4 tB = texture2D(map, vMapUv * 0.173 + vec2(0.37, 0.71));
  vec4 sampledDiffuseColor = mix(tA, tB, 0.42);
  float gl = dot(sampledDiffuseColor.rgb, vec3(0.333));
  vec3 dirtC = vec3(0.36, 0.30, 0.23) * (0.55 + 0.9 * gl);
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb * 1.08, dirtC, vDirt);
  diffuseColor *= sampledDiffuseColor;
#endif`);
};
const terrainThermalMat = new THREE.ShaderMaterial({
  vertexShader: `attribute float heat; varying float vH; varying vec3 vW; void main(){ vH = heat; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `varying float vH; varying vec3 vW; float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), f.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main(){ float h = vH + (vn(vW.xz * 0.35) - 0.5) * 0.05 + (vn(vW.xz * 2.1) - 0.5) * 0.02; h = mix(h, 0.27, smoothstep(90.0, 480.0, distance(vW, cameraPosition))); gl_FragColor = vec4(vec3(h), 1.0); }`,
});
const terrain = shadowed(new THREE.Mesh(terrainGeo, terrainMat), false, true);
scene.add(terrain);
function updateTerrainHeat() {
  const tp = terrainGeo.attributes.position, ha = terrainGeo.attributes.heat, dirt = terrainGeo.attributes.dirt;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i), nz = vnoise(x * 0.12, z * 0.12), d = dirt.getX(i);
    let h = settings.night ? 0.24 + nz * 0.06 + d * 0.07 : 0.4 + nz * 0.08 + d * 0.1;
    if (inPoly(x, z, ZONE)) h = settings.night ? 0.33 : 0.31;
    ha.setX(i, h);
  }
  ha.needsUpdate = true;
}

/* ---------- grass blades (instanced, wrapped around the player, wind) ---------- */
const GRASS_MAX = 40000;
const grassUni = { uSunDir: { value: sunDir }, uPlayer: { value: new THREE.Vector2() }, uTime: { value: 0 }, uSize: { value: 80 }, tDensity: { value: null }, uGold: { value: new THREE.Color().setRGB(0.66, 0.55, 0.32, THREE.SRGBColorSpace) }, uGreen: { value: new THREE.Color().setRGB(0.44, 0.47, 0.26, THREE.SRGBColorSpace) } };
{
  const S = 256, d = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const x = (i / S) * WORLD - HALF, z = (j / S) * WORLD - HALF; d[(j * S + i) * 4] = Math.round(grassDensity(x, z) * 255); d[(j * S + i) * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; grassUni.tDensity.value = t;
}
function makeTuftGeometry() {
  const pos = [], tip = [], idx = []; const blades = 9;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rand() * 0.8, r = rand() * 0.14, h = 0.2 + rand() * 0.42, w = 0.022 + rand() * 0.018, lean = 0.08 + rand() * 0.22;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r, fa = rand() * Math.PI, fx = Math.cos(fa), fz = Math.sin(fa), lx = Math.cos(a), lz = Math.sin(a);
    const base = pos.length / 3;
    const pt = (s, t, hw) => { pos.push(ox + fx * hw * s + lx * lean * t * t, h * t, oz + fz * hw * s + lz * lean * t * t); tip.push(t); };
    pt(-1, 0, w / 2); pt(1, 0, w / 2); pt(-1, 0.55, w * 0.35); pt(1, 0.55, w * 0.35); pt(0, 1, 0);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  const off = new Float32Array(GRASS_MAX * 4);
  for (let i = 0; i < GRASS_MAX; i++) { off[i * 4] = rand(); off[i * 4 + 1] = rand(); off[i * 4 + 2] = rand() * Math.PI * 2; off[i * 4 + 3] = 0.6 + rand() * 0.75; }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  return g;
}
const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
grassMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, grassUni, FOG_UNI);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float tip; attribute vec4 aOff;
uniform vec2 uPlayer; uniform float uTime; uniform float uSize; uniform sampler2D tDensity; uniform vec3 uSunDir;
varying float vTip; varying float vVar;
float gs(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float terrainH(vec2 p){ float x = p.x, z = p.y;
  float base = 2.4 * sin(x * 0.013 + 1.3) * cos(z * 0.011 - 0.7) + 1.3 * sin(x * 0.029 + z * 0.021) + 0.45 * sin(x * 0.071 - z * 0.053);
  float f = gs(42.0, 95.0, length(p));
  float ridge = 20.0 * gs(150.0, 310.0, length(vec2(x * 0.85, z + 30.0))) * (0.65 + 0.35 * sin(x * 0.021 + 0.4));
  return base * f + ridge; }`)
    .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) * 0.75 + vec3(0.0, 0.65, 0.0));') // blades catch the low sun like the real thing
    .replace('#include <begin_vertex>', `
  vec2 off = aOff.xy * uSize;
  vec2 bxz = uPlayer + mod(off - uPlayer + uSize * 0.5, uSize) - uSize * 0.5;
  float dens = texture2D(tDensity, (bxz + 320.0) / 640.0).r;
  float rnd = fract(sin(dot(aOff.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float keep = step(rnd, dens);
  float fade = 1.0 - smoothstep(uSize * 0.36, uSize * 0.5, length(bxz - uPlayer));
  float s = aOff.w * keep * fade;
  vec3 transformed = position * s;
  float c = cos(aOff.z), sn = sin(aOff.z);
  transformed.xz = mat2(c, -sn, sn, c) * transformed.xz;
  float w = sin(uTime * 1.6 + bxz.x * 0.31 + bxz.y * 0.19) * 0.6 + sin(uTime * 3.1 + bxz.x * 0.9 - bxz.y * 0.4) * 0.25;
  transformed.x += w * 0.13 * tip * tip * s; transformed.z += w * 0.07 * tip * tip * s;
  vec2 toP = bxz - uPlayer; float dP = length(toP), pushK = (1.0 - smoothstep(0.2, 1.0, dP)) * tip * tip * s;
  transformed.xz += (toP / max(dP, 0.05)) * pushK * 0.38; transformed.y -= pushK * 0.16;
  transformed += vec3(bxz.x, terrainH(bxz) - 0.02, bxz.y);
  vTip = tip; vVar = rnd;`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uGold; uniform vec3 uGreen; varying float vTip; varying float vVar;')
    .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(uGold, uGreen, smoothstep(0.55, 0.95, vVar)) * (0.82 + 0.36 * fract(vVar * 7.13)) * mix(0.55, 1.08, vTip);');
};
const grass = new THREE.InstancedMesh(makeTuftGeometry(), grassMat, GRASS_MAX);
grass.frustumCulled = false; grass.receiveShadow = true; grass.castShadow = false;
scene.add(grass); hideInThermal.push(grass);

/* ---------- containers ---------- */
function canvasTex(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; return t; }
const corrugNormal = canvasTex(256, 4, (g, w, h) => {
  for (let i = 0; i < w; i++) { const sl = Math.cos((i / w) * Math.PI * 2 * 24) * 0.75; const nx = -sl / Math.hypot(sl, 1), nz = 1 / Math.hypot(sl, 1); g.fillStyle = `rgb(${Math.round((nx * 0.5 + 0.5) * 255)},128,${Math.round((nz * 0.5 + 0.5) * 255)})`; g.fillRect(i, 0, 1, h); }
}, false);
const grime = canvasTex(512, 160, (g, w, h) => {
  g.fillStyle = '#ececec'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { const v = 200 + Math.random() * 55; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 1 + Math.random() * 4); }
  for (let i = 0; i < 26; i++) { const x = Math.random() * w, len = 20 + Math.random() * 110; const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(120,60,30,0.55)'); gr.addColorStop(1, 'rgba(120,60,30,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + Math.random() * 5, len); }
  const bot = g.createLinearGradient(0, h * 0.7, 0, h); bot.addColorStop(0, 'rgba(110,90,60,0)'); bot.addColorStop(1, 'rgba(110,90,60,0.6)'); g.fillStyle = bot; g.fillRect(0, 0, w, h);
});
const CONTAINERS = [
  [-14, -16, 0, '#8c3b2e'], [-7.6, -16, 0, '#3e5a72'], [-14, -16, 0, '#6e6a5a', 1],
  [9, -20, 0.18, '#5d6b45'], [17, -6, Math.PI / 2, '#8c3b2e'], [-21, 3, Math.PI / 2, '#7b7f82'],
  [-3, 9, 0.06, '#3e5a72'], [6, 24, -0.32, '#9b6b3a'], [26, 14, Math.PI / 2 + 0.1, '#5d6b45'],
  [-13, 22, 0.4, '#7b7f82'], [30, -27, 0.9, '#8c3b2e'], [-31, -25, -0.5, '#3e5a72'],
];
const containerGeo = new THREE.BoxGeometry(6.06, 2.59, 2.44);
const barGeo = new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6);
const steel = std('#3b3d3e', { metalness: 0.7, roughness: 0.45 });
for (const [x, z, rot, color, stack] of CONTAINERS) {
  const m = shadowed(new THREE.Mesh(containerGeo, std(color, { map: grime, normalMap: corrugNormal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.62, metalness: 0.25 })));
  m.position.set(x, heightAt(x, z) + 1.295 + (stack ? 2.59 : 0), z); m.rotation.y = rot;
  for (const bz of [-0.85, -0.35, 0.35, 0.85]) { const b = shadowed(new THREE.Mesh(barGeo, steel), true, false); b.position.set(3.05, 0, bz); m.add(b); regHeat(b, 0.5, 0.22); }
  scene.add(m); occluders.push(m); regHeat(m, 0.56, 0.24);
  if (!stack) addObb(x, z, 3.03, 1.22, rot);
}
// wall-pack floodlight on the container front: housing, bracket, and the lens (the light source)
const lampHousing = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.2, 0.3, 3, 0.04), std('#2c3033', { metalness: 0.6, roughness: 0.4 }))); lampHousing.position.set(-10.6, 2.68, -14.5); lampHousing.rotation.x = 0.35; scene.add(lampHousing); regHeat(lampHousing, 0.6, 0.7);
const lampArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), std('#2c3033', { metalness: 0.6, roughness: 0.4 })); lampArm.position.set(-10.6, 2.72, -14.68); scene.add(lampArm);
const lampBulb = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), std(0xfff1d0, { emissive: 0xffd9a0, emissiveIntensity: 0.2, side: THREE.DoubleSide }));
lampBulb.position.set(-10.6, 2.6, -14.45); lampBulb.rotation.x = Math.PI / 2 + 0.35; scene.add(lampBulb); regHeat(lampBulb, 0.9, 0.97);
const lampLight = new THREE.PointLight(0xffd59a, 0, 36, 2); lampLight.position.copy(lampBulb.position).add(new THREE.Vector3(0, -0.2, 0.4)); scene.add(lampLight);

/* ---------- contact shadows: soft dark footprints where sky light cannot reach ---------- */
const aoTex = canvasTex(128, 128, (g, w, h) => {
  // alpha lives in the green channel: a soft rounded footprint, darkest under the object
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.max(Math.abs(x + 0.5 - w / 2) - w * 0.2, 0), dy = Math.max(Math.abs(y + 0.5 - h / 2) - h * 0.2, 0);
    const v = Math.round(255 * Math.pow(1 - sstep(0, w * 0.3, Math.hypot(dx, dy)), 1.6));
    const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}, false);
const aoMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: aoTex, transparent: true, depthWrite: false, opacity: 0.62, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
const aoGeo = new THREE.PlaneGeometry(1, 1); aoGeo.rotateX(-Math.PI / 2);
function addAO(x, z, w, d, rot, k = 1) {
  const m = new THREE.Mesh(aoGeo, k === 1 ? aoMat : aoMat.clone()); if (k !== 1) m.material.opacity *= k;
  m.scale.set(w * 1.6, 1, d * 1.9); m.position.set(x, heightAt(x, z) + 0.025, z); m.rotation.y = rot; m.renderOrder = -1;
  scene.add(m); hideInThermal.push(m); return m;
}
for (const [x, z, rot, , stack] of CONTAINERS) if (!stack) addAO(x, z, 6.06, 2.44, rot);

/* ---------- vehicles: extruded side profiles of a boxy utility SUV and a single-cab pickup ---------- */
function extrudeProfile(shape, depth, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 18 });
  g.translate(0, 0, -depth / 2); g.computeVertexNormals(); return g;
}
function poly2(pts) { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath(); return sh; }
const TIRE_GEO = (() => {
  const pr = [[0.235, -0.13], [0.3, -0.136], [0.35, -0.128], [0.375, -0.1], [0.383, -0.05], [0.383, 0.05], [0.375, 0.1], [0.35, 0.128], [0.3, 0.136], [0.235, 0.13]];
  const g = new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), 28); g.rotateX(Math.PI / 2); return g;
})();
const RIM_GEO = (() => { const g = new THREE.CylinderGeometry(0.235, 0.235, 0.2, 22); g.rotateX(Math.PI / 2); return g; })();
const HUB_GEO = (() => { const g = new THREE.CylinderGeometry(0.07, 0.09, 0.24, 12); g.rotateX(Math.PI / 2); return g; })();
const tireMat = std('#141515', { roughness: 0.92 }), rimMat = std('#7d8285', { metalness: 0.85, roughness: 0.35 });
const trimMat = std('#1a1c1e', { roughness: 0.7 }), glassMat = std('#0a1115', { metalness: 0.9, roughness: 0.05 }), chromeMat = std('#c7ccd0', { metalness: 1, roughness: 0.22 });
function makeVehicle(color, kind) {
  const g = new THREE.Group(), paint = std(color, { metalness: 0.35, roughness: 0.5 });
  const lights = [], wheels = [], heat = [];
  const add = (geo, mat, x, y, z, parent = g, cast = true) => { const m = shadowed(new THREE.Mesh(geo, mat), cast, true); m.position.set(x, y, z); parent.add(m); return m; };
  const pickup = kind === 'pickup';
  const L = pickup ? 2.45 : 2.05, WF = pickup ? 1.55 : 1.34, WR = pickup ? -1.45 : -1.34, W = 1.66;
  let body, glassParts = [];
  if (!pickup) {
    const sh = new THREE.Shape(); sh.moveTo(-L, 0.44); sh.lineTo(WR - 0.46, 0.44);
    sh.absarc(WR, 0.44, 0.46, Math.PI, 0, true); sh.lineTo(WF - 0.46, 0.44); sh.absarc(WF, 0.44, 0.46, Math.PI, 0, true);
    sh.lineTo(L - 0.03, 0.44); sh.lineTo(L + 0.02, 0.98); sh.lineTo(L - 0.07, 1.06); sh.lineTo(1.05, 1.13); sh.lineTo(0.66, 1.8); sh.lineTo(0.5, 1.86); sh.lineTo(-L + 0.1, 1.88); sh.lineTo(-L, 1.8); sh.closePath();
    body = add(extrudeProfile(sh, W), paint, 0, 0, 0);
    glassParts.push(add(extrudeProfile(poly2([[0.93, 1.2], [0.61, 1.74], [-1.88, 1.76], [-1.88, 1.2]]), W + 0.13, 0), glassMat, 0, 0, 0));
    for (const px of [-0.42, -1.32]) add(new THREE.BoxGeometry(0.08, 0.58, W + 0.15), paint, px, 1.48, 0);
    const ws = add(new THREE.BoxGeometry(0.74, 0.012, 1.52), glassMat, 0.855 + 0.864 * 0.03, 1.465 + 0.503 * 0.03, 0); ws.rotation.z = Math.atan2(0.67, -0.39); glassParts.push(ws);
    glassParts.push(add(new THREE.BoxGeometry(0.012, 0.5, 1.38), glassMat, -L - 0.055, 1.48, 0));
    const hood = add(new THREE.BoxGeometry(0.94, 0.012, 1.5), paint, 1.52, 1.115, 0); hood.rotation.z = -0.075; heat.push(['hood', hood]);
    for (const dz of [-1, 1]) { const rr2 = add(new THREE.BoxGeometry(1.9, 0.04, 0.04), trimMat, -0.75, 1.95, dz * 0.68); }
    for (const dx of [0.94, -0.42]) add(new THREE.BoxGeometry(0.01, 0.66, W + 0.115), trimMat, dx, 0.84, 0, g, false); // door seams
    // rear-mounted spare wheel
    const spare = add(TIRE_GEO, tireMat, -L - 0.2, 1.05, 0); spare.rotation.y = Math.PI / 2; wheels.push(spare);
    const cover = add(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 24), trimMat, -L - 0.33, 1.05, 0); cover.rotation.z = Math.PI / 2;
  } else {
    const cab = new THREE.Shape(); cab.moveTo(0.2, 0.46); cab.lineTo(WF - 0.47, 0.46); cab.absarc(WF, 0.46, 0.47, Math.PI, 0, true);
    cab.lineTo(L - 0.03, 0.46); cab.lineTo(L + 0.02, 1.0); cab.lineTo(L - 0.07, 1.08); cab.lineTo(1.5, 1.15); cab.lineTo(1.12, 1.84); cab.lineTo(0.96, 1.9); cab.lineTo(0.24, 1.9); cab.lineTo(0.2, 1.82); cab.closePath();
    body = add(extrudeProfile(cab, W), paint, 0, 0, 0);
    glassParts.push(add(extrudeProfile(poly2([[1.38, 1.2], [1.08, 1.76], [0.32, 1.78], [0.32, 1.2]]), W + 0.13, 0), glassMat, 0, 0, 0));
    const ws = add(new THREE.BoxGeometry(0.76, 0.012, 1.52), glassMat, 1.31 + 0.876 * 0.03, 1.495 + 0.482 * 0.03, 0); ws.rotation.z = Math.atan2(0.69, -0.38); glassParts.push(ws);
    glassParts.push(add(new THREE.BoxGeometry(0.012, 0.42, 1.3), glassMat, 0.135, 1.52, 0));
    const hood = add(new THREE.BoxGeometry(0.92, 0.012, 1.5), paint, 1.94, 1.115, 0); hood.rotation.z = -0.075; heat.push(['hood', hood]);
    add(new THREE.BoxGeometry(0.01, 0.66, W + 0.115), trimMat, 1.0, 0.84, 0, g, false);
    // load bed: side panels with the rear wheel arch, floor, headboard, tailgate, and a load of sacks
    const side = new THREE.Shape(); side.moveTo(-L, 0.52); side.lineTo(WR - 0.47, 0.52); side.absarc(WR, 0.48, 0.47, Math.PI, 0, true); side.lineTo(0.12, 0.52); side.lineTo(0.12, 1.42); side.lineTo(-L, 1.42); side.closePath();
    for (const dz of [-1, 1]) add(extrudeProfile(side, 0.05, 0.015), paint, 0, 0, dz * (W / 2 + 0.02));
    add(new THREE.BoxGeometry(2.55, 0.06, W), trimMat, -1.17, 0.96, 0);
    add(new THREE.BoxGeometry(0.05, 0.5, W + 0.06), paint, 0.12, 1.17, 0);
    add(new THREE.BoxGeometry(0.05, 0.48, W + 0.06), paint, -L, 1.18, 0);
    add(new THREE.BoxGeometry(2.5, 0.16, 0.9), trimMat, -1.1, 0.5, 0); // chassis
    const sack = std('#b9a77f', { roughness: 0.95 });
    for (let i = 0; i < 6; i++) { const sk = add(new RoundedBoxGeometry(0.62, 0.24, 0.42, 3, 0.1), sack, -0.5 - (i % 3) * 0.66, 1.11 + Math.floor(i / 3) * 0.2, i % 2 ? 0.3 : -0.3); sk.rotation.y = (i * 0.37) % 0.3 - 0.15; }
  }
  // common front and rear details
  add(new THREE.BoxGeometry(0.06, 0.32, 1.0), trimMat, L + 0.03, 0.82, 0);
  for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.03, 0.28, 0.03), chromeMat, L + 0.065, 0.82, -0.42 + i * 0.14, g, false);
  add(new THREE.BoxGeometry(0.2, 0.2, W + 0.16), trimMat, L + 0.05, 0.54, 0);
  add(new THREE.BoxGeometry(0.16, 0.18, W + 0.12), trimMat, -L - 0.04, 0.55, 0);
  for (const sz of [-1, 1]) {
    const hl = add(new RoundedBoxGeometry(0.06, 0.2, 0.28, 2, 0.03), std('#cfd6da', { metalness: 0.2, roughness: 0.12, emissive: 0xfff2d8, emissiveIntensity: 0 }), L + 0.03, 0.86, sz * 0.64, g, false); lights.push(hl);
    const tl = add(new THREE.BoxGeometry(0.05, pickup ? 0.26 : 0.32, 0.14), std('#6a0b0b', { roughness: 0.25, emissive: 0xff1a0a, emissiveIntensity: 0 }), -L - 0.01, pickup ? 1.0 : 1.08, sz * 0.74, g, false); lights.push(tl);
    const mir = add(new THREE.BoxGeometry(0.1, 0.16, 0.08), trimMat, pickup ? 1.36 : 0.92, 1.3, sz * (W / 2 + 0.13)); mir.rotation.y = 0.2 * sz;
    add(new THREE.BoxGeometry(pickup ? 0.9 : 1.6, 0.05, 0.18), trimMat, pickup ? 0.7 : -0.25, 0.42, sz * (W / 2 + 0.06)); // side step
  }
  for (const [wx, wz] of [[WF, 0.8], [WF, -0.8], [WR, 0.8], [WR, -0.8]]) {
    const t = add(TIRE_GEO, tireMat, wx, 0.383, wz); wheels.push(t);
    const r = add(RIM_GEO, rimMat, wx, 0.383, wz, g, false); wheels.push(r);
    add(HUB_GEO, chromeMat, wx, 0.383, wz, g, false);
  }
  const exhaust = add(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), std('#3a3634', { metalness: 0.7, roughness: 0.5 }), -L + 0.08, 0.36, 0.55, g, false); exhaust.rotation.z = Math.PI / 2;
  return { g, body, glassParts, wheels, lights, heat, exhaust };
}
const VEHICLES = [];
for (const [x, z, rot, color, kind, engine] of [[12, 5, 0.3, '#3d4a35', 'suv', true], [-9, -3, -1.2, '#d8d2c4', 'pickup', false]]) {
  const v = makeVehicle(color, kind);
  v.g.position.set(x, heightAt(x, z), z); v.g.rotation.y = rot; scene.add(v.g);
  regHeat(v.body, 0.44, 0.3); v.glassParts.forEach((m) => regHeat(m, 0.3, 0.2));
  v.heat.forEach(([, m]) => regHeat(m, engine ? 0.84 : 0.46, engine ? 0.8 : 0.3));
  v.wheels.forEach((w) => regHeat(w, engine ? 0.6 : 0.4, engine ? 0.55 : 0.25));
  regHeat(v.exhaust, engine ? 0.95 : 0.42, engine ? 0.95 : 0.28);
  v.g.traverse((c) => { if (c.isMesh && !swaps.some((s2) => s2.mesh === c)) regHeat(c, 0.42, 0.28); });
  occluders.push(v.body);
  addObb(x, z, kind === 'pickup' ? 2.5 : 2.15, 0.95, rot);
  if (engine) { // idling with dipped headlights after dark
    v.beam = new THREE.SpotLight(0xfff0d8, 0, 45, 0.55, 0.65, 2); v.beam.position.set(2.2, 0.9, 0); v.beam.target.position.set(12, -0.6, 0); v.g.add(v.beam, v.beam.target);
  }
  addAO(x, z, kind === 'pickup' ? 4.9 : 4.1, 1.7, rot, 0.85);
  VEHICLES.push(v);
}

/* ---------- windmill ---------- */
const windmill = new THREE.Group(), rotor = new THREE.Group();
{
  const mat = std('#6a6e70', { metalness: 0.6, roughness: 0.55 });
  const beam = (a, b, r) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat), true, false);
    m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    windmill.add(m); regHeat(m, 0.4, 0.2);
  };
  const H = 11, b = 1.7, t = 0.35, corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [cx, cz] of corners) beam(new THREE.Vector3(cx * b, 0, cz * b), new THREE.Vector3(cx * t, H, cz * t), 0.06);
  for (const lv of [0.25, 0.5, 0.75]) {
    const s = lerp(b, t, lv), y = H * lv;
    for (let i = 0; i < 4; i++) { const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4]; beam(new THREE.Vector3(ax * s, y, az * s), new THREE.Vector3(bx * s, y, bz * s), 0.04); beam(new THREE.Vector3(ax * s, y, az * s), new THREE.Vector3(bx * lerp(b, t, lv + 0.25), y + H * 0.25, bz * lerp(b, t, lv + 0.25)), 0.025); }
  }
  const head = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.4), mat)); head.position.set(0, H + 0.3, 0); windmill.add(head); regHeat(head, 0.42, 0.22);
  const tail = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.1, 1.9), std('#7d8184', { metalness: 0.5, roughness: 0.5 }))); tail.position.set(0, H + 0.45, 1.65); windmill.add(tail); regHeat(tail, 0.38, 0.2);
  rotor.position.set(0, H + 0.3, -0.85); windmill.add(rotor);
  const bladeGeo = new THREE.BoxGeometry(0.3, 1.5, 0.02);
  for (let i = 0; i < 16; i++) { const bl = shadowed(new THREE.Mesh(bladeGeo, mat)); const a = (i / 16) * Math.PI * 2; bl.position.set(Math.sin(a), Math.cos(a), 0); bl.rotation.z = -a; bl.rotation.y = 0.35; rotor.add(bl); regHeat(bl, 0.38, 0.2); }
  windmill.position.set(-62, heightAt(-62, -96), -96); windmill.rotation.y = 0.5; scene.add(windmill);
}

/* ---------- trees and bushes: bark trunks + alpha-tested leaf cards ---------- */
const leafTex = canvasTex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 150; i++) {
    const x = w / 2 + (Math.random() - 0.5) * w * 0.86, y = h / 2 + (Math.random() - 0.5) * h * 0.86;
    if (Math.hypot(x - w / 2, y - h / 2) > w * 0.46) continue;
    const s = 6 + Math.random() * 9, a = Math.random() * Math.PI, gr = 70 + Math.random() * 60;
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = `rgb(${Math.round(gr * 0.7)},${Math.round(gr)},${Math.round(gr * 0.42)})`;
    g.beginPath(); g.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
});
const leafMat = std(0xffffff, { map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, vertexColors: true });
const WIND = { uTime: { value: 0 } };
leafMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, FOG_UNI, WIND);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float sway;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
    float gust = 0.65 + 0.35 * sin(uTime * 0.23) * sin(uTime * 0.071 + 1.0);
    float bend = (sin(uTime * 1.3 + position.x * 0.07 + position.z * 0.05) * 0.6 + sin(uTime * 2.9 + position.x * 0.13) * 0.25) * gust;
    float flutter = sin(uTime * 8.5 + position.x * 4.1 + position.y * 3.3 + position.z * 2.7) * (0.4 + gust);
    transformed += vec3(bend * 0.16 + flutter * 0.02, flutter * 0.014, bend * 0.07 + flutter * 0.018) * sway;`);
};
const barkMat = std('#4a3e33', { roughness: 0.96 });
const trees = [];
for (let i = 0; i < 300 && trees.length < 95; i++) {
  const a = rand() * Math.PI * 2, r = 52 + Math.pow(rand(), 0.8) * 230, x = Math.sin(a) * r, z = -Math.cos(a) * r;
  if (inPoly(x, z, ZONE) || Math.hypot(x + 62, z + 96) < 9 || Math.abs(x) > HALF - 10 || Math.abs(z) > HALF - 10 || trackDist(x, z) < 5) continue;
  trees.push({ x, z, k: 0.75 + rand() * 0.7, bush: false });
}
for (let i = 0; i < 9; i++) trees.push({ x: -44 + rr(-6, 6), z: 32 + i * 6 + rr(-2, 2), k: 0.65 + rand() * 0.45, bush: false });
for (let i = 0; i < 200; i++) {
  let x, z; if (i < 45) { x = rr(-40, -25); z = rr(26, 72); } else { const a = rand() * Math.PI * 2, r = 34 + rand() * 230; x = Math.sin(a) * r; z = -Math.cos(a) * r; }
  if (trackDist(x, z) < 3 || Math.hypot(x, z) < 30) continue;
  trees.push({ x, z, k: 0.5 + rand() * 0.8, bush: true });
}
{
  const pos = [], nrm = [], uv = [], col = [], idx = [], swy = []; const trunkParts = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), c = new THREE.Vector3();
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (const t of trees) {
    const y = heightAt(t.x, t.z), k = t.k;
    const R = t.bush ? 1.0 * k : 3.6 * k, ry = t.bush ? 0.65 * k : 2.1 * k, cy = t.bush ? y + 0.55 * k : y + 3.4 * k + ry * 0.5;
    const lean = t.bush ? 0 : rr(-0.12, 0.12);
    if (!t.bush) {
      const trunk = new THREE.CylinderGeometry(0.2 * k, 0.36 * k, 3.8 * k, 7); trunk.translate(0, 1.9 * k, 0); trunk.rotateZ(lean); trunk.translate(t.x, y, t.z); trunkParts.push(trunk);
      for (let b = 0; b < 3; b++) {
        const ang = rand() * Math.PI * 2, len = 1.6 * k + rand() * k;
        const br = new THREE.CylinderGeometry(0.06 * k, 0.13 * k, len, 5); br.translate(0, len / 2, 0); br.rotateZ(0.9 + rand() * 0.3); br.rotateY(ang); br.translate(t.x - lean * 3 * k, y + 3.0 * k, t.z); trunkParts.push(br);
      }
    }
    const nCards = t.bush ? 10 : 38, tint = 0.8 + rand() * 0.35, tg = 0.9 + rand() * 0.2;
    c.set(t.x - lean * 3.4 * k, cy, t.z);
    for (let n = 0; n < nCards; n++) {
      const u1 = rand() * Math.PI * 2, u2 = Math.acos(rr(-0.6, 1)), rad = Math.pow(rand(), 0.35);
      const px = c.x + Math.cos(u1) * Math.sin(u2) * R * rad, py = c.y + Math.cos(u2) * ry * rad, pz = c.z + Math.sin(u1) * Math.sin(u2) * R * rad;
      const s = (t.bush ? 1.1 : 2.4) * k * rr(0.75, 1.2);
      q.setFromEuler(e.set(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI));
      const nx = px - c.x, ny = (py - c.y) * 1.6 + ry * 0.4, nz = pz - c.z, nl = Math.hypot(nx, ny, nz) || 1;
      const base = pos.length / 3; const shade = 0.75 + 0.35 * clamp((py - c.y) / ry * 0.5 + 0.5, 0, 1);
      for (const [a, b] of corners) {
        v.set(a * s, b * s, 0).applyQuaternion(q); pos.push(px + v.x, py + v.y, pz + v.z);
        nrm.push(nx / nl, ny / nl, nz / nl); uv.push(a + 0.5, b + 0.5); col.push(tint * shade * 0.95, tg * shade, tint * shade * 0.8);
        swy.push(clamp((py + v.y - y) / (t.bush ? 2.5 : 7.5), 0.08, 1));
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); lg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); lg.setAttribute('sway', new THREE.Float32BufferAttribute(swy, 1)); lg.setIndex(idx);
  const leaves = shadowed(new THREE.Mesh(lg, leafMat), true, true); scene.add(leaves); regHeat(leaves, 0.27, 0.21, leafTex);
  const trunks = shadowed(new THREE.Mesh(mergeGeometries(trunkParts), barkMat)); scene.add(trunks); regHeat(trunks, 0.34, 0.26);
}

/* ---------- rocks ---------- */
{
  const g = new THREE.DodecahedronGeometry(0.6, 1); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.8 + vnoise(p.getX(i) * 4 + 3, p.getZ(i) * 4 + p.getY(i) * 3) * 0.45; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
  g.computeVertexNormals();
  const rocks = shadowed(new THREE.InstancedMesh(g, std('#8a8378', { roughness: 0.92 }), 70));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), ps = new THREE.Vector3();
  for (let i = 0; i < 70; i++) { const a = rand() * Math.PI * 2, r = 25 + rand() * 200, x = Math.sin(a) * r, z = -Math.cos(a) * r, k = rr(0.35, 1.5); m.compose(ps.set(x, heightAt(x, z) + 0.05, z), q.setFromEuler(new THREE.Euler(rand(), rand() * 6, rand())), s.set(k, k * 0.6, k * rr(0.8, 1.2))); rocks.setMatrixAt(i, m); }
  scene.add(rocks); regHeat(rocks, 0.5, 0.31);
}

/* ---------- landing pad ---------- */
const PAD = new THREE.Vector3(6, heightAt(6, 33), 33);
{
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = '#4a4e50'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e8e3c8'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#e8e3c8'; g.font = '700 140px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 136);
  });
  const pad = shadowed(new THREE.Mesh(new THREE.CircleGeometry(2.4, 40), std(0xffffff, { map: t, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })), false, true);
  pad.rotation.x = -Math.PI / 2; pad.position.copy(PAD).add(new THREE.Vector3(0, 0.05, 0)); scene.add(pad); regHeat(pad, 0.5, 0.3);
}
