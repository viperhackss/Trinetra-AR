/* ---------- input ---------- */
const keys = new Set();
const joy = { x: 0, y: 0 };
const SENS = 0.0022;

function menuVec(dx, dy) {
  const t = state.menu || (state.pingHold && state.pingHold.wheel ? state.pingHold : null);
  if (!t) return false;
  t.vx = clamp(t.vx + dx, -160, 160); t.vy = clamp(t.vy + dy, -160, 160);
  const len = Math.hypot(t.vx, t.vy);
  if (len > 160) { t.vx *= 160 / len; t.vy *= 160 / len; }
  const n = state.menu ? menuItems(state.menu.level).length : 4;
  const prev = t.sel;
  if (len < 28) t.sel = -1;
  else { const ang = wrap360(Math.atan2(t.vx, -t.vy) / DEG); t.sel = Math.round(ang / (360 / n)) % n; }
  if (t.sel !== prev && t.sel >= 0) { tone([1700], 0.03, 0, 'sine', 0.25); buzz(6); }
  return true;
}
function look(dx, dy, sens = SENS) {
  if (state.view === 'helmet') { helmetOrbit(dx, dy); return; }
  if (state.view !== 'field') return;
  if (menuVec(dx, dy)) return;
  if (state.mapPing) { const k = state.mapPing.mpp || 1; state.mapPing.x = clamp(state.mapPing.x + dx * k, -HALF + 2, HALF - 2); state.mapPing.z = clamp(state.mapPing.z + dy * k, -HALF + 2, HALF - 2); return; }
  aimInit(); player.tyaw += dx * sens; player.tpitch = clamp(player.tpitch - dy * sens, -1.35, 1.35);
  state.yawAccum += Math.abs(dx * sens);
  if (state.yawAccum > Math.PI / 2) bus.emit('look');
}

/* menu */
function openMenu(level = 'vision') { if (state.pingHold || state.mapPing) return; state.menu = { level, sel: -1, vx: 0, vy: 0, t0: state.rt }; tone([1200], 0.04, 0, 'sine', 0.3); }
function closeMenu(apply) {
  const m = state.menu; if (!m) return;
  state.menu = null;
  if (!apply || m.sel < 0) return;
  const it = menuItems(m.level)[m.sel];
  if (m.level === 'vision') {
    if (it.id === 'sensors') { openMenu('sensors'); state.menu.sticky = true; return; }
    setVision(it.id);
  } else {
    if (it.id === 'back') { openMenu('vision'); state.menu.sticky = true; return; }
    toggleSetting(it.id);
  }
}
function setVision(id) {
  if (state.vision === id) return;
  state.vision = id; toast(`Vision: ${VISION_LABEL[id]}`); tone([660, 990], 0.07, 0, 'sine', 0.5);
  bus.emit('vision', id);
  if (settings.night && (id === 'thermal' || id === 'fused')) bus.emit('nightvision');
}
function toggleSetting(id, value) {
  const v = value === undefined ? !settings[id] : value;
  if (id === 'night') { setNight(v); bus.emit('night'); if (v && (state.vision === 'thermal' || state.vision === 'fused')) bus.emit('nightvision'); }
  else settings[id] = v;
  saveSettings(); syncPanel();
  const names = { night: 'Night', glassesFov: 'Real glasses field of view', stereo: 'Stereo 3D', sixdof: '6DOF tracking', mesh: 'Team mesh', rtk: 'RTK GNSS', mirrorAuto: 'Mirror on rear movement', ping: 'Pings', sound: 'Sound', imperial: 'Altitude in feet', autoRes: 'Auto resolution', motionLook: 'Motion look', haptics: 'Haptics', foldLayout: 'Flex mode layout' };
  toast(`${names[id] || id}: ${v ? 'ON' : 'OFF'}`);
  if (id === 'stereo') { resizeAll(); if (v) bus.emit('stereo'); }
  if (id === 'autoRes' && !v) { perf.dyn = 1; resizeScene(); }
  if (id === 'foldLayout') resizeAll();
  if (id === 'motionLook') setMotionLook(v).then((ok) => { if (v && !ok) { settings.motionLook = false; syncPanel(); toast('Motion sensors are not available'); } });
  if (id === 'haptics' && v) buzz(30);
  if (id === 'sixdof' && !v) pushAlert('track', 'Tracking degraded', '3DoF fallback: world markers off', 'warning', { icon: 'track' });
  if (['sixdof', 'mesh', 'rtk', 'mirrorAuto', 'ping'].includes(id)) bus.emit('sensors');
}

