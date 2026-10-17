/* ---------- helmet view: 3D model built from primitives ---------- */
const hScene = new THREE.Scene();
hScene.background = new THREE.Color(0x0b1013);
const hCam = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
const hStereo = new THREE.StereoCamera(); hStereo.eyeSep = 0.08;
hScene.add(new THREE.HemisphereLight(0xdfefff, 0x20262a, 0.5));
hScene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xfff4e6, 2.6); key.position.set(-3, 4, -4); hScene.add(key);
const fill = new THREE.DirectionalLight(0xb8d4ff, 0.9); fill.position.set(4, 1, -2); hScene.add(fill);
const rim = new THREE.DirectionalLight(0x9fe8ff, 1.6); rim.position.set(0, 3, 5); hScene.add(rim);
{
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.MeshStandardMaterial({ color: 0x141b1f, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.75; hScene.add(floor);
  const grid = new THREE.PolarGridHelper(3.4, 16, 6, 64, 0x2a3a40, 0x1e2a2f); grid.position.y = -1.74; hScene.add(grid);
}
const helmet = new THREE.Group(); hScene.add(helmet);
const hParts = []; // { g, base, dir, dist, info, meshes }
const hstd = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.05, ...o });
function part(info, dir, dist, build) {
  const g = new THREE.Group(); helmet.add(g); build(g);
  const meshes = []; g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); meshes.push(o); o.userData.part = g; } });
  const p = { g, base: g.position.clone(), dir: new THREE.Vector3(...dir).normalize(), dist, info, meshes, anchor: info.anchor ? new THREE.Vector3(...info.anchor) : null };
  g.userData.hp = p; hParts.push(p); return p;
}
const M = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const lensMat = () => hstd(0x0c0e10, { roughness: 0.08, metalness: 0.6 });

