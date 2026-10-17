/* ---------- checklist (feature tour) ---------- */
const TASKS = [
  { id: 'look', text: 'Turn your head and watch the compass ring', hint: 'Move the mouse to look around', hintT: 'Drag on the view to look around' },
  { id: 'move', text: 'Move 10 m', hint: 'W A S D to move · Shift to run', hintT: 'Use the left stick to move' },
  { id: 'zoom', text: 'Change the minimap range', hint: 'Mouse wheel or - and = change the minimap range', hintT: 'Open Settings to see all controls' },
  { id: 'vision', text: 'Change the vision mode', hint: 'Hold Q, move the mouse to a mode, release Q', hintT: 'Hold MENU, drag to a mode, release' },
  { id: 'mate', text: 'See a teammate behind a wall', hint: 'Find a dashed cyan outline: a teammate behind cover', hintT: 'Find a dashed cyan outline: a teammate behind cover' },
  { id: 'ping', text: 'Make a ping', hint: 'Look at the ground within 15 m and press E', hintT: 'Look at the ground within 15 m and touch PING' },
  { id: 'mapping', text: 'Make a map ping', hint: 'Hold M, move the cursor, click', hintT: 'Hold MAP, drag the cursor, release' },
  { id: 'mirror', text: 'Open the rearview mirror', hint: 'Press R for the rearview mirror', hintT: 'Touch MIRROR' },
  { id: 'ack', text: 'Acknowledge an alert', hint: 'Press Space to clear an alert card', hintT: 'Touch ACK to clear an alert card' },
  { id: 'night', text: 'Use Thermal or Fused at night', hint: 'Press N for night, then hold Q and pick Thermal', hintT: 'Settings → Night, then MENU → Thermal' },
  { id: 'sensors', text: 'Change a sensor in the Sensors ring', hint: 'Hold Q → Sensors, then pick RTK and press Q', hintT: 'MENU → Sensors → RTK' },
  { id: 'helmet', text: 'Explode the helmet', hint: 'Press H, then Explode', hintT: 'Touch Helmet, then Explode' },
  { id: 'stereo', text: 'Try the stereo 3D view', hint: 'Press V for side-by-side 3D', hintT: 'Settings → Stereo 3D' },
];
const done = new Set();
try { JSON.parse(localStorage.getItem('kite-hud-done') || '[]').forEach((id) => done.add(id)); } catch (e) { /* ignore */ }
function mark(id) {
  if (done.has(id)) return;
  done.add(id); try { localStorage.setItem('kite-hud-done', JSON.stringify([...done])); } catch (e) { /* ignore */ }
  renderChecklist(); tone([1046, 1568], 0.08, 0, 'sine', 0.35);
  const t = TASKS.find((x) => x.id === id); if (t) toast(`Done: ${t.text}`);
}
function renderChecklist() {
  $('#checklist').innerHTML = TASKS.map((t) => `<li class="${done.has(t.id) ? 'done' : ''}">${t.text}</li>`).join('');
  $('#ck-count').textContent = `${done.size}/${TASKS.length}`;
}
const EVENT_TASK = { look: 'look', move: 'move', zoom: 'zoom', vision: 'vision', mateocc: 'mate', ping: 'ping', mapping: 'mapping', mirror: 'mirror', ack: 'ack', nightvision: 'night', sensors: 'sensors', explode: 'helmet', stereo: 'stereo' };
Object.entries(EVENT_TASK).forEach(([ev, id]) => bus.on(ev, () => mark(id)));
function updateHint(dt) {
  let want = '';
  if (state.view === 'field' && !state.menu && !state.pingHold && !state.mapPing) {
    const t = TASKS.find((x) => !done.has(x.id));
    if (t && state.t > 1.5) want = TOUCH ? t.hintT : t.hint;
  }
  if (want !== state.hint) { state.hintA = damp(state.hintA, 0, 10, dt); if (state.hintA < 0.02) state.hint = want; }
  else state.hintA = damp(state.hintA, want ? 1 : 0, 3, dt);
}