/* ping */
function startPing() {
  if (state.mapPing) { placeMapPing(); return; }
  if (state.menu) return;
  if (!settings.ping) { toast('Pings are OFF (Sensors ring)'); return; }
  const lp = state.looked;
  state.pingHold = { t0: state.rt, wheel: false, sel: -1, vx: 0, vy: 0, removeTarget: lp && lp.author === 'ALPHA-1' ? lp : null };
}
function endPing() {
  const h = state.pingHold; if (!h) return;
  state.pingHold = null;
  if (h.removeTarget && state.rt - h.t0 > 0.6) { removePing(h.removeTarget); return; } // hold on your own ping: remove it
  if (h.wheel && h.sel < 0) return; // released in the centre: cancel
  const g = gazeHit();
  if (!g) { toast('Out of range: hold M for a map ping'); tone([300], 0.12, 0, 'triangle', 0.5); return; }
  addPing(h.wheel ? PING_ORDER[h.sel] : 'waypoint', g.x, g.y, g.z, 'ALPHA-1');
}
function removePing(p) { const i = pings.indexOf(p); if (i >= 0) { pings.splice(i, 1); toast('Ping removed'); tone([700, 450], 0.08, 0, 'sine', 0.5); } }
function removeLookedPing() { const p = state.looked; if (p && p.author === 'ALPHA-1') removePing(p); else toast('Look at one of your pings to remove it'); }
function openMapPing() { if (state.menu || state.pingHold) return; state.mapPing = { x: player.pos.x + Math.sin(player.yaw) * 40, z: player.pos.z - Math.cos(player.yaw) * 40, mpp: 1 }; }
function placeMapPing() { const m = state.mapPing; if (!m) return; addPing('waypoint', m.x, heightAt(m.x, m.z), m.z, 'ALPHA-1'); bus.emit('mapping'); }
function closeMapPing() { if (TOUCH && state.mapPing) placeMapPing(); state.mapPing = null; }
function toggleMirror() { state.mirrorManual = !state.mirrorManual; if (!state.mirrorManual) state.mirrorUntil = -1; toast(`Rearview mirror: ${state.mirrorManual ? 'ON' : 'OFF'}`); if (state.mirrorManual) bus.emit('mirror'); }
function zoomMap(dir) { const steps = [75, 150, 300]; let i = steps.indexOf(state.minimapRange); i = clamp(i + dir, 0, 2); if (steps[i] !== state.minimapRange) { state.minimapRange = steps[i]; toast(`Minimap range: ${steps[i]} m`); bus.emit('zoom'); } }
function setStance(s) { player.stance = player.stance === s ? 0 : s; buzz(12); syncDeck(); }