part({ name: 'Bump helmet shell', tag: 'Base', role: 'The frame that every part mounts to. A bump helmet is light and has rails, but it is not bulletproof.', spec: 'FAST-style, ARC rails, NVG shroud, 0.5–0.9 kg', price: '₹4k–8k budget', anchor: [0, 0.75, 0] }, [0, 0, 0], 0, (g) => {
  const shell = M(new THREE.SphereGeometry(1, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.56), hstd(0x8a7a5c, { roughness: 0.85 }));
  shell.scale.set(0.95, 0.9, 1.08); g.add(shell);
  const liner = M(new THREE.SphereGeometry(0.97, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.56), hstd(0x1c1e1f, { side: THREE.BackSide }));
  liner.scale.set(0.95, 0.9, 1.08); g.add(liner);
  const rimG = new THREE.TorusGeometry(1, 0.025, 8, 80); rimG.rotateX(Math.PI / 2);
  const rimM = M(rimG, hstd(0x3a3a34), 0, Math.cos(Math.PI * 0.56) * 0.9, 0); rimM.scale.set(0.95 * Math.sin(Math.PI * 0.56), 1, 1.08 * Math.sin(Math.PI * 0.56)); g.add(rimM);
});
part({ name: 'ARC rails', tag: 'Mounting', role: 'Side rails that hold the cameras, the mic and the cable clips.', spec: 'ARC-compatible polymer', price: '₹1k–3k', anchor: [0.92, 0.12, 0] }, [1, 0, 0], 0.55, (g) => {
  for (const sx of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 12; i++) { const a = lerp(-0.95, 1.05, i / 12); pts.push(new THREE.Vector3(sx * Math.cos(a) * 0.93, 0.14 + Math.sin(i / 12 * Math.PI) * 0.05, -Math.sin(a) * 1.05)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 6), hstd(0x4a4436)));
  }
});
part({ name: 'NVG shroud', tag: 'Mounting', role: 'The front bracket. It holds the sensor bar and the glasses over your eyes.', spec: 'Standard 3-hole shroud', price: '₹1k–3k', anchor: [0, 0.42, -1.0] }, [0, 0.35, -1], 0.5, (g) => {
  const s = M(new THREE.BoxGeometry(0.36, 0.24, 0.06), hstd(0x2c2e2c), 0, 0.42, -0.99); s.rotation.x = -0.42; g.add(s);
  g.add(M(new THREE.BoxGeometry(0.12, 0.26, 0.08), hstd(0x2c2e2c), 0, 0.26, -1.08));
});
part({ name: 'Depth camera (OAK-D Pro W)', tag: 'Sensors', role: 'Two cameras measure distance like human eyes. They build the 3D map and track your head.', spec: 'Wide stereo, IR projector, IMU, USB-C', price: '≈ ₹40k', anchor: [0, 0.12, -1.3] }, [0, -0.1, -1], 0.85, (g) => {
  g.add(M(new THREE.BoxGeometry(0.95, 0.24, 0.26), hstd(0x262a2e, { roughness: 0.55 }), 0, 0.12, -1.18));
  for (const x of [-0.32, 0, 0.32]) {
    const ring = M(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 24), hstd(0x46494c, { metalness: 0.5, roughness: 0.4 }), x, 0.12, -1.315); ring.rotation.x = Math.PI / 2; g.add(ring);
    const l = M(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 24), lensMat(), x, 0.12, -1.325); l.rotation.x = Math.PI / 2; g.add(l);
  }
  for (const x of [-0.16, 0.16]) { const ir = M(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), hstd(0x40201c, { roughness: 0.2 }), x, 0.12, -1.315); ir.rotation.x = Math.PI / 2; g.add(ir); }
});
part({ name: 'Thermal camera (Lepton 3.5)', tag: 'Sensors', role: 'Sees heat instead of light, so it works in full darkness and in smoke.', spec: '160 × 120 px, 9 Hz; Boson upgrade 60 Hz', price: '₹8k–15k', anchor: [0.3, 0.37, -1.2] }, [0.7, 0.7, -0.6], 0.7, (g) => {
  g.add(M(new THREE.BoxGeometry(0.18, 0.17, 0.2), hstd(0x30302c), 0.3, 0.37, -1.13));
  const l = M(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 20), hstd(0x2a2232, { roughness: 0.15, metalness: 0.7 }), 0.3, 0.37, -1.26); l.rotation.x = Math.PI / 2; g.add(l);
});
part({ name: 'Low-light camera', tag: 'Sensors', role: 'A STARVIS sensor that sees in very dim light. It gives the Low Light vision mode.', spec: 'IMX462 / IMX585, wide lens', price: '₹3k–8k', anchor: [-0.3, 0.37, -1.2] }, [-0.7, 0.7, -0.6], 0.7, (g) => {
  g.add(M(new THREE.BoxGeometry(0.16, 0.15, 0.18), hstd(0x30302c), -0.3, 0.37, -1.12));
  const l = M(new THREE.CylinderGeometry(0.055, 0.06, 0.07, 20), lensMat(), -0.3, 0.37, -1.24); l.rotation.x = Math.PI / 2; g.add(l);
});
part({ name: 'Side cameras', tag: 'Sensors', role: 'Two low-light cameras for the side views. They also feed the rearview mirror.', spec: '2 × STARVIS, 120° lenses', price: '₹6k–16k', anchor: [-1.0, 0.3, 0.15] }, [-1, 0.25, 0.2], 0.6, (g) => {
  for (const sx of [-1, 1]) {
    g.add(M(new THREE.BoxGeometry(0.13, 0.14, 0.16), hstd(0x30302c), sx * 0.96, 0.3, 0.15));
    const l = M(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 16), lensMat(), sx * 1.04, 0.3, 0.18); l.rotation.z = Math.PI / 2; g.add(l);
  }
});
part({ name: 'XREAL One Pro glasses', tag: 'Display', role: 'See-through glasses. Two micro-OLED screens put the HUD over the real world.', spec: '1080p per eye, 57° view, 120 Hz, 700 nits', price: '$599', anchor: [0.24, -0.26, -1.26] }, [0, -0.7, -1], 0.9, (g) => {
  const frame = hstd(0x15181a, { roughness: 0.4 });
  g.add(M(new THREE.BoxGeometry(1.0, 0.07, 0.07), frame, 0, -0.12, -1.24));
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape(); const w = 0.42, h = 0.25, r = 0.08;
    sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); sh.lineTo(w / 2, h / 2 - r); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    sh.lineTo(-w / 2 + r, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const lens = M(new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: false }), hstd(0x16252b, { transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.4 }), sx * 0.24, -0.27, -1.27);
    g.add(lens);
    const hudGlow = M(new THREE.PlaneGeometry(0.26, 0.12), new THREE.MeshBasicMaterial({ color: 0x3fe0e6, transparent: true, opacity: 0.18, side: THREE.DoubleSide }), sx * 0.24, -0.27, -1.24);
    hudGlow.userData.glow = true; g.add(hudGlow);
    const arm = M(new THREE.BoxGeometry(0.04, 0.045, 0.7), frame, sx * 0.49, -0.16, -0.9); arm.rotation.y = sx * 0.08; g.add(arm);
  }
  g.add(M(new THREE.BoxGeometry(0.08, 0.14, 0.06), frame, 0, -0.02, -1.24));
});
part({ name: 'GNSS antenna (ZED-F9P)', tag: 'Navigation', role: 'Receives satellite signals for your position on the map and for team sharing.', spec: 'Dual-band; centimetres with RTK', price: '₹20k–30k', anchor: [0, 0.98, 0.15] }, [0, 1, 0], 0.6, (g) => {
  g.add(M(new THREE.CylinderGeometry(0.16, 0.17, 0.07, 32), hstd(0xd9dcd8, { roughness: 0.5 }), 0, 0.95, 0.15));
  g.add(M(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), hstd(0x26292b), 0, 0.995, 0.15));
});
const fanParts = [];
part({ name: 'Jetson Orin NX 16GB', tag: 'Compute', role: 'The computer. It runs tracking, the 3D map, AI and draws the HUD. It also balances the front weight.', spec: 'Up to 157 TOPS, 10–25 W', price: '$999 module list', anchor: [0, 0.22, 1.28] }, [0, 0.15, 1], 0.8, (g) => {
  g.add(M(new THREE.BoxGeometry(0.64, 0.42, 0.22), hstd(0x24282b, { roughness: 0.5, metalness: 0.2 }), 0, 0.22, 1.1));
  for (let i = 0; i < 9; i++) g.add(M(new THREE.BoxGeometry(0.012, 0.34, 0.08), hstd(0x5b6064, { metalness: 0.6, roughness: 0.35 }), -0.24 + i * 0.06, 0.22, 1.25));
  const fan = M(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 6), hstd(0x111315), 0, 0.22, 1.3); fan.rotation.x = Math.PI / 2; g.add(fan); fanParts.push(fan);
  const led = M(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshBasicMaterial({ color: 0x5fe08c }), 0.27, 0.38, 1.215); g.add(led);
});
part({ name: 'Rear radar + rear camera', tag: 'Sensors', role: 'The radar sees movement behind you. The camera feeds the rearview mirror.', spec: 'HLK-LD2450 24 GHz, up to 3 people', price: '₹1k–2k + camera', anchor: [0, -0.12, 1.16] }, [0, -0.5, 1], 0.65, (g) => {
  g.add(M(new THREE.BoxGeometry(0.32, 0.15, 0.05), hstd(0x1b2a24), 0, -0.12, 1.13));
  const l = M(new THREE.CylinderGeometry(0.04, 0.045, 0.05, 16), lensMat(), 0.2, -0.12, 1.17); l.rotation.x = Math.PI / 2; g.add(l);
});
part({ name: 'LoRa mesh radio', tag: 'Comms', role: 'Shares team positions and pings over kilometres with no towers.', spec: 'Meshtastic, 865–867 MHz (licence-exempt)', price: '₹2k–4k', anchor: [0.48, 1.0, 1.15] }, [0.6, 0.6, 0.6], 0.6, (g) => {
  g.add(M(new THREE.BoxGeometry(0.14, 0.1, 0.16), hstd(0x2a3036), 0.34, 0.5, 0.95));
  const w = M(new THREE.CylinderGeometry(0.012, 0.018, 0.85, 8), hstd(0x111214), 0.42, 0.9, 1.08); w.rotation.x = 0.35; w.rotation.z = -0.15; g.add(w);
});
part({ name: 'Mic array', tag: 'Audio', role: 'Four microphones for voice commands and for the direction of sounds.', spec: 'ReSpeaker, 4 mics, USB', price: '₹6k–9k', anchor: [-0.86, 0.02, -0.62] }, [-1, 0, -0.5], 0.6, (g) => {
  const d = M(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 24), hstd(0x2a2d30), -0.82, 0.02, -0.6); d.rotation.z = Math.PI / 2; d.rotation.y = -0.6; g.add(d);
});
part({ name: 'Bone-conduction pads', tag: 'Audio', role: 'Play alerts through your cheekbones, so your ears stay open.', spec: 'Open-ear, Bluetooth', price: '₹8k–12k', anchor: [0.84, -0.5, -0.05] }, [1, -0.6, 0], 0.55, (g) => {
  for (const sx of [-1, 1]) {
    const pad = M(new THREE.CapsuleGeometry(0.06, 0.08, 4, 12), hstd(0x1e2124), sx * 0.84, -0.5, -0.05); g.add(pad);
    g.add(M(new THREE.BoxGeometry(0.03, 0.42, 0.06), hstd(0x3b3a33), sx * 0.86, -0.28, -0.05));
  }
});
part({ name: 'Counterweight pouch', tag: 'Balance', role: 'Balances the front sensors so the helmet does not tip forward.', spec: '200–500 g', price: '₹500–1.5k', anchor: [0, -0.38, 1.08] }, [0, -0.8, 0.8], 0.6, (g) => {
  const p = M(new THREE.BoxGeometry(0.5, 0.2, 0.16), hstd(0x55573f, { roughness: 0.95 }), 0, -0.36, 1.0); g.add(p);
});
// cables are not a part; they hide when the helmet is exploded
const cables = new THREE.Group(); helmet.add(cables);
{
  const cm = hstd(0x121314, { roughness: 0.6 });
  const tube = (pts, r = 0.018) => cables.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 48, r, 6), cm));
  tube([[-0.4, 0.2, -1.1], [-0.8, 0.45, -0.55], [-0.88, 0.55, 0.2], [-0.5, 0.45, 0.95], [-0.22, 0.3, 1.0]]);
  tube([[0.38, 0.4, -1.05], [0.78, 0.5, -0.5], [0.86, 0.55, 0.25], [0.45, 0.42, 0.98], [0.2, 0.3, 1.0]]);
  tube([[0.1, 0.05, 1.12], [0.15, -0.5, 1.15], [0.2, -1.1, 1.0], [0.25, -1.6, 0.8]], 0.024);
  const plug = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.08), hstd(0xffb547, { roughness: 0.5 })); plug.position.set(0.25, -1.62, 0.8); cables.add(plug);
}
const vestInfo = { name: '4S 21700 battery pack', tag: 'Power · on the vest', role: 'Powers everything for about 3 hours. The cable runs from the Jetson down to the vest.', spec: '14.4 V, about 130 Wh, with BMS', price: '₹8k–12k', anchor: [0.25, -1.62, 0.8] };
cables.children[cables.children.length - 1].userData.vest = true;

