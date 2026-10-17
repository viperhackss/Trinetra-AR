/* ---------- player ---------- */
const START = { x: 0, z: 44, yaw: 0 };
const player = { pos: new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z), yaw: START.yaw, pitch: 0, stance: 0, eye: 1.7, bob: 0, speed: 0 };

/* ---------- character asset (Mixamo rig, recoloured to coyote tan) ---------- */
let SOLDIER = null;
const SOLDIER_FLIP = 0; // the rig already faces -Z, the sim's "forward"
const WALK_SPEED = 1.6, RUN_SPEED = 4.2; // m/s at timeScale 1, measured from stance-foot travel in each clip
function loadSoldier(onProg) {
  return new Promise((res) => new GLTFLoader(manager).load(ASSETS + 'soldier.gltf.json', (g) => { SOLDIER = g; res(); }, onProg, () => res()));
}
const lam = (c) => std(c, { roughness: 0.9 }); // fallback (procedural) human only

/* fallback procedural human, used only if the character file does not load */
function makeHuman(o) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  const upper = new THREE.Group(); hips.add(upper);
  const parts = [];
  const add = (parent, geo, color, x, y, z, heatD, heatN) => { const m = shadowed(new THREE.Mesh(geo, lam(color))); m.position.set(x, y, z); parent.add(m); regHeat(m, heatD, heatN); parts.push(m); return m; };
  add(upper, new THREE.BoxGeometry(0.4, 0.58, 0.24), o.shirt, 0, 0.31, 0, 0.82, 0.86);
  add(upper, new THREE.BoxGeometry(0.45, 0.4, 0.3), o.vest, 0, 0.34, 0, 0.7, 0.74);
  const neck = new THREE.Group(); neck.position.y = 0.66; upper.add(neck);
  add(neck, new THREE.SphereGeometry(0.115, 12, 10), o.skin, 0, 0.06, 0, 0.96, 0.98);
  add(neck, new THREE.SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), o.helmet, 0, 0.09, 0.005, 0.62, 0.66);
  const limb = (parent, x, y, w, len, color, hd, hn) => {
    const piv = new THREE.Group(); piv.position.set(x, y, 0); parent.add(piv);
    add(piv, new THREE.BoxGeometry(w, len, w), color, 0, -len / 2, 0, hd, hn);
    const joint = new THREE.Group(); joint.position.y = -len; piv.add(joint);
    return { piv, joint };
  };
  const armL = limb(upper, -0.27, 0.56, 0.1, 0.3, o.shirt, 0.8, 0.84), armR = limb(upper, 0.27, 0.56, 0.1, 0.3, o.shirt, 0.8, 0.84);
  add(armL.joint, new THREE.BoxGeometry(0.09, 0.28, 0.09), o.shirt, 0, -0.14, 0, 0.84, 0.88);
  add(armR.joint, new THREE.BoxGeometry(0.09, 0.28, 0.09), o.shirt, 0, -0.14, 0, 0.84, 0.88);
  const legL = limb(hips, -0.1, 0, 0.16, 0.46, o.pants, 0.78, 0.82), legR = limb(hips, 0.1, 0, 0.16, 0.46, o.pants, 0.78, 0.82);
  add(legL.joint, new THREE.BoxGeometry(0.14, 0.46, 0.14), o.pants, 0, -0.23, 0, 0.74, 0.78);
  add(legR.joint, new THREE.BoxGeometry(0.14, 0.46, 0.14), o.pants, 0, -0.23, 0, 0.74, 0.78);
  return { kind: 'box', root, body, hips, upper, armL, armR, legL, legR, parts };
}
function poseHuman(h, phase, walk, stance) {
  const k = clamp(stance, 0, 1), p = clamp(stance - 1, 0, 1), sw = Math.sin(phase) * walk * (1 - k);
  h.legL.piv.rotation.x = lerp(sw * 0.55, 1.45, k) * (1 - p);
  h.legL.joint.rotation.x = lerp(-Math.max(0, -Math.sin(phase)) * 0.75 * walk, -1.45, k) * (1 - p);
  h.legR.piv.rotation.x = lerp(-sw * 0.55, -0.12, k) * (1 - p);
  h.legR.joint.rotation.x = lerp(-Math.max(0, Math.sin(phase)) * 0.75 * walk, -1.55, k) * (1 - p);
  h.armL.piv.rotation.x = lerp(lerp(-sw * 0.45, 0.65, k), 2.5, p); h.armL.joint.rotation.x = lerp(-0.25 - 0.6 * k, -0.4, p);
  h.armR.piv.rotation.x = lerp(lerp(sw * 0.45, 0.7, k), 2.5, p); h.armR.joint.rotation.x = lerp(-0.25 - 0.7 * k, -0.4, p);
  h.upper.rotation.x = -0.22 * k * (1 - p);
  h.hips.position.y = lerp(lerp(0.95, 0.53, k), 0.95, p);
  h.body.rotation.x = -Math.PI / 2 * p;
  h.body.position.y = 0.14 * p;
}