/* keyboard */
const PREVENT = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab', '/', '?']);
addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (state.view === 'start') { if (k === 'enter') startField(); return; }
  if (PREVENT.has(k)) e.preventDefault();
  const first = !keys.has(k); keys.add(k);
  if (!first || e.repeat) return;
  if (k === 'h') { setView(state.view === 'helmet' ? 'field' : 'helmet'); return; }
  if (k === 'p') { togglePanel(); return; }
  if (k === '/' || k === '?') { toggleHelp(); return; }
  if (k === 'escape') { if (state.menu) { state.menu = null; return; } closeOverlays(); return; }
  if (k === 'v') { toggleSetting('stereo'); return; }
  if (state.view !== 'field') return;
  if (state.menu && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
    const d = { arrowleft: [-60, 0], arrowright: [60, 0], arrowup: [0, -60], arrowdown: [0, 60] }[k]; menuVec(d[0], d[1]); return;
  }
  switch (k) {
    case 'q': if (state.menu && state.menu.sticky) { closeMenu(true); state.qIgnoreUp = true; } else openMenu('vision'); break;
    case 'e': startPing(); break;
    case 'x': removeLookedPing(); break;
    case 'm': openMapPing(); break;
    case 'r': toggleMirror(); break;
    case 'n': toggleSetting('night', !settings.night); break;
    case 'g': toggleSetting('glassesFov'); break;
    case 'c': setStance(1); break;
    case 'z': setStance(2); break;
    case ' ': ackAlert(); break;
    case '-': case '_': zoomMap(-1); break;
    case '=': case '+': zoomMap(1); break;
  }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase(); keys.delete(k);
  if (state.view !== 'field') return;
  if (k === 'q') { if (state.qIgnoreUp) state.qIgnoreUp = false; else if (state.menu && !state.menu.sticky) closeMenu(true); }
  if (k === 'e') endPing();
  if (k === 'm') closeMapPing();
});
addEventListener('blur', () => { keys.clear(); state.menu = null; state.pingHold = null; state.mapPing = null; joy.x = joy.y = 0; });

/* mouse */
let drag = null;
glCanvas.addEventListener('mousedown', (e) => {
  if (TOUCH) return;
  if (state.view === 'field') {
    if (state.mapPing) { placeMapPing(); return; }
    if (state.menu) { closeMenu(true); return; }
    if (!state.locked) { try { const r = glCanvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* no pointer lock */ } }
  }
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
});
addEventListener('mouseup', (e) => { if (drag && state.view === 'helmet' && drag.moved < 4) helmetClick(e.clientX, e.clientY); drag = null; });
addEventListener('mousemove', (e) => {
  if (TOUCH) return;
  if (state.locked) { look(e.movementX, e.movementY); return; }
  if (state.view === 'helmet') helmetHover(e.clientX, e.clientY);
  if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy); look(dx, dy, 0.004); }
});
glCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.view === 'helmet') helmetZoom(e.deltaY);
  else if (state.view === 'field') { state.wheelAcc = (state.wheelAcc || 0) + e.deltaY; if (Math.abs(state.wheelAcc) > 60) { zoomMap(state.wheelAcc > 0 ? 1 : -1); state.wheelAcc = 0; } }
}, { passive: false });
document.addEventListener('pointerlockchange', () => {
  state.locked = document.pointerLockElement === glCanvas;
  document.body.classList.toggle('locked', state.locked);
  updateLockHint();
});
glCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* touch: joystick, look-drag, buttons */
const touchLook = new Map();
let pinch = null;
glCanvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  glCanvas.setPointerCapture(e.pointerId);
  touchLook.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
  if (touchLook.size === 2 && state.view === 'helmet') { const [a, b] = [...touchLook.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
});
glCanvas.addEventListener('pointermove', (e) => {
  const t = touchLook.get(e.pointerId); if (!t) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y; t.x = e.clientX; t.y = e.clientY;
  if (pinch !== null && touchLook.size === 2) { const [a, b] = [...touchLook.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); helmetZoom((pinch - d) * 4); pinch = d; return; }
  look(dx, dy, 0.0055);
});
const endTouch = (e) => {
  const t = touchLook.get(e.pointerId); if (!t) return; touchLook.delete(e.pointerId); if (touchLook.size < 2) pinch = null;
  if (state.view === 'helmet' && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) < 8 && performance.now() - t.t < 350) helmetClick(e.clientX, e.clientY);
};
glCanvas.addEventListener('pointerup', endTouch); glCanvas.addEventListener('pointercancel', endTouch);