const hState = { theta: Math.PI + 0.75, phi: 1.2, dist: 5.4, explode: 0, explodeT: 0, labels: true, spin: !REDUCED, idle: 0, hover: null, sel: null };
function helmetOrbit(dx, dy) { hState.theta -= dx * 0.008; hState.phi = clamp(hState.phi - dy * 0.008, 0.25, 2.5); hState.idle = 0; }
function helmetZoom(d) { hState.dist = clamp(hState.dist * (1 + d * 0.001), 3, 9); hState.idle = 0; }
const hRay = new THREE.Raycaster(), hNdc = new THREE.Vector2();
function pickPart(cx, cy) {
  const W = VW, H = VH; let x = cx, w = W, cam = hCam;
  if (settings.stereo) { w = W / 2; if (cx > W / 2) { x = cx - W / 2; cam = hStereo.cameraR; } else cam = hStereo.cameraL; }
  hNdc.set((x / w) * 2 - 1, -(cy / H) * 2 + 1); hRay.setFromCamera(hNdc, cam);
  const meshes = hParts.flatMap((p) => p.meshes).concat(cables.children.filter((c) => c.userData.vest));
  const hit = hRay.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  if (hit.object.userData.vest) return { info: vestInfo, meshes: [hit.object] };
  return hit.object.userData.part.userData.hp;
}
function setHighlight(p, on) { if (!p) return; p.meshes.forEach((m) => { if (m.material.emissive) { m.material.emissive.set(on ? 0x1d6f72 : 0x000000); m.material.emissiveIntensity = on ? 0.55 : 0; } }); }
function helmetHover(cx, cy) { const p = pickPart(cx, cy); if (p !== hState.hover) { if (hState.hover !== hState.sel) setHighlight(hState.hover, false); hState.hover = p; setHighlight(p, true); showPartCard(); } glCanvas.style.cursor = p ? 'pointer' : 'grab'; }
function helmetClick(cx, cy) { const p = pickPart(cx, cy); if (hState.sel && hState.sel !== p) setHighlight(hState.sel, false); hState.sel = p; setHighlight(p, true); showPartCard(); }
function showPartCard() {
  const p = hState.hover || hState.sel, card = $('#hcard');
  if (!p || state.view !== 'helmet') { card.hidden = true; return; }
  card.hidden = false;
  $('#hc-tag').textContent = p.info.tag; $('#hc-name').textContent = p.info.name; $('#hc-role').textContent = p.info.role;
  $('#hc-spec').textContent = p.info.spec; $('#hc-price').textContent = p.info.price;
}
function setExplode(on) { hState.explodeT = on ? 1 : 0; $('#hb-explode').setAttribute('aria-pressed', String(on)); $('#hb-explode').textContent = on ? 'Assemble' : 'Explode'; if (on) bus.emit('explode'); }