/* ---------- panel, help, views ---------- */
const PANEL_SETTINGS = ['night', 'glassesFov', 'stereo', 'sound', 'imperial', 'sixdof', 'mesh', 'rtk', 'mirrorAuto', 'ping', 'autoRes', 'motionLook', 'haptics', 'foldLayout'];
function syncPanel() { PANEL_SETTINGS.forEach((id) => { const el = $('#set-' + id); if (el) el.checked = !!settings[id]; }); syncSegs(); }
function syncDeck() {
  $$('#deck [data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === state.vision)));
  const n = $('#deck [data-d="night"]'); if (n) n.setAttribute('aria-pressed', String(!!settings.night));
  const pr = $('#deck [data-d="prone"]'); if (pr) pr.setAttribute('aria-pressed', String(player.stance === 2));
}
function syncSegs() {
  syncDeck();
  $$('#seg-quality button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === settings.quality)));
  const tod = settings.night ? 'night' : settings.sun;
  $$('#seg-sun button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === tod)));
}
$$('#seg-quality button').forEach((b) => b.addEventListener('click', () => { settings.quality = b.dataset.v; saveSettings(); applyQuality(); syncSegs(); toast(`Quality: ${b.textContent}`); }));
$$('#seg-sun button').forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.v;
  if (v === 'night') { if (!settings.night) toggleSetting('night', true); }
  else { settings.sun = v; saveSettings(); if (settings.night) toggleSetting('night', false); else { applySky(); toast(`Time of day: ${b.textContent}`); } }
  syncSegs();
  loadSky(skyKey()).then(() => applySky());
}));
PANEL_SETTINGS.forEach((id) => { const el = $('#set-' + id); el.addEventListener('change', () => toggleSetting(id, el.checked)); });
function togglePanel(force) {
  const p = $('#panel'), open = force === undefined ? p.hidden : force;
  p.hidden = !open; $('#btn-panel').setAttribute('aria-pressed', String(open));
  if (open && state.locked) document.exitPointerLock && document.exitPointerLock();
  updateLockHint();
}
function toggleHelp(force) {
  const h = $('#help'), open = force === undefined ? h.hidden : force;
  h.hidden = !open;
  if (open && state.locked) document.exitPointerLock && document.exitPointerLock();
  if (open) $('#help-close').focus();
  updateLockHint();
}
function closeOverlays() { togglePanel(false); toggleHelp(false); state.menu = null; state.pingHold = null; state.mapPing = null; }
function updateLockHint() {
  const show = state.view === 'field' && !TOUCH && !state.locked && $('#panel').hidden && $('#help').hidden;
  $('#lockhint').hidden = !show;
}
function setView(v) {
  if (v === 'helmet' && state.locked) document.exitPointerLock && document.exitPointerLock();
  state.view = v; state.menu = null; state.pingHold = null; state.mapPing = null;
  const helmetOn = v === 'helmet';
  $('#hbar').hidden = !helmetOn; $('#btn-helmet').hidden = helmetOn; $('#btn-field').hidden = !helmetOn;
  $('#touch').hidden = !(TOUCH && v === 'field');
  if (!helmetOn) $('#hcard').hidden = true; else showPartCard();
  glCanvas.style.cursor = helmetOn ? 'grab' : '';
  updateLockHint();
}
function startField() {
  initAudio(); initAmbience(); $('#start').hidden = true; setView('field');
  if (TOUCH) { enterFullscreen(); keepAwake(); }
  if (!TOUCH) { try { const r = glCanvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* no pointer lock */ } }
}
$('#go').addEventListener('click', startField);
$('#go-helmet').addEventListener('click', () => { initAudio(); initAmbience(); $('#start').hidden = true; setView('helmet'); if (TOUCH) { enterFullscreen(); keepAwake(); } });
$('#btn-helmet').addEventListener('click', () => { if (state.view === 'start') { initAudio(); $('#start').hidden = true; } setView('helmet'); });
$('#btn-field').addEventListener('click', () => setView('field'));
$('#hb-back').addEventListener('click', () => setView('field'));
$('#btn-help').addEventListener('click', () => toggleHelp());
$('#help-close').addEventListener('click', () => toggleHelp(false));
$('#help').addEventListener('click', (e) => { if (e.target.id === 'help') toggleHelp(false); });
$('#btn-panel').addEventListener('click', () => togglePanel());
$('#panel-close').addEventListener('click', () => togglePanel(false));
$('#hb-explode').addEventListener('click', () => setExplode(hState.explodeT < 0.5));
$('#hb-labels').addEventListener('click', () => { hState.labels = !hState.labels; $('#hb-labels').setAttribute('aria-pressed', String(hState.labels)); });
$('#hb-spin').addEventListener('click', () => { hState.spin = !hState.spin; $('#hb-spin').setAttribute('aria-pressed', String(hState.spin)); });
$('#hb-spin').setAttribute('aria-pressed', String(hState.spin));