/* skinned soldier: Idle / Walk / Run clips blended by speed, kneel and prone layered on top */
function makeSoldier() {
  const root = new THREE.Group(), pivot = new THREE.Group(), model = SkeletonUtils.clone(SOLDIER.scene);
  root.add(pivot); pivot.add(model); model.rotation.y = SOLDIER_FLIP;
  const parts = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const visor = /visor/i.test(o.name);
    regHeat(o, visor ? 0.58 : 0.8, visor ? 0.62 : 0.86); parts.push(o);
  });
  const mixer = new THREE.AnimationMixer(model), act = {};
  for (const n of ['Idle', 'Walk', 'Run']) {
    const clip = SOLDIER.animations.find((a) => a.name === n);
    const a = mixer.clipAction(clip); a.play(); a.setEffectiveWeight(n === 'Idle' ? 1 : 0); a.time = rand() * clip.duration; act[n] = a;
  }
  const B = (n) => model.getObjectByName('mixamorig' + n);
  const bones = {};
  for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']) bones[n] = B(n);
  return { kind: 'rig', root, pivot, model, mixer, act, bones, parts, frameQ: new THREE.Quaternion() };
}
const _pq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _ax = new THREE.Vector3();
// rotate a bone about an axis given in the character's own frame (+X right, +Y up, -Z forward)
function rotBone(h, bone, ax, ay, az, ang) {
  if (!bone || Math.abs(ang) < 1e-4) return;
  bone.parent.getWorldQuaternion(_pq);
  _ax.set(ax, ay, az).applyQuaternion(h.frameQ).applyQuaternion(_pq.invert()).normalize();
  bone.quaternion.premultiply(_rq.setFromAxisAngle(_ax, ang));
  bone.updateMatrixWorld(true);
}
const KNEEL_DROP = 0.5;
function poseSoldier(h, m, dt) {
  const sp = m.moving ? m.curSpeed : 0, run = sstep(2.0, 3.0, sp);
  h.act.Idle.setEffectiveWeight(1 - m.walk);
  h.act.Walk.setEffectiveWeight(m.walk * (1 - run));
  h.act.Run.setEffectiveWeight(m.walk * run);
  h.act.Walk.timeScale = sp > 0.1 ? clamp(sp / WALK_SPEED, 0.6, 1.6) : 1;
  h.act.Run.timeScale = sp > 0.1 ? clamp(sp / RUN_SPEED, 0.6, 1.4) : 1;
  h.mixer.update(dt);
  const p = clamp(m.stance - 1, 0, 1), k = clamp(m.stance, 0, 1) * (1 - p);
  h.pivot.rotation.x = -Math.PI / 2 * p;
  h.pivot.position.set(0, -KNEEL_DROP * k + 0.15 * p, 0.92 * p);
  if (k < 0.002 && p < 0.002) return;
  h.root.updateMatrixWorld(true);
  h.pivot.getWorldQuaternion(h.frameQ);
  const b = h.bones, D = DEG;
  // kneel: left foot planted forward, right knee on the ground, torso slightly forward, hands at the chest
  rotBone(h, b.Spine, 1, 0, 0, (-10 * k + 16 * p) * D);
  rotBone(h, b.Spine1, 1, 0, 0, (-6 * k + 8 * p) * D);
  rotBone(h, b.Neck, 1, 0, 0, (6 * k + 22 * p) * D);
  rotBone(h, b.Head, 1, 0, 0, (8 * k + 26 * p) * D);
  rotBone(h, b.LeftArm, 1, 0, 0, (38 * k + 100 * p) * D);
  rotBone(h, b.LeftForeArm, 1, 0, 0, (62 * k + 82 * p) * D);
  rotBone(h, b.RightArm, 1, 0, 0, (24 * k + 100 * p) * D);
  rotBone(h, b.RightForeArm, 1, 0, 0, (78 * k + 82 * p) * D);
  rotBone(h, b.LeftUpLeg, 1, 0, 0, 88 * k * D); rotBone(h, b.LeftUpLeg, 0, 0, 1, -9 * p * D);
  rotBone(h, b.LeftLeg, 1, 0, 0, (-88 * k + 14 * p) * D);
  rotBone(h, b.RightUpLeg, 1, 0, 0, 4 * k * D); rotBone(h, b.RightUpLeg, 0, 0, 1, 9 * p * D);
  rotBone(h, b.RightLeg, 1, 0, 0, (-86 * k + 14 * p) * D);
  rotBone(h, b.RightFoot, 1, 0, 0, -20 * k * D);
}

/* ---------- teammates ---------- */
const MATES = [];
const MATE_STYLE = { shirt: '#5f6a52', vest: '#4a5240', pants: '#57604b', skin: '#a77a5c', helmet: '#7c705a' };
function addMate(call, path, speed) {
  const h = SOLDIER ? makeSoldier() : makeHuman(MATE_STYLE); scene.add(h.root);
  const m = { call, h, path, wp: 1, pos: new THREE.Vector3(path[0][0], 0, path[0][1]), yaw: 0, speed, curSpeed: speed, phase: rand() * 6, walk: 0, wait: 0,
    stance: 0, stanceTarget: 0, rep: null, err: new THREE.Vector2(), trail: [], lastRep: -1, lastTrail: -1, override: null, lostAlerted: false, behindAlerted: -99, occl: 0 };
  m.pos.y = heightAt(m.pos.x, m.pos.z);
  MATES.push(m); return m;
}
function initMates() {
  addMate('ALPHA-2', [[-4, -10], [-19, -11, 5, 1], [-20, -21], [-6, -21.5, 7, 2], [5, -14], [2, -6]], 1.3);
  addMate('ALPHA-3', [[14, -1], [22, 1], [22, -14, 6, 1], [13, -26], [2, -27, 5, 0], [9, -12]], 1.4);
  addMate('ALPHA-4', [[-16, 11], [-27, 9, 6, 2], [-27, -5], [-18, 15], [-6, 17, 5, 1], [-6, 31]], 1.2);
}