function updateHelmet(dt) {
  hState.idle += dt;
  if (hState.spin && hState.idle > 2.5) hState.theta += dt * 0.22;
  hState.explode = damp(hState.explode, hState.explodeT, 4, dt);
  const e = hState.explode * hState.explode * (3 - 2 * hState.explode);
  for (const p of hParts) p.g.position.copy(p.base).addScaledVector(p.dir, p.dist * e);
  cables.visible = hState.explode < 0.08;
  fanParts.forEach((f) => (f.rotation.y += dt * 9));
  helmet.traverse((o) => { if (o.userData.glow) o.material.opacity = 0.12 + 0.1 * (0.5 + 0.5 * Math.sin(state.t * 2.2)); });
  const asp = (settings.stereo ? VW / 2 : VW) / VH, dist = hState.dist * (asp < 1 ? clamp(0.9 / asp, 1, 2.2) : 1); // pull back on portrait screens
  const s = Math.sin(hState.phi);
  hCam.position.set(dist * s * Math.sin(hState.theta), dist * Math.cos(hState.phi), dist * s * Math.cos(hState.theta));
  hCam.lookAt(0, 0, 0);
}
function renderHelmet() {
  const W = VW, H = VH, st = settings.stereo, ew = st ? W / 2 : W;
  hCam.aspect = ew / H; hCam.updateProjectionMatrix(); hCam.updateMatrixWorld();
  let cams;
  if (st) { hStereo.update(hCam); cams = [[0, hStereo.cameraL], [W / 2, hStereo.cameraR]]; } else cams = [[0, hCam]];
  const u = postMat.uniforms;
  for (const [x, c] of cams) {
    renderer.setRenderTarget(rtScene); renderer.render(hScene, c);
    renderer.setRenderTarget(null); renderer.setScissorTest(true); renderer.setViewport(x, 0, ew, H); renderer.setScissor(x, 0, ew, H);
    u.tScene.value = rtScene.texture; u.tBloom1.value = blackTex; u.tBloom2.value = blackTex; u.uBloom.value = 0; u.uMode.value = 0; u.uExposure.value = 1.0;
    u.tRays.value = blackTex; u.uRays.value = 0; u.tAdapt.value = blackTex; u.uAdaptOn.value = 0; u.tDirt.value = blackTex; u.uFx.value = 0; u.uShimmer.value = 0;
    u.uGradeLo.value.set(1, 1, 1); u.uGradeHi.value.set(1, 1, 1); u.uSat.value = 1;
    u.uGlasses.value = 0; u.uSharp.value = 0.1; u.uTime.value = state.t; u.uRes.value.set(ew * DPR, H * DPR); u.uTexel.value.set(1 / rtScene.width, 1 / rtScene.height);
    renderer.render(postScene, postCam);
    renderer.setScissorTest(false);
  }
  renderer.setViewport(0, 0, W, H);
  eyes = cams.map(([x, c]) => ({ x, w: ew, cam: c }));
  eyes.forEach((e) => { e.cam.matrixWorldInverse.copy(e.cam.matrixWorld).invert(); e.L = { ex: e.x, ew: e.w, eh: H }; });
}
const _ha = new THREE.Vector3();
function drawHelmetLabels(ctx) {
  if (!hState.labels || hState.explode < 0.5) return;
  const a = sstep(0.5, 0.95, hState.explode);
  for (const e of eyes) {
    const L = e.L, u = clamp(Math.min(L.ew, L.eh) / 70, 6, 13);
    const items = [];
    for (const p of hParts) {
      if (!p.anchor) continue;
      if (L.ew < 520 && hState.hover !== p && hState.sel !== p) continue; // narrow screens: label only the part you touch
      _ha.copy(p.anchor).addScaledVector(p.dir, p.dist * hState.explode);
      const q = proj(_ha.x, _ha.y, _ha.z, e.cam, L); if (q.front <= 0) continue;
      items.push({ p, x: q.x, y: q.y });
    }
    const cx = L.ex + L.ew / 2;
    ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.rect(L.ex, 0, L.ew, L.eh); ctx.clip();
    for (const side of [-1, 1]) {
      const col = items.filter((it) => (it.x < cx) === (side < 0)).sort((s, t) => s.y - t.y);
      const card = $('#hcard'), cardB = side < 0 && !card.hidden ? card.getBoundingClientRect().bottom + 14 : 0;
      const gap = u * 2.7, top = Math.max(L.eh * 0.13, cardB), bottom = L.eh * 0.86;
      const ys = []; col.forEach((it, i) => { ys.push(Math.max(clamp(it.y, top, bottom), i ? ys[i - 1] + gap : top)); });
      const over = ys.length ? ys[ys.length - 1] - bottom : 0;
      if (over > 0) for (let i = 0; i < ys.length; i++) ys[i] = Math.max(top + i * Math.min(gap, (bottom - top) / Math.max(1, ys.length - 1)), ys[i] - over);
      col.forEach((it, i) => {
        const y = ys[i], lx = side < 0 ? L.ex + Math.max(u * 2, L.ew * 0.05) : L.ex + L.ew - Math.max(u * 2, L.ew * 0.05);
        const sel = hState.hover === it.p || hState.sel === it.p;
        ctx.font = F(600, u * 1.05); const tw = ctx.measureText(it.p.info.name).width;
        const tx0 = side < 0 ? lx : lx - tw, tx1 = side < 0 ? lx + tw : lx;
        const join = side < 0 ? tx1 + u * 0.4 : tx0 - u * 0.4;
        ctx.strokeStyle = sel ? COL.cyan : 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tx0, y); ctx.lineTo(join, y); ctx.lineTo(it.x, it.y); ctx.stroke();
        ctx.fillStyle = sel ? COL.cyan : '#fff'; ctx.beginPath(); ctx.arc(it.x, it.y, 2.5, 0, 7); ctx.fill();
        label(ctx, it.p.info.name, lx, y - u * 0.25, sel ? COL.cyan : '#fff', F(600, u * 1.05), side < 0 ? 'left' : 'right', 'bottom');
        label(ctx, it.p.info.tag.toUpperCase(), lx, y + u * 0.3, 'rgba(255,255,255,0.55)', F(500, u * 0.75, true), side < 0 ? 'left' : 'right', 'top');
      });
    }
    ctx.restore();
  }
}