/* ---------- phone and foldable helpers: full screen, screen wake lock, posture changes, Flex-mode deck ---------- */
const fsEl = document.documentElement;
const fsOK = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function enterFullscreen() { try { const r = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not allowed here */ } }
function exitFullscreen() { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ignore */ } }
function syncFs() { const b = $('#btn-fs'); b.hidden = !fsOK || (!TOUCH && !isFs()); const t = isFs() ? 'Exit full screen' : 'Full screen'; b.setAttribute('aria-label', t); b.title = t; b.setAttribute('aria-pressed', String(isFs())); }
$('#btn-fs').addEventListener('click', () => (isFs() ? exitFullscreen() : enterFullscreen()));
document.addEventListener('fullscreenchange', () => { syncFs(); setTimeout(resizeAll, 60); });
document.addEventListener('webkitfullscreenchange', () => { syncFs(); setTimeout(resizeAll, 60); });
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch (e) { wakeLock = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.view !== 'start' && TOUCH) keepAwake(); });
if (navigator.devicePosture && navigator.devicePosture.addEventListener) navigator.devicePosture.addEventListener('change', () => setTimeout(resizeAll, 80));
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', () => setTimeout(resizeAll, 120));
$$('#deck [data-v]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); setVision(b.dataset.v); syncDeck(); buzz(8); }));
$$('#deck [data-d]').forEach((b) => b.addEventListener('pointerdown', (e) => {
  e.preventDefault(); const d = b.dataset.d;
  if (d === 'night') toggleSetting('night', !settings.night);
  else if (d === 'prone') setStance(2);
  else if (d === 'map') zoomMap(state.minimapRange >= 300 ? -2 : 1);
  syncDeck();
}));
bus.on('vision', syncDeck);

/* ---------- scenario triggers ---------- */
$$('[data-trig]').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.trig;
  if (t === 'behind') {
    const m = MATES[2], fx = Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = Math.sin(player.yaw);
    const bx = player.pos.x - fx * 3.5, bz = player.pos.z - fz * 3.5;
    m.pos.set(bx - rx * 7, 0, bz - rz * 7); m.wait = 0; m.stanceTarget = 0; m.stance = 0;
    const path = [[bx - rx * 6, bz - rz * 6], [bx + rx * 7, bz + rz * 7]]; path.i = 0; m.override = path;
    toast('ALPHA-4 is walking behind you');
  } else if (t === 'rf') { alertSeen.delete('rf'); pushAlert('rf', 'RF activity', '865–867 MHz above threshold', 'info', { icon: 'rf' }); }
  else if (t === 'link') { drone.linkCutUntil = state.t + 15; alertSeen.delete('drone-link'); pushAlert('drone-link', 'Drone link lost', `${drone.name}: no heartbeat for 2 s`, 'warning', { icon: 'drone', pos: drone.pos }); }
  else if (t === 'mateping') matePing();
  else if (t === 'battery') { if (state.battery > 20) state.battery = 19.5; else state.batteryDrain = true; alertSeen.delete('batt-low'); }
  else if (t === 'reset') { player.pos.set(START.x, heightAt(START.x, START.z), START.z); player.yaw = START.yaw; player.pitch = 0; player.stance = 0; toast('Back at the start point'); }
}));