function headHeight(stance) { return [1.72, 1.08, 0.32][stance]; }

function updateMate(m, dt) {
  const target = m.override ? m.override[m.override.i] : m.path[m.wp];
  if (m.wait > 0) {
    m.wait -= dt; m.moving = false;
    if (m.wait <= 0) { m.stanceTarget = 0; m.wp = (m.wp + 1) % m.path.length; }
  } else if (target) {
    const dx = target[0] - m.pos.x, dz = target[1] - m.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.45) {
      if (m.override) { m.override.i++; if (m.override.i >= m.override.length) m.override = null; }
      else if (target[2]) { m.wait = target[2]; m.stanceTarget = target[3] || 0; }
      else m.wp = (m.wp + 1) % m.path.length;
    } else if (m.stance < 0.15) {
      const want = m.override ? 2.7 : m.speed;
      // ease in and out of the walk so the feet do not slide
      m.curSpeed = damp(m.curSpeed, want * clamp(d / 1.2, 0.35, 1), 3, dt);
      const sp = m.curSpeed * m.walk;
      m.pos.x += (dx / d) * sp * dt; m.pos.z += (dz / d) * sp * dt;
      m.yaw = dampAngle(m.yaw, Math.atan2(dx, -dz), 5, dt);
      m.moving = Math.abs(wrap180((m.yaw - Math.atan2(dx, -dz)) / DEG)) < 50 || m.walk > 0.2;
    } else m.moving = false;
  }
  collide(m.pos, 0.32);
  m.pos.y = heightAt(m.pos.x, m.pos.z);
  m.stance = damp(m.stance, m.stanceTarget, 2.6, dt);
  m.walk = damp(m.walk, m.moving ? 1 : 0, 4, dt);
  if (m.moving) m.phase += m.curSpeed * dt * 3.6;
  m.h.root.position.copy(m.pos); m.h.root.rotation.y = -m.yaw;
  if (m.h.kind === 'rig') poseSoldier(m.h, m, dt);
  else poseHuman(m.h, m.phase, m.walk, m.stance);
}

/* Team mesh: each helmet reports its own position (with GNSS error) at 10 Hz. */
function updateReports(now) {
  const sigma = settings.rtk ? 0.02 : 1.2, lim = sigma * 1.6;
  for (const m of MATES) {
    m.err.x = clamp(m.err.x * 0.996 + (rand() - 0.5) * sigma * 0.07, -lim, lim);
    m.err.y = clamp(m.err.y * 0.996 + (rand() - 0.5) * sigma * 0.07, -lim, lim);
    if (settings.mesh && now - m.lastRep >= 0.1) {
      m.lastRep = now;
      const st = Math.round(clamp(m.stance, 0, 2));
      m.rep = { x: m.pos.x + m.err.x, z: m.pos.z + m.err.y, y: m.pos.y, yaw: m.yaw, stance: st, t: now, acc: settings.rtk ? 0.03 : 1.5 };
      if (now - m.lastTrail >= 0.5) { m.lastTrail = now; m.trail.push({ x: m.rep.x, z: m.rep.z, y: m.rep.y, t: now }); }
    }
    while (m.trail.length && now - m.trail[0].t > 5) m.trail.shift();
    if (m.rep) {
      const age = now - m.rep.t;
      if (age > 30 && !m.lostAlerted) { m.lostAlerted = true; pushAlert('lost-' + m.call, 'Teammate signal lost', `${m.call}: no update for 30 s`, 'warning', { icon: 'mate' }); }
      if (age < 1) m.lostAlerted = false;
    }
  }
}