const joyEl = $('#joy'), knob = $('#joy-knob');
let joyId = null, joyC = null;
joyEl.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joyEl.setPointerCapture(e.pointerId); const r = joyEl.getBoundingClientRect(); joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; joyMove(e); });
joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = (e) => { if (e.pointerId !== joyId) return; joyId = null; joy.x = joy.y = 0; knob.style.transform = ''; };
joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);
function joyMove(e) {
  let dx = e.clientX - joyC.x, dy = e.clientY - joyC.y; const d = Math.hypot(dx, dy), lim = joyC.r * 0.7;
  if (d > lim) { dx *= lim / d; dy *= lim / d; }
  joy.x = dx / lim; joy.y = dy / lim; knob.style.transform = `translate(${dx}px, ${dy}px)`;
}
$$('#tbtns button').forEach((b) => {
  let last = null;
  b.addEventListener('pointerdown', (e) => {
    b.setPointerCapture(e.pointerId); last = { x: e.clientX, y: e.clientY }; b.classList.add('on');
    const k = b.dataset.k;
    if (k === 'menu') { if (state.menu && state.menu.sticky) { closeMenu(true); b.ignoreUp = true; } else openMenu('vision'); } else if (k === 'ping') startPing(); else if (k === 'map') openMapPing();
    else if (k === 'mirror') toggleMirror(); else if (k === 'ack') ackAlert(); else if (k === 'crouch') setStance(1);
  });
  b.addEventListener('pointermove', (e) => {
    if (!last) return; const dx = (e.clientX - last.x) * 1.6, dy = (e.clientY - last.y) * 1.6; last = { x: e.clientX, y: e.clientY };
    const k = b.dataset.k;
    if (k === 'menu' || (k === 'ping' && state.pingHold && state.pingHold.wheel)) menuVec(dx, dy);
    else if (k === 'map' && state.mapPing) { const s = state.mapPing.mpp || 1; state.mapPing.x += dx * s * 0.7; state.mapPing.z += dy * s * 0.7; }
  });
  const up = () => {
    if (!last) return; last = null; b.classList.remove('on');
    const k = b.dataset.k;
    if (k === 'menu') { if (b.ignoreUp) b.ignoreUp = false; else if (state.menu && !state.menu.sticky) closeMenu(true); }
    else if (k === 'ping') endPing(); else if (k === 'map') closeMapPing();
  };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
});

/* ---------- motion look: turn the phone to look around (gyro), added on top of drag look ---------- */
const motion = { q: new THREE.Quaternion(), last: null, euler: new THREE.Euler(), q1: new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), z: new THREE.Vector3(0, 0, 1), q0: new THREE.Quaternion(), fwd: new THREE.Vector3(), listening: false };
function onOrient(e) {
  if (!settings.motionLook || e.alpha === null || state.view !== 'field') { motion.last = null; return; }
  const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * DEG;
  motion.euler.set(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG, 'YXZ');
  motion.q.setFromEuler(motion.euler).multiply(motion.q1).multiply(motion.q0.setFromAxisAngle(motion.z, -orient));
  motion.fwd.set(0, 0, -1).applyQuaternion(motion.q);
  const yaw = Math.atan2(motion.fwd.x, -motion.fwd.z), pitch = Math.asin(clamp(motion.fwd.y, -1, 1));
  if (motion.last && Math.abs(pitch) < 1.35) {
    aimInit();
    let dy = yaw - motion.last.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    player.tyaw += dy; player.tpitch = clamp(player.tpitch + (pitch - motion.last.pitch), -1.35, 1.35);
    state.yawAccum += Math.abs(dy); if (state.yawAccum > Math.PI / 2) bus.emit('look');
  }
  motion.last = { yaw, pitch };
}
async function setMotionLook(on) {
  if (on && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') on = false; } catch (e) { on = false; }
  }
  if (on && !motion.listening) { addEventListener('deviceorientation', onOrient); motion.listening = true; }
  motion.last = null;
  return on;
}

/* ---------- haptics (Android vibration motor) ---------- */
function buzz(p) { if (!settings.haptics || !TOUCH || !navigator.vibrate) return; try { navigator.vibrate(p); } catch (e) { /* ignore */ } }