/* ---------- frame loop ---------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.max(0.001, (now - last) / 1000), dt = Math.min(0.05, real); last = now;
  state.t += dt; state.rt += Math.min(real, 0.5); state.frame++;
  autoResolution(real);
  if (state.rt - perf.shown > 0.5 && !$('#panel').hidden) { perf.shown = state.rt; $('#perf').textContent = `${Math.round(perf.fps)} fps · ${rtScene.width}×${rtScene.height}`; }
  try {
    if (state.view === 'helmet') {
      updateWorld(dt);
      updateHelmet(dt); renderHelmet();
    } else {
      if (state.view === 'start') { player.yaw += dt * (REDUCED ? 0 : 0.05); }
      updatePlayer(dt);
      if (state.pingHold && !state.pingHold.wheel && !state.pingHold.removeTarget && state.rt - state.pingHold.t0 > 0.28) state.pingHold.wheel = true;
      state.gaze = state.pingHold ? gazeHit() : null;
      state.looked = state.frame % 3 === 0 ? lookedPing() : state.looked;
      updateWorld(dt);
      renderField();
    }
    updateHint(dt);
    drawHUD();
  } catch (err) { showError(err); throw err; }
}
let errShown = false;
function showError(err) {
  if (errShown) return; errShown = true;
  const el = document.createElement('div'); el.id = 'err'; el.textContent = 'Something went wrong while drawing: ' + (err && err.message ? err.message : String(err)) + '\nReload the page to start again.';
  $('#app').appendChild(el);
}

/* ---------- loading and start ---------- */
function texReady() {
  return new Promise((res) => { const t0 = performance.now(); const chk = () => ((grassMap.image && grassNormal.image) || performance.now() - t0 > 20000 ? res() : setTimeout(chk, 60)); chk(); });
}
async function loadAssets() {
  const fill = $('#load-fill'), txt = $('#load-txt'), parts = {};
  const jobs = [];
  const show = () => { const f = Object.values(parts).reduce((a, b) => a + b, 0) / jobs.length; fill.style.width = `${Math.round(f * 100)}%`; txt.textContent = `Loading sky, terrain and teammates… ${Math.round(f * 100)}%`; };
  const prog = (id, est) => (e) => { parts[id] = Math.min(0.99, e.total ? e.loaded / e.total : e.loaded / est); show(); };
  const job = (id, p) => { parts[id] = 0; jobs.push(p.then(() => { parts[id] = 1; show(); })); };
  for (const k of new Set([skyKey(), 'noon'])) job('sky-' + k, loadSky(k, prog('sky-' + k, 1.6e6)));
  job('soldier', loadSoldier(prog('soldier', 2.1e6)));
  job('tex', texReady());
  show();
  await Promise.all(jobs);
}
async function init() {
  resizeAll();
  addEventListener('resize', resizeAll);
  syncPanel(); renderChecklist(); syncFs();
  setView('start');
  if (TOUCH) $$('.tb kbd').forEach((k) => (k.hidden = true));
  await loadAssets();
  $('#load-txt').textContent = 'Preparing shaders…';
  await new Promise((r) => setTimeout(r, 30));
  initMates();
  applySky();
  applyQuality();
  captureSatellite();
  try { renderer.compile(scene, camera); setThermal(true); renderer.compile(scene, camera); setThermal(false); } catch (e) { setThermal(false); }
  $('#load').hidden = true; $('#go').disabled = false; $('#go-helmet').disabled = false;
  requestAnimationFrame(frame);
  // the other skies load in the background
  for (const k of Object.keys(SKIES)) loadSky(k).then(() => { if (k === skyKey()) applySky(); });
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(init, init); else init();