/* ---------- drone: ~1 m class quadcopter, folding arms, gimbal camera, nav and strobe lights ---------- */
function makeDrone() {
  const g = new THREE.Group();
  const shell = std('#2b2f33', { roughness: 0.42, metalness: 0.25 }), carbon = std('#16181a', { roughness: 0.38, metalness: 0.35 }), metal = std('#8b9196', { roughness: 0.3, metalness: 0.9 });
  const add = (mesh, x, y, z, hd, hn, parent = g) => { mesh.position.set(x, y, z); parent.add(shadowed(mesh, true, false)); regHeat(mesh, hd, hn); return mesh; };
  add(new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.12, 0.46, 4, 0.05), shell), 0, 0, 0, 0.62, 0.68);
  add(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.07, 0.26, 3, 0.03), std('#43484c', { roughness: 0.5, metalness: 0.2 })), 0, 0.09, 0.05, 0.74, 0.8); // battery
  const antG = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6);
  for (const x of [-0.11, 0.11]) { const a = add(new THREE.Mesh(antG, carbon), x, 0.1, 0.2, 0.5, 0.4); a.rotation.x = -0.5; }
  const armGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.5, 10); armGeo.rotateZ(Math.PI / 2); armGeo.translate(0.25, 0, 0);
  const rotors = [], blades = [], discs = [];
  const bladeGeo = new THREE.BoxGeometry(0.42, 0.004, 0.035); bladeGeo.translate(0, 0, 0);
  const discMat = new THREE.MeshBasicMaterial({ color: 0x0d0f10, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const discGeo = new THREE.RingGeometry(0.03, 0.22, 40); discGeo.rotateX(-Math.PI / 2);
  for (const [sx, sz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    const arm = add(new THREE.Mesh(armGeo, carbon), sx * 0.1, 0.01, sz * 0.12, 0.5, 0.45);
    arm.rotation.y = Math.atan2(-sz, sx);
    const mx = sx * 0.1 + Math.cos(Math.atan2(sz, sx)) * 0.46, mz = sz * 0.12 + Math.sin(Math.atan2(sz, sx)) * 0.46;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.06, 16), metal), mx, 0.03, mz, 0.88, 0.9);
    const hub = new THREE.Group(); hub.position.set(mx, 0.07, mz); g.add(hub); rotors.push(hub);
    for (let i = 0; i < 2; i++) { const bl = new THREE.Mesh(bladeGeo, carbon); bl.rotation.y = i * Math.PI; bl.position.x = 0; bl.rotation.x = 0.12 * (i ? -1 : 1); bl.geometry = bladeGeo; hub.add(bl); regHeat(bl, 0.5, 0.4); blades.push(bl); }
    const disc = new THREE.Mesh(discGeo, discMat); disc.position.set(mx, 0.072, mz); disc.visible = false; g.add(disc); discs.push(disc); hideInThermal.push(disc);
    const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.2, 6), carbon), mx * 0.55, -0.11, mz * 0.55, 0.45, 0.35); leg.rotation.z = sx * 0.25;
  }
  // gimbal camera
  const gim = new THREE.Group(); gim.position.set(0, -0.1, -0.17); g.add(gim);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.04), carbon), 0, 0.03, 0, 0.6, 0.6, gim);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), std('#1b1d1f', { roughness: 0.25, metalness: 0.4 })), 0, -0.02, 0, 0.7, 0.72, gim);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 20), std('#05080c', { roughness: 0.05, metalness: 0.9, emissive: 0x0a1a2a, emissiveIntensity: 0.5 })); lens.position.set(0, -0.02, -0.056); lens.rotation.y = Math.PI; gim.add(lens);
  // nav lights (green right/red left at the front), white anti-collision strobe on top
  const ledMat = (c) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 6 });
  const leds = [];
  for (const [x, c] of [[0.13, 0x22ff66], [-0.13, 0xff2a2a]]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), ledMat(c)); l.position.set(x, 0.0, -0.23); g.add(l); leds.push(l); }
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), ledMat(0xffffff)); strobe.position.set(0, 0.13, -0.05); g.add(strobe);
  g.scale.setScalar(1.15);
  return { g, rotors, blades, discs, leds, strobe, gim };
}
const D = makeDrone(); scene.add(D.g);
const drone = { name: 'Dart', pos: PAD.clone().add(new THREE.Vector3(0, 0.2, 0)), state: 'grounded', st: 0, ang: 0.4, battery: 100, heading: 0, alt: 0,
  linkCutUntil: -1, vel: new THREE.Vector3(), firstFlight: true, R: 56, cruise: 40, look: new THREE.Vector3(), spin: 0, tilt: 0, roll: 0 };
const droneCam = new THREE.PerspectiveCamera(48, 16 / 9, 0.3, 900);
const rearCam = new THREE.PerspectiveCamera(70, 4, 0.1, 600); rearCam.rotation.order = 'YXZ';

function droneLink(now) { return now > drone.linkCutUntil; }
function droneVideo(now) { return droneLink(now) && drone.alt > 3 && drone.state !== 'grounded'; }