/* ---------- player movement: eased look, acceleration, gait bob, sway and roll ---------- */
const vel = new THREE.Vector2();
const FOV0 = camera.fov;
function aimInit() {
  // anything that sets yaw/pitch directly (reset, start view) re-seeds the smoothing targets
  if (player.tyaw === undefined || player.yaw !== player._yaw) player.tyaw = player.yaw;
  if (player.tpitch === undefined || player.pitch !== player._pitch) player.tpitch = player.pitch;
}
function updatePlayer(dt) {
  aimInit();
  const rate = TOUCH ? 20 : 34;
  player.yaw = dampAngle(player.yaw, player.tyaw, rate, dt); player.pitch = damp(player.pitch, player.tpitch, rate, dt);
  if (Math.abs(player.tyaw - player.yaw) > Math.PI) player.tyaw = player.yaw + wrap180((player.tyaw - player.yaw) / DEG) * DEG;
  player._yaw = player.yaw; player._pitch = player.pitch;
  let mx = 0, mz = 0;
  if (state.view === 'field' && !state.mapPing) {
    const arrows = !state.menu;
    if (keys.has('w') || (arrows && keys.has('arrowup'))) mz += 1;
    if (keys.has('s') || (arrows && keys.has('arrowdown'))) mz -= 1;
    if (keys.has('d') || (arrows && keys.has('arrowright'))) mx += 1;
    if (keys.has('a') || (arrows && keys.has('arrowleft'))) mx -= 1;
    mx += joy.x; mz -= joy.y;
  }
  const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
  const run = (keys.has('shift') || Math.hypot(joy.x, joy.y) > 0.96) && player.stance === 0 && mz > 0.3;
  const want = [run ? 4.2 : 1.7, 0.9, 0.45][player.stance] * Math.min(1, Math.hypot(mx, mz));
  const fx = Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = Math.sin(player.yaw);
  const n = Math.hypot(mx, mz) || 1;
  const tx = ((fx * mz + rx * mx) / n) * want, tz = ((fz * mz + rz * mx) / n) * want;
  const acc = want > Math.hypot(vel.x, vel.y) ? 7 : 9; // ease in, settle out
  vel.x = damp(vel.x, tx, acc, dt); vel.y = damp(vel.y, tz, acc, dt);
  const speed = Math.hypot(vel.x, vel.y);
  if (speed > 0.01) {
    player.pos.x += vel.x * dt; player.pos.z += vel.y * dt;
    state.moved += speed * dt; if (state.moved > 10) bus.emit('move');
  }
  collide(player.pos, 0.4);
  player.pos.x = clamp(player.pos.x, -HALF + 6, HALF - 6); player.pos.z = clamp(player.pos.z, -HALF + 6, HALF - 6);
  player.pos.y = heightAt(player.pos.x, player.pos.z);
  player.eye = damp(player.eye, [1.7, 1.1, 0.38][player.stance], 6, dt);
  player.speed = speed;
  // gait: one bob cycle per two steps; footstep sound on each down-beat
  const prevPhase = player.bob;
  if (speed > 0.05) player.bob += speed * dt * (run ? 1.55 : 2.15);
  if (Math.floor(prevPhase / Math.PI) !== Math.floor(player.bob / Math.PI)) playStep(run);
  const g = REDUCED ? 0 : Math.min(1, speed / 1.7) * [1, 0.6, 0.25][player.stance];
  const bobY = Math.abs(Math.sin(player.bob)) * 0.034 * g * (run ? 1.6 : 1) - 0.017 * g;
  const swayX = Math.sin(player.bob) * 0.022 * g;
  const breath = REDUCED ? 0 : Math.sin(state.t * 1.6) * 0.0022 * (1 - Math.min(1, speed));
  // lean into strafes, a little roll with each step
  player.roll = damp(player.roll || 0, REDUCED ? 0 : -(vel.x * rx + vel.y * rz) * 0.008 + Math.sin(player.bob) * 0.004 * g, 6, dt);
  camera.fov = damp(camera.fov, FOV0 + (run && speed > 2.5 ? 5 : 0), 4, dt);
  camera.position.set(player.pos.x + rx * swayX, player.pos.y + player.eye + bobY, player.pos.z + rz * swayX);
  camera.rotation.set(player.pitch + breath, -player.yaw, player.roll);
  camera.updateMatrixWorld();
}