function updateDrone(dt, now) {
  const d = drone, prev = d.pos.clone();
  d.st += dt;
  const groundY = PAD.y + 0.16;
  if (d.state === 'grounded') {
    d.pos.copy(PAD).y = groundY; d.battery = Math.min(100, d.battery + dt * 6);
    if (d.st > (d.firstFlight ? 2 : 16)) { d.state = 'takeoff'; d.st = 0; d.firstFlight = false; }
  } else if (d.state === 'takeoff') {
    // spool up for 1.5 s, then climb with an ease-in
    if (d.st > 1.5) d.pos.y = Math.min(groundY + d.cruise, d.pos.y + Math.min(4, (d.st - 1.5) * 3) * dt);
    if (d.pos.y >= groundY + d.cruise - 0.01) { d.state = 'transit'; d.st = 0; }
  } else if (d.state === 'transit' || d.state === 'return') {
    const tgt = d.state === 'transit' ? new THREE.Vector3(Math.sin(d.ang) * d.R, groundY + d.cruise, -Math.cos(d.ang) * d.R) : new THREE.Vector3(PAD.x, groundY + d.cruise, PAD.z);
    const v = tgt.clone().sub(d.pos); v.y = 0; const dist = v.length();
    if (dist < 0.6) { d.state = d.state === 'transit' ? 'orbit' : 'landing'; d.st = 0; }
    else d.pos.addScaledVector(v.normalize(), Math.min(dist, Math.min(8, 0.5 + dist * 0.6) * dt));
  } else if (d.state === 'orbit') {
    d.ang += (7 / d.R) * dt;
    d.pos.set(Math.sin(d.ang) * d.R, groundY + d.cruise, -Math.cos(d.ang) * d.R);
    if (d.battery <= 25) { d.state = 'return'; d.st = 0; pushAlert('drone-batt', 'Drone battery low', `${d.name}: 25%, returning to pad`, 'warning', { icon: 'drone', pos: d.pos }); }
  } else if (d.state === 'landing') {
    const h = d.pos.y - groundY;
    d.pos.y = Math.max(groundY, d.pos.y - Math.max(0.4, Math.min(3, h * 0.4)) * dt);
    if (d.pos.y <= groundY + 0.01) { d.state = 'grounded'; d.st = 0; pushAlert('drone-land', 'Drone landed', `${d.name}: on pad, battery swap`, 'info', { icon: 'drone', pos: d.pos }); }
  }
  if (d.state !== 'grounded') d.battery = Math.max(0, d.battery - dt * 0.45);
  d.alt = d.pos.y - groundY;
  const nv = new THREE.Vector3().subVectors(d.pos, prev).divideScalar(Math.max(dt, 1e-4));
  const acc = nv.clone().sub(d.vel); d.vel.copy(nv);
  const hs = Math.hypot(d.vel.x, d.vel.z);
  if (hs > 0.5) d.heading = wrap360(Math.atan2(d.vel.x, -d.vel.z) / DEG);
  // body attitude: pitch into the direction of travel, roll into turns, small hover wobble
  const fwdAcc = (acc.x * Math.sin(d.heading * DEG) - acc.z * Math.cos(d.heading * DEG)) / Math.max(dt, 1e-4);
  d.tilt = damp(d.tilt, d.state === 'grounded' ? 0 : -clamp(hs / 8, 0, 1) * 0.2 - clamp(fwdAcc * 0.02, -0.15, 0.15), 4, dt);
  d.roll = damp(d.roll, d.state === 'orbit' ? 0.09 : 0, 2, dt);
  const wob = d.state === 'grounded' ? 0 : 1;
  D.g.position.copy(d.pos).add(new THREE.Vector3(0, wob * Math.sin(now * 1.7) * 0.04, 0));
  D.g.rotation.order = 'YXZ'; D.g.rotation.y = -d.heading * DEG;
  D.g.rotation.x = d.tilt + wob * Math.sin(now * 2.3) * 0.012; D.g.rotation.z = d.roll + wob * Math.sin(now * 1.9) * 0.012;
  // rotors: spool up/down, blades visible when slow, blur disc when fast
  d.spin = damp(d.spin, d.state === 'grounded' ? 0 : 1, d.state === 'grounded' ? 0.8 : 2.5, dt);
  D.rotors.forEach((r, i) => (r.rotation.y += d.spin * 90 * dt * (i === 0 || i === 3 ? 1 : -1)));
  const fast = d.spin > 0.35;
  D.blades.forEach((b) => (b.visible = !fast));
  D.discs.forEach((c) => (c.visible = fast && !thermalOn));
  D.discs[0].material.opacity = 0.05 + 0.13 * d.spin;
  const blink = Math.sin(now * 6) > 0.6; D.leds.forEach((l) => (l.visible = blink || d.state === 'grounded'));
  D.strobe.visible = d.state !== 'grounded' && (now % 1.3) < 0.06;
  // camera: oblique view of the compound while orbiting, straight down-forward otherwise
  const lookTarget = d.state === 'orbit' ? new THREE.Vector3(0, 0, 0) : d.pos.clone().add(new THREE.Vector3(Math.sin(d.heading * DEG) * 25, -d.alt - 1, -Math.cos(d.heading * DEG) * 25));
  d.look.lerp(lookTarget, 1 - Math.exp(-2 * dt));
  droneCam.position.copy(D.g.position).add(new THREE.Vector3(0, -0.15, 0));
  droneCam.lookAt(d.look);
  droneCam.updateMatrixWorld();
  // gimbal follows the camera look direction
  D.gim.lookAt(d.look); D.gim.rotateY(Math.PI);
}

/* ---------- black kites (Milvus migrans) soaring in thermals, as over any Delhi afternoon ---------- */
function makeKite() {
  const g = new THREE.Group();
  const mat = std('#3a2e24', { roughness: 0.92, side: THREE.DoubleSide });
  const poly = (pts) => { const geo = new THREE.BufferGeometry(); const v = []; for (let i = 1; i < pts.length - 1; i++) v.push(...pts[0], ...pts[i], ...pts[i + 1]); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.computeVertexNormals(); return geo; };
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat); body.scale.set(0.07, 0.065, 0.27); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat); head.position.set(0, 0.02, -0.27); g.add(head);
  const tail = new THREE.Mesh(poly([[0, 0, 0.2], [-0.07, 0, 0.24], [-0.1, 0, 0.47], [0, 0, 0.41], [0.1, 0, 0.47], [0.07, 0, 0.24]]), mat); g.add(tail); // forked tail
  const wings = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.05, 0.01, -0.04); g.add(sh);
    const inner = new THREE.Mesh(poly([[0, 0, -0.08], [s * 0.34, 0, -0.07], [s * 0.34, 0, 0.13], [0, 0, 0.16]]), mat); sh.add(inner);
    const el = new THREE.Group(); el.position.set(s * 0.34, 0, 0); sh.add(el);
    el.add(new THREE.Mesh(poly([[0, 0, -0.07], [s * 0.2, 0, -0.06], [s * 0.38, 0, 0.0], [s * 0.4, 0, 0.06], [s * 0.3, 0, 0.1], [0, 0, 0.13]]), mat));
    wings.push({ sh, el, s });
  }
  g.traverse((o) => { if (o.isMesh) regHeat(o, 0.62, 0.66); });
  return { g, wings };
}
const KITES = [];
for (let i = 0; i < 7; i++) {
  const k = makeKite(); scene.add(k.g);
  KITES.push({ k, cx: rr(-120, 120), cz: rr(-150, 60), r: rr(18, 46), alt: rr(38, 95), a: rand() * 6.28, dir: rand() < 0.5 ? 1 : -1, v: rr(8, 11), flapT: rr(2, 14), flap: 0, drift: rr(0, 6.28) });
}
function updateKites(dt, now) {
  for (const b of KITES) {
    b.a += (b.v / b.r) * b.dir * dt;
    b.cx += Math.cos(b.drift) * 0.6 * dt; b.cz += Math.sin(b.drift) * 0.6 * dt; // the thermal drifts with the wind
    if (Math.hypot(b.cx, b.cz + 40) > 200) b.drift += Math.PI;
    const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r, y = heightAt(b.cx, b.cz) + b.alt + Math.sin(now * 0.2 + b.r) * 2;
    b.k.g.position.set(x, y, z);
    const tx = -Math.sin(b.a) * b.dir, tz = Math.cos(b.a) * b.dir; // tangent
    b.k.g.rotation.order = 'YXZ'; b.k.g.rotation.y = Math.atan2(-tx, -tz); b.k.g.rotation.z = -0.38 * b.dir; b.k.g.rotation.x = 0.04;
    b.flapT -= dt; if (b.flapT < 0) { b.flap = 1.6; b.flapT = rr(8, 22); }
    b.flap = Math.max(0, b.flap - dt);
    const f = b.flap > 0 ? Math.sin(now * 11) * 0.55 : 0;
    for (const w of b.k.wings) { w.sh.rotation.z = w.s * (0.07 + f); w.el.rotation.z = w.s * (-0.08 + f * 0.45); }
  }
}

/* ---------- rotor-wash dust: soft billboards kicked up when the drone is near the ground ---------- */
const DUST_N = 180;
const dustUni = { uScale: { value: 400 }, uColor: { value: new THREE.Color(0.62, 0.53, 0.4) }, uLight: { value: 1 } };
const dust = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3));
  g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(DUST_N * 2), 2)); // x: age 0..1 (or -1 dead), y: size
  const m = new THREE.ShaderMaterial({
    uniforms: dustUni, transparent: true, depthWrite: false,
    vertexShader: `attribute vec2 aLife; uniform float uScale; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float age = aLife.x; vA = age < 0.0 ? 0.0 : smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.45, 1.0, age));
        gl_PointSize = age < 0.0 ? 0.0 : aLife.y * (0.45 + age * 2.2) * uScale / -mv.z; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uLight; varying float vA;
      void main(){ vec2 p = gl_PointCoord - 0.5; float r = dot(p, p) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(uColor * uLight, vA * (1.0 - r) * (1.0 - r) * 0.34); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 2;
  scene.add(pts); hideInThermal.push(pts);
  const vel = new Float32Array(DUST_N * 3), life = new Float32Array(DUST_N), dur = new Float32Array(DUST_N).fill(1);
  g.attributes.aLife.array.fill(-1);
  return { g, vel, life, dur, next: 0, acc: 0 };
})();
function updateDust(dt) {
  const P = dust.g.attributes.position.array, A = dust.g.attributes.aLife.array, d = drone;
  const ground = heightAt(d.pos.x, d.pos.z), h = d.pos.y - ground;
  dustUni.uLight.value = settings.night ? 0.06 : 1;
  if (d.spin > 0.3 && h < 8 && !REDUCED) {
    dust.acc += dt * 140 * d.spin * (1 - h / 8);
    while (dust.acc >= 1) {
      dust.acc -= 1; const i = dust.next; dust.next = (dust.next + 1) % DUST_N;
      const a = rand() * Math.PI * 2, r = 0.4 + rand() * 1.6, sp = 2.5 + rand() * 4;
      P[i * 3] = d.pos.x + Math.cos(a) * r; P[i * 3 + 1] = ground + 0.15; P[i * 3 + 2] = d.pos.z + Math.sin(a) * r;
      dust.vel[i * 3] = Math.cos(a) * sp; dust.vel[i * 3 + 1] = 0.4 + rand() * 1.2; dust.vel[i * 3 + 2] = Math.sin(a) * sp;
      dust.life[i] = 0; A[i * 2] = 0; dust.dur[i] = 1.3 + rand() * 1.2; A[i * 2 + 1] = 0.5 + rand() * 0.7;
    }
  }
  for (let i = 0; i < DUST_N; i++) {
    if (A[i * 2] < 0) continue;
    dust.life[i] += dt / dust.dur[i];
    if (dust.life[i] >= 1) { A[i * 2] = -1; continue; }
    const k = Math.exp(-1.6 * dt);
    dust.vel[i * 3] *= k; dust.vel[i * 3 + 2] *= k; dust.vel[i * 3 + 1] = dust.vel[i * 3 + 1] * k - 0.15 * dt;
    P[i * 3] += dust.vel[i * 3] * dt + 0.4 * dt; P[i * 3 + 1] += dust.vel[i * 3 + 1] * dt; P[i * 3 + 2] += dust.vel[i * 3 + 2] * dt;
    A[i * 2] = dust.life[i];
  }
  dust.g.attributes.position.needsUpdate = true; dust.g.attributes.aLife.needsUpdate = true;
}

/* ---------- ambient sound: wind, footsteps, drone motors, kite calls (procedural Web Audio) ---------- */
const amb = { on: false, nextCall: 20 };
function initAmbience() {
  if (amb.on || !actx) return;
  try {
    amb.on = true;
    const sr = actx.sampleRate, len = sr * 3, buf = actx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { b = 0.985 * b + 0.015 * (Math.random() * 2 - 1); d[i] = b * 9; }
    const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const wg = actx.createGain(); wg.gain.value = 0; src.connect(lp); lp.connect(wg); wg.connect(master); src.start();
    amb.wind = { lp, g: wg };
    const sl = Math.floor(sr * 0.22), sb = actx.createBuffer(1, sl, sr), sd = sb.getChannelData(0);
    for (let i = 0; i < sl; i++) sd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sl, 4);
    amb.step = sb;
    const dg = actx.createGain(); dg.gain.value = 0; const dlp = actx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 1500;
    const o1 = actx.createOscillator(), o2 = actx.createOscillator(), o3 = actx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth'; o3.type = 'triangle'; o1.frequency.value = 182; o2.frequency.value = 188; o3.frequency.value = 364;
    [o1, o2, o3].forEach((o) => { o.connect(dlp); o.start(); });
    let out = dg; if (actx.createStereoPanner) { amb.dpan = actx.createStereoPanner(); dg.connect(amb.dpan); out = amb.dpan; }
    dlp.connect(dg); out.connect(master);
    amb.drone = { g: dg, o: [o1, o2, o3] };
  } catch (e) { amb.on = false; }
}
function playStep(run) {
  if (!amb.on || !settings.sound) return;
  try {
    const s = actx.createBufferSource(); s.buffer = amb.step; s.playbackRate.value = 0.75 + Math.random() * 0.5;
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.value = grassDensity(player.pos.x, player.pos.z) > 0.35 ? 2600 + Math.random() * 900 : 700 + Math.random() * 300; // dry grass rustles, dirt crunches
    const g = actx.createGain(); g.gain.value = (run ? 0.9 : 0.55) * [1, 0.7, 0.45][player.stance];
    s.connect(f); f.connect(g); g.connect(master); s.start();
  } catch (e) { /* audio is optional */ }
}
function kiteCall(b) {
  if (!amb.on || !settings.sound) return;
  try {
    const dist = b.k.g.position.distanceTo(camera.position), vol = clamp(30 / dist, 0, 1) * 0.35, t0 = actx.currentTime + 0.02;
    const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine';
    let out = g; if (actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = panFor(b.k.g.position) * 0.8; g.connect(p); out = p; }
    out.connect(master); o.connect(g);
    // a thin descending whistle followed by a quick trill
    o.frequency.setValueAtTime(2900, t0); o.frequency.exponentialRampToValueAtTime(2100, t0 + 0.32);
    for (let i = 0; i < 6; i++) o.frequency.setValueAtTime(i % 2 ? 2050 : 2350, t0 + 0.36 + i * 0.055);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.04); g.gain.setValueAtTime(vol, t0 + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
    o.start(t0); o.stop(t0 + 0.8);
  } catch (e) { /* audio is optional */ }
}
function updateAmbience(dt) {
  if (!amb.on) return;
  const t = actx.currentTime, on = settings.sound && state.view !== 'start' ? 1 : 0, field = state.view === 'field' ? 1 : 0.3;
  const gust = 0.55 + 0.45 * Math.sin(state.t * 0.23) * Math.sin(state.t * 0.071 + 1);
  amb.wind.g.gain.setTargetAtTime(on * field * (0.35 + 0.55 * gust) * (settings.night ? 0.6 : 1), t, 0.5);
  amb.wind.lp.frequency.setTargetAtTime(260 + 520 * gust, t, 0.6);
  const dx = drone.pos.x - camera.position.x, dy = drone.pos.y - camera.position.y, dz = drone.pos.z - camera.position.z, dist = Math.hypot(dx, dy, dz);
  amb.drone.g.gain.setTargetAtTime(on * field * drone.spin * Math.pow(clamp(7 / Math.max(dist, 1), 0, 1), 1.3) * 0.5, t, 0.15);
  const pitch = 150 + drone.spin * 40 + clamp(drone.vel.y, -2, 4) * 6;
  amb.drone.o[0].frequency.setTargetAtTime(pitch, t, 0.3); amb.drone.o[1].frequency.setTargetAtTime(pitch * 1.032, t, 0.3); amb.drone.o[2].frequency.setTargetAtTime(pitch * 2, t, 0.3);
  if (amb.dpan) amb.dpan.pan.setTargetAtTime(panFor(drone.pos) * 0.8, t, 0.1);
  if (state.t > amb.nextCall && on && !settings.night) { amb.nextCall = state.t + rr(25, 70); kiteCall(KITES[Math.floor(rand() * KITES.length)]); }
}

/* ---------- pings ---------- */
const PING_TYPES = {
  waypoint: { label: 'Waypoint', color: COL.green, ttl: Infinity },
  rally: { label: 'Rally', color: '#f4f7f8', ttl: Infinity },
  hazard: { label: 'Hazard', color: COL.amber, ttl: 1800 },
  note: { label: 'Note', color: '#c3ccd0', ttl: 600 },
};
const PING_ORDER = ['waypoint', 'rally', 'hazard', 'note']; // top, right, bottom, left on the ping wheel
const pings = []; let pingSeq = 0;
function addPing(type, x, y, z, author) {
  const p = { id: author + '-' + (++pingSeq), type, x, y, z, author, t: state.t };
  pings.push(p);
  const own = pings.filter((q) => q.author === 'ALPHA-1');
  if (own.length > 12) pings.splice(pings.indexOf(own[0]), 1);
  tone([880, 1320], 0.11, panFor(p), 'sine', 0.8); if (author === 'ALPHA-1') buzz(18);
  if (author !== 'ALPHA-1') pushAlert('ping-' + p.id, 'New ping', `${author}: ${PING_TYPES[type].label}`, 'info', { icon: 'pin', pos: p });
  bus.emit(author === 'ALPHA-1' ? 'ping' : 'mateping', p);
  return p;
}
function expirePings() {
  for (let i = pings.length - 1; i >= 0; i--) if (state.t - pings[i].t > PING_TYPES[pings[i].type].ttl) pings.splice(i, 1);
}
function panFor(pos) {
  if (!pos) return 0;
  const b = bearingTo(player.pos.x, player.pos.z, pos.x, pos.z);
  return Math.sin(wrap180(b - player.yaw / DEG) * DEG);
}

/* ---------- alerts ---------- */
const ALERT_LIFE = { info: 4, warning: 8, critical: Infinity };
const ALERT_RANK = { info: 0, warning: 1, critical: 2 };
const alertQ = []; let alertCur = null; const alertSeen = new Map();
function pushAlert(key, title, detail, level, opts = {}) {
  const now = state.t;
  if (alertSeen.has(key) && now - alertSeen.get(key) < 30) return;
  alertSeen.set(key, now);
  const a = { key, title, detail, level, t0: now, shown: now, icon: opts.icon || 'info', pos: opts.pos ? { x: opts.pos.x, y: opts.pos.y || 0, z: opts.pos.z } : null };
  alertQ.push(a);
  if (alertCur && ALERT_RANK[level] > ALERT_RANK[alertCur.level]) { alertQ.push(alertCur); alertCur = null; }
  alertQ.sort((p, q) => ALERT_RANK[q.level] - ALERT_RANK[p.level]);
  if (!alertCur) showNextAlert();
}
function showNextAlert() {
  alertCur = alertQ.shift() || null;
  if (!alertCur) return;
  alertCur.shown = state.t;
  const pan = panFor(alertCur.pos);
  buzz(alertCur.level === 'critical' ? [120, 60, 120, 60, 120] : alertCur.level === 'warning' ? [60, 50, 60] : 25);
  if (alertCur.level === 'critical') tone([440, 523, 440], 0.16, pan, 'square', 0.5);
  else if (alertCur.level === 'warning') tone([740, 740], 0.12, pan, 'triangle', 0.8);
  else tone([990], 0.09, pan, 'sine', 0.6);
}
function updateAlerts() { if (alertCur && state.t - alertCur.shown > ALERT_LIFE[alertCur.level]) showNextAlert(); }
function ackAlert() { if (alertCur) { bus.emit('ack'); showNextAlert(); } }

/* ---------- world simulation tick ---------- */
let nextRF = 75, nextMatePing = 50;
function updateWorld(dt) {
  const now = state.t;
  for (const m of MATES) updateMate(m, dt);
  updateReports(now);
  updateDrone(dt, now);
  updateKites(dt, now);
  updateDust(dt);
  updateAmbience(dt);
  rotor.rotation.z += dt * (REDUCED ? 0.6 : 1.6);
  expirePings();
  // rear radar: movement within 5 m behind you
  for (const m of MATES) {
    const dx = m.pos.x - player.pos.x, dz = m.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    const rel = wrap180(bearingTo(player.pos.x, player.pos.z, m.pos.x, m.pos.z) - player.yaw / DEG);
    if (d < 5 && Math.abs(rel) > 110 && m.walk > 0.3) {
      if (now - m.behindAlerted > 12) {
        m.behindAlerted = now;
        pushAlert('rear', 'Movement behind', `Rear radar, ${d.toFixed(0)} m`, 'warning', { icon: 'radar', pos: m.pos });
        if (settings.mirrorAuto) state.mirrorUntil = now + 5;
      }
    }
  }
  if (now > nextRF) { nextRF = now + rr(80, 140); pushAlert('rf', 'RF activity', '865–867 MHz above threshold', 'info', { icon: 'rf' }); }
  if (now > nextMatePing && settings.mesh) { nextMatePing = now + rr(70, 120); matePing(); }
  // helmet battery: about 3 hours from full
  state.battery = Math.max(0, state.battery - dt * (state.batteryDrain ? 1.2 : 100 / 10800));
  if (state.battery < 20) pushAlert('batt-low', 'Helmet battery low', `${Math.round(state.battery)}% left, about ${Math.max(1, Math.round(state.battery * 1.8))} min`, 'warning', { icon: 'battery' });
  if (state.battery < 10) { pushAlert('batt-crit', 'Helmet battery critical', `${Math.round(state.battery)}%: change the pack`, 'critical', { icon: 'battery' }); state.batteryDrain = false; }
  updateAlerts();
}
function matePing() {
  const live = MATES.filter((m) => m.rep);
  if (!live.length) return;
  const m = live[Math.floor(rand() * live.length)];
  const type = rand() < 0.5 ? 'rally' : rand() < 0.6 ? 'hazard' : 'note';
  const a = m.yaw + rr(-0.6, 0.6), r = rr(6, 14);
  const x = m.pos.x + Math.sin(a) * r, z = m.pos.z - Math.cos(a) * r;
  addPing(type, x, heightAt(x, z), z, m.call);
}
