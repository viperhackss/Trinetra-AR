/* ---------- 2D HUD (drawn per eye on a canvas above WebGL) ---------- */
const hudCanvas = $('#hud');
const hctx = hudCanvas.getContext('2d');
const _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _o = new THREE.Vector3(), _h3 = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const F = (w, px, mono) => `${w} ${Math.max(9, px).toFixed(1)}px ${mono ? MONO : FONT}`;
const VISION_LABEL = { clear: 'Clear', lowlight: 'Low Light', thermal: 'Thermal', outline: 'Outline', fused: 'Fused' };

function proj(x, y, z, cam, L) {
  _v3.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
  const front = -_v3.z;
  _v3.applyMatrix4(cam.projectionMatrix);
  return { x: L.ex + (_v3.x * 0.5 + 0.5) * L.ew, y: (1 - (_v3.y * 0.5 + 0.5)) * L.eh, front };
}
function rrect(ctx, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function label(ctx, text, x, y, color, font, align = 'center', base = 'middle') {
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 3; ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.shadowBlur = 0;
}
function drawShape(ctx, shape, x, y, s, color, alpha = 1, pulse = 0) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath();
  if (shape === 'diamond') { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); }
  else if (shape === 'tri') { ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.95, y + s * 0.75); ctx.lineTo(x - s * 0.95, y + s * 0.75); ctx.closePath(); }
  else rrect(ctx, x - s * 0.95, y - s * 0.62, s * 1.9, s * 1.24, s * 0.3);
  ctx.fill(); ctx.stroke();
  if (pulse > 0) { ctx.globalAlpha = alpha * (1 - pulse); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * (1.5 + pulse * 3.2), 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
let hatchPat = null;
function hatch(ctx) {
  if (hatchPat) return hatchPat;
  const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,93,82,0.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
  hatchPat = ctx.createPattern(c, 'repeat'); return hatchPat;
}
function occludedBetween(from, to) {
  _dir.subVectors(to, from); const dist = _dir.length(); if (dist < 0.6) return false;
  _dir.normalize(); raycaster.set(from, _dir); raycaster.far = dist - 0.5;
  return raycaster.intersectObjects(occluders, false).length > 0;
}
function gazeHit(maxD = 15) {
  camera.getWorldDirection(_dir); _o.copy(camera.position);
  raycaster.set(_o, _dir); raycaster.far = maxD;
  const hits = raycaster.intersectObjects(occluders, false);
  let best = hits.length ? hits[0].distance : Infinity;
  for (let d = 0.4; d < Math.min(best, maxD); d += 0.2) {
    const x = _o.x + _dir.x * d, y = _o.y + _dir.y * d, z = _o.z + _dir.z * d;
    if (y <= heightAt(x, z)) { best = d; break; }
  }
  if (!(best <= maxD)) return null;
  return new THREE.Vector3().copy(_o).addScaledVector(_dir, best);
}
function lookedPing() {
  camera.getWorldDirection(_dir);
  let best = null, bestA = 4;
  for (const p of pings) {
    const dist = Math.hypot(p.x - camera.position.x, p.z - camera.position.z), hgt = clamp(dist * 0.06, 1.6, 9);
    for (const yy of [p.y, p.y + hgt]) {
      _h3.set(p.x - camera.position.x, yy - camera.position.y, p.z - camera.position.z).normalize();
      const a = Math.acos(clamp(_h3.dot(_dir), -1, 1)) / DEG;
      if (a < bestA) { bestA = a; best = p; }
    }
  }
  return best;
}

/* ---------- icons for alert cards ---------- */
function drawIcon(ctx, icon, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.4, s * 0.12); ctx.lineCap = 'round';
  ctx.beginPath();
  if (icon === 'rf') { ctx.moveTo(0, s * 0.9); ctx.lineTo(0, -s * 0.1); ctx.moveTo(-s * 0.35, s * 0.9); ctx.lineTo(0, -s * 0.1); ctx.lineTo(s * 0.35, s * 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.45, -2.4, -0.74); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.8, -2.4, -0.74); }
  else if (icon === 'radar') { ctx.arc(0, s * 0.6, s * 0.4, -2.5, -0.64); ctx.stroke(); ctx.beginPath(); ctx.arc(0, s * 0.6, s * 0.85, -2.5, -0.64); ctx.stroke(); ctx.beginPath(); ctx.arc(0, s * 0.6, s * 0.12, 0, 7); ctx.fill(); ctx.beginPath(); }
  else if (icon === 'drone') { ctx.moveTo(-s * 0.6, -s * 0.6); ctx.lineTo(s * 0.6, s * 0.6); ctx.moveTo(s * 0.6, -s * 0.6); ctx.lineTo(-s * 0.6, s * 0.6); ctx.stroke(); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(a * s * 0.65, b * s * 0.65, s * 0.3, 0, 7); ctx.stroke(); } ctx.beginPath(); }
  else if (icon === 'battery') { rrect(ctx, -s * 0.8, -s * 0.42, s * 1.45, s * 0.84, s * 0.12); ctx.stroke(); ctx.beginPath(); ctx.rect(s * 0.68, -s * 0.18, s * 0.16, s * 0.36); ctx.fill(); ctx.beginPath(); ctx.rect(-s * 0.62, -s * 0.24, s * 0.4, s * 0.48); ctx.fill(); ctx.beginPath(); }
  else if (icon === 'pin') { ctx.moveTo(0, -s * 0.8); ctx.lineTo(s * 0.55, -s * 0.2); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.55, -s * 0.2); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(0, s * 0.4); ctx.lineTo(0, s * 0.95); }
  else if (icon === 'mate') { ctx.arc(0, -s * 0.5, s * 0.28, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-s * 0.6, s * 0.9); ctx.quadraticCurveTo(0, -s * 0.2, s * 0.6, s * 0.9); }
  else if (icon === 'track') { ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.85); ctx.moveTo(0, 0); ctx.lineTo(s * 0.75, s * 0.45); ctx.moveTo(0, 0); ctx.lineTo(-s * 0.75, s * 0.45); }
  else { ctx.arc(0, 0, s * 0.8, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -s * 0.1); ctx.lineTo(0, s * 0.45); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -s * 0.38, s * 0.07, 0, 7); ctx.fill(); ctx.beginPath(); }
  ctx.stroke(); ctx.restore();
}
function drawStance(ctx, st, cx, by, h, color) {
  // pictogram standing on baseline `by`, total height h
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.4, h * 0.07); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const k = h;
  ctx.beginPath();
  if (st === 0) {
    ctx.arc(cx, by - k * 0.9, k * 0.09, 0, 7); ctx.fill(); ctx.beginPath();
    ctx.moveTo(cx, by - k * 0.78); ctx.lineTo(cx, by - k * 0.45); ctx.lineTo(cx - k * 0.12, by); ctx.moveTo(cx, by - k * 0.45); ctx.lineTo(cx + k * 0.12, by);
    ctx.moveTo(cx - k * 0.16, by - k * 0.5); ctx.lineTo(cx, by - k * 0.72); ctx.lineTo(cx + k * 0.16, by - k * 0.5);
  } else if (st === 1) {
    ctx.arc(cx + k * 0.05, by - k * 0.86, k * 0.1, 0, 7); ctx.fill(); ctx.beginPath();
    ctx.moveTo(cx + k * 0.02, by - k * 0.72); ctx.lineTo(cx - k * 0.05, by - k * 0.38); ctx.lineTo(cx + k * 0.25, by - k * 0.38); ctx.lineTo(cx + k * 0.25, by);
    ctx.moveTo(cx - k * 0.05, by - k * 0.38); ctx.lineTo(cx - k * 0.22, by); ctx.lineTo(cx - k * 0.45, by);
    ctx.moveTo(cx, by - k * 0.62); ctx.lineTo(cx + k * 0.25, by - k * 0.55);
  } else {
    const y = by - k * 0.15;
    ctx.arc(cx - k * 0.75, y - k * 0.05, k * 0.11, 0, 7); ctx.fill(); ctx.beginPath();
    ctx.moveTo(cx - k * 0.6, y); ctx.lineTo(cx + k * 0.1, y); ctx.lineTo(cx + k * 0.75, y + k * 0.06);
    ctx.moveTo(cx - k * 0.55, y); ctx.lineTo(cx - k * 0.95, y + k * 0.1);
  }
  ctx.stroke(); ctx.restore();
}

/* ---------- main HUD draw ---------- */
let mateOccSeen = 0;
function drawHUD() {
  const ctx = hctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (state.view === 'helmet') { drawHelmetLabels(ctx); return; }
  if (state.view !== 'field') return;
  for (const e of eyes) drawEye(ctx, e);
}
function drawEye(ctx, e) {
  const L = e.L, r = L.r;
  ctx.save();
  ctx.beginPath(); ctx.rect(e.x, 0, e.w, L.eh); ctx.clip();
  if (settings.glassesFov) drawGlassesFrame(ctx, L);
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  if (settings.sixdof) drawWorldMarkers(ctx, e);
  drawCompass(ctx, e);
  drawMirrorFrame(ctx, L);
  if (state.mapPing) drawBigMap(ctx, L); else drawMinimap(ctx, L);
  drawDronePanel(ctx, L);
  drawAlert(ctx, L);
  drawCenter(ctx, e);
  drawStatus(ctx, L);
  ctx.restore();
}
function drawGlassesFrame(ctx, L) {
  const r = L.r, u = L.u;
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath(); rrect(ctx, r.x, r.y, r.w, r.h, u * 1.2); ctx.stroke();
  label(ctx, 'GLASSES DISPLAY AREA · 50° × 29°', r.x + u, r.y - u * 0.9, 'rgba(255,255,255,0.55)', F(500, u * 0.9, true), 'left', 'bottom');
  ctx.restore();
}

/* ---------- compass ring ---------- */
function ringMarks() {
  const out = [], px = player.pos.x, pz = player.pos.z, now = state.t;
  for (const m of MATES) { if (!m.rep) continue; const age = now - m.rep.t; out.push({ b: bearingTo(px, pz, m.rep.x, m.rep.z), shape: 'square', color: age > 30 ? COL.grey : COL.cyan, alpha: age > 5 ? 0.55 : 1 }); }
  for (const p of pings) { const age = now - p.t; out.push({ b: bearingTo(px, pz, p.x, p.z), shape: 'diamond', color: PING_TYPES[p.type].color, alpha: 1, pulse: age < 2 ? age / 2 : 0 }); }
  if (droneLink(now) && Math.hypot(drone.pos.x - px, drone.pos.z - pz) > 2) out.push({ b: bearingTo(px, pz, drone.pos.x, drone.pos.z), shape: 'tri', color: COL.cyan, alpha: 0.9 });
  if (alertCur && alertCur.pos) out.push({ b: bearingTo(px, pz, alertCur.pos.x, alertCur.pos.z), shape: 'diamond', color: alertCur.level === 'critical' ? COL.red : alertCur.level === 'warning' ? COL.amber : COL.white, alpha: 1, scale: 1.25 });
  return out;
}
function drawCompass(ctx, e) {
  const L = e.L, r = L.r, cam = e.cam, u = L.u, head = camera.position;
  const hdg = wrap360(player.yaw / DEG), el = L.ringElev * DEG, ce = Math.cos(el), se = Math.sin(el), R = 10;
  const P = (b) => proj(head.x + R * Math.sin(b * DEG) * ce, head.y + R * se, head.z - R * Math.cos(b * DEG) * ce, cam, L);
  const span = Math.min(88, L.halfH + 14);
  const pts = [];
  for (let d = -span; d <= span; d += 2) { const p = P(hdg + d); if (p.front > 0.05) pts.push(p); }
  if (pts.length < 2) return;
  const fade = (x) => { const t = (x - r.x) / r.w; return clamp(Math.min(t, 1 - t) / 0.14, 0, 1); };
  const grad = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
  grad.addColorStop(0, 'rgba(214,222,226,0)'); grad.addColorStop(0.14, 'rgba(214,222,226,0.32)'); grad.addColorStop(0.86, 'rgba(214,222,226,0.32)'); grad.addColorStop(1, 'rgba(214,222,226,0)');
  ctx.save();
  ctx.strokeStyle = grad; ctx.lineWidth = L.band; ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
  const b0 = Math.ceil((hdg - span) / 5) * 5;
  for (let b = b0; b <= hdg + span; b += 5) {
    const p = P(b); if (p.front <= 0.05) continue;
    const a = fade(p.x); if (a <= 0.01) continue;
    const bb = wrap360(Math.round(b)), major = bb % 15 === 0;
    if (bb % 90 === 0) { label(ctx, 'NESW'[bb / 90], p.x, p.y + 1, `rgba(255,255,255,${0.96 * a})`, F(700, u * 1.4)); continue; }
    ctx.strokeStyle = `rgba(255,255,255,${(major ? 0.8 : 0.45) * a})`; ctx.lineWidth = major ? 1.6 : 1.1;
    const h = major ? L.band * 0.62 : L.band * 0.3;
    ctx.beginPath(); ctx.moveTo(p.x, p.y + L.band / 2 - 1); ctx.lineTo(p.x, p.y + L.band / 2 - 1 - h); ctx.stroke();
    if (bb % 30 === 0) label(ctx, String(bb), p.x, p.y - L.band / 2 - u * 0.7, `rgba(255,255,255,${0.75 * a})`, F(500, u * 0.92, true));
  }
  // centre notch and heading readout
  const c = P(hdg);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.moveTo(c.x, c.y + L.band / 2 + 2); ctx.lineTo(c.x - u * 0.45, c.y + L.band / 2 + 2 + u * 0.62); ctx.lineTo(c.x + u * 0.45, c.y + L.band / 2 + 2 + u * 0.62); ctx.closePath(); ctx.fill();
  label(ctx, `${Math.round(hdg) % 360}°`, c.x, c.y + L.band / 2 + u * 1.75, 'rgba(255,255,255,0.92)', F(500, u * 1.05, true));
  // markers
  let nl = 0, nr = 0;
  for (const mk of ringMarks()) {
    const rel = wrap180(mk.b - hdg), p = P(mk.b);
    const inView = p.front > 0.05 && p.x > r.x + u * 2.5 && p.x < r.x + r.w - u * 2.5 && Math.abs(rel) < span;
    if (inView) drawShape(ctx, mk.shape, p.x, p.y, u * 0.6 * (mk.scale || 1), mk.color, Math.min(1, mk.alpha * fade(p.x) + 0.25), mk.pulse || 0);
    else {
      const left = rel < 0, k = left ? nl++ : nr++;
      const end = left ? pts[0] : pts[pts.length - 1];
      const x = left ? r.x + u * 2.2 : r.x + r.w - u * 2.2, y = clamp(end.y, r.y + u * 2, r.y + r.h * 0.5) + L.band * 0.9 + k * u * 1.9;
      ctx.save(); ctx.globalAlpha = mk.alpha;
      ctx.fillStyle = mk.color; ctx.beginPath();
      if (left) { ctx.moveTo(x - u * 0.9, y); ctx.lineTo(x - u * 0.3, y - u * 0.45); ctx.lineTo(x - u * 0.3, y + u * 0.45); }
      else { ctx.moveTo(x + u * 0.9, y); ctx.lineTo(x + u * 0.3, y - u * 0.45); ctx.lineTo(x + u * 0.3, y + u * 0.45); }
      ctx.closePath(); ctx.fill();
      drawShape(ctx, mk.shape, x + (left ? u * 0.75 : -u * 0.75), y, u * 0.48, mk.color, 1);
      label(ctx, `${Math.round(Math.abs(rel))}°`, x + (left ? u * 1.6 : -u * 1.6), y, 'rgba(255,255,255,0.85)', F(500, u * 0.85, true), left ? 'left' : 'right');
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ---------- world-pinned markers ---------- */
function drawWorldMarkers(ctx, e) {
  const L = e.L, cam = e.cam, u = L.u, now = state.t;
  ctx.save();
  for (const p of pings) {
    const dist = Math.hypot(p.x - player.pos.x, p.z - player.pos.z), hgt = clamp(dist * 0.06, 1.6, 9);
    const a = proj(p.x, p.y, p.z, cam, L), b = proj(p.x, p.y + hgt, p.z, cam, L);
    if (a.front < 0.3 || b.front < 0.3) continue;
    const col = PING_TYPES[p.type].color;
    ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, u * 0.16);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(a.x, a.y, clamp(u * 9 / Math.max(dist, 1), u * 0.25, u * 1.6), clamp(u * 3 / Math.max(dist, 1), u * 0.1, u * 0.55), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    const age = now - p.t;
    drawShape(ctx, 'diamond', b.x, b.y, u * 0.72, col, 1, age < 2 ? age / 2 : 0);
    label(ctx, `${PING_TYPES[p.type].label.toUpperCase()} · ${Math.round(dist)} m`, b.x, b.y - u * 1.15, col, F(600, u * 1.0), 'center', 'bottom');
    if (p.author !== 'ALPHA-1') label(ctx, p.author, b.x, b.y + u * 1.0, 'rgba(255,255,255,0.75)', F(500, u * 0.8, true), 'center', 'top');
  }
  if (drone.alt > 3 && droneLink(now)) {
    const d = proj(drone.pos.x, drone.pos.y + 0.5, drone.pos.z, cam, L);
    if (d.front > 1) {
      ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1.5; const s = u * 0.7;
      ctx.beginPath(); ctx.moveTo(d.x, d.y - s); ctx.lineTo(d.x + s, d.y); ctx.lineTo(d.x, d.y + s); ctx.lineTo(d.x - s, d.y); ctx.closePath(); ctx.stroke();
      label(ctx, `${drone.name.toUpperCase()} · ${Math.round(drone.alt)} m`, d.x, d.y - s - u * 0.4, COL.cyan, F(600, u * 0.9), 'center', 'bottom');
    }
  }
  for (const m of MATES) drawMate(ctx, e, m);
  ctx.restore();
}
function drawMate(ctx, e, m) {
  if (!m.rep) return;
  const L = e.L, cam = e.cam, u = L.u, rep = m.rep, now = state.t, age = now - rep.t;
  const dist = Math.hypot(rep.x - player.pos.x, rep.z - player.pos.z);
  if (dist > 260 || dist < 1.2) return;
  const st = rep.stance, H = [1.85, 1.2, 0.5][st], wid = Math.max(0.6, 1.6 * rep.acc), len = st === 2 ? Math.max(1.9, wid) : wid;
  const fx = Math.sin(rep.yaw), fz = -Math.cos(rep.yaw), rx = Math.cos(rep.yaw), rz = Math.sin(rep.yaw);
  const cx = rep.x + (st === 2 ? fx * 0.8 : 0), cz = rep.z + (st === 2 ? fz * 0.8 : 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, 1]) {
    const p = proj(cx + rx * sx * wid / 2 + fx * sz * len / 2, rep.y + sy * H, cz + rz * sx * wid / 2 + fz * sz * len / 2, cam, L);
    if (p.front < 0.3) return;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const headY = rep.y + headHeight(st), hx = rep.x + (st === 2 ? fx * 1.5 : 0), hz = rep.z + (st === 2 ? fz * 1.5 : 0);
  const occ = occludedBetween(camera.position, _h3.set(hx, headY, hz).clone());
  const lost = age > 30, stale = age > 5;
  const alpha = lost ? 0.45 : stale ? lerp(1, 0.4, (age - 5) / 25) : 1;
  const col = lost ? COL.grey : COL.cyan;
  // trail of reported positions over the last 5 s
  ctx.fillStyle = col;
  for (const t of m.trail) {
    const p = proj(t.x, t.y + 0.05, t.z, cam, L); if (p.front < 0.3) continue;
    ctx.globalAlpha = alpha * clamp(1 - (now - t.t) / 5, 0, 1) * 0.7; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, u * 0.18), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.6, u * 0.2);
  const bw = x1 - x0, bh = y1 - y0;
  if (!occ) {
    const c = Math.min(bw, bh) * 0.28;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + c); ctx.lineTo(x0, y0); ctx.lineTo(x0 + c, y0);
    ctx.moveTo(x1 - c, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + c);
    ctx.moveTo(x1, y1 - c); ctx.lineTo(x1, y1); ctx.lineTo(x1 - c, y1);
    ctx.moveTo(x0 + c, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - c);
    ctx.stroke();
  } else {
    ctx.setLineDash([Math.max(3, u * 0.55), Math.max(3, u * 0.45)]);
    ctx.beginPath(); ctx.rect(x0, y0, bw, bh); ctx.stroke(); ctx.setLineDash([]);
    const ph = Math.min(bh * 0.8, bw * (st === 2 ? 0.45 : 1.4));
    drawStance(ctx, st, (x0 + x1) / 2, y1 - bh * 0.08, ph, col);
    // facing arrow: up = facing the same way as you
    const rel = rep.yaw - player.yaw, ax = (x0 + x1) / 2, ay = y1 + u * 1.3;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(rel); ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(0, -u * 0.6); ctx.lineTo(u * 0.42, u * 0.4); ctx.lineTo(0, u * 0.18); ctx.lineTo(-u * 0.42, u * 0.4); ctx.closePath(); ctx.fill(); ctx.restore();
    if (x1 > L.r.x && x0 < L.r.x + L.r.w && !lost) { mateOccSeen += 1 / 60; if (mateOccSeen > 1) bus.emit('mateocc'); }
  }
  label(ctx, `${m.call}  ${Math.round(dist)} m`, (x0 + x1) / 2, y0 - u * 0.45, col, F(600, u * 0.95), 'center', 'bottom');
  if (stale) label(ctx, lost ? 'signal lost' : `last seen ${Math.round(age)} s`, (x0 + x1) / 2, y0 - u * 1.65, 'rgba(255,255,255,0.7)', F(500, u * 0.78, true), 'center', 'bottom');
  ctx.globalAlpha = 1;
}

/* ---------- mirror frame ---------- */
function drawMirrorFrame(ctx, L) {
  const a = state.mirrorAnim; if (a < 0.02) return;
  const m = L.mirror, u = L.u, h = (m.h - 6) * a + 6;
  ctx.save(); ctx.globalAlpha = a;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); rrect(ctx, m.x, m.y, m.w, h, u * 0.6); ctx.stroke();
  label(ctx, 'REAR', m.x + u * 0.8, m.y + h + u * 0.25, 'rgba(255,255,255,0.7)', F(600, u * 0.8, true), 'left', 'top');
  ctx.restore();
}

/* ---------- minimap ---------- */
function mapIcons(ctx, toMap, R, u, rimClamp) {
  const now = state.t;
  const put = (x, z, fn) => { let p = toMap(x, z); let out = false; if (rimClamp) { const d = Math.hypot(p.x, p.y), lim = R - u * 0.7; if (d > lim) { p = { x: (p.x / d) * lim, y: (p.y / d) * lim }; out = true; } } fn(p, out); };
  for (const p of pings) put(p.x, p.z, (q, out) => drawShape(ctx, 'diamond', q.x, q.y, u * 0.55, PING_TYPES[p.type].color, out ? 0.6 : 1, now - p.t < 2 ? (now - p.t) / 2 : 0));
  if (droneLink(now)) put(drone.pos.x, drone.pos.z, (q, out) => drawShape(ctx, 'tri', q.x, q.y, u * 0.55, COL.cyan, out ? 0.6 : 0.95));
  for (const m of MATES) { if (!m.rep) continue; const age = now - m.rep.t; put(m.rep.x, m.rep.z, (q, out) => drawShape(ctx, 'square', q.x, q.y, u * 0.5, age > 30 ? COL.grey : COL.cyan, (age > 5 ? 0.55 : 1) * (out ? 0.65 : 1))); }
  if (alertCur && alertCur.pos) put(alertCur.pos.x, alertCur.pos.z, (q) => drawShape(ctx, 'diamond', q.x, q.y, u * 0.6, alertCur.level === 'warning' ? COL.amber : alertCur.level === 'critical' ? COL.red : COL.white, 1));
}
function drawMinimap(ctx, L) {
  const { r: R, cx, cy } = L.mini, u = L.u, yaw = player.yaw, s = R / state.minimapRange, off = R * 0.2, tilt = 0.8;
  const px = player.pos.x, pz = player.pos.z, c = Math.cos(-yaw), sn = Math.sin(-yaw);
  const toMap = (x, z) => { const dx = (x - px) * s, dz = (z - pz) * s; return { x: dx * c - dz * sn, y: dx * sn + dz * c + off }; };
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1, tilt);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(18,24,27,0.7)'; ctx.fillRect(-R, -R, 2 * R, 2 * R);
  ctx.save(); ctx.translate(0, off); ctx.rotate(-yaw);
  ctx.globalAlpha = settings.night ? 0.72 : 0.94;
  ctx.drawImage(sat, (-HALF - px) * s, (-HALF - pz) * s, WORLD * s, WORLD * s);
  ctx.globalAlpha = 1;
  ctx.beginPath(); ZONE.forEach(([x, z], i) => { const X = (x - px) * s, Z = (z - pz) * s; if (i) ctx.lineTo(X, Z); else ctx.moveTo(X, Z); }); ctx.closePath();
  ctx.fillStyle = hatch(ctx); ctx.fill(); ctx.strokeStyle = 'rgba(255,93,82,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
  const fovH = L.halfH * DEG;
  const cg = ctx.createRadialGradient(0, off, 0, 0, off, R * 1.3); cg.addColorStop(0, 'rgba(255,255,255,0.32)'); cg.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(0, off); ctx.arc(0, off, R * 1.4, -Math.PI / 2 - fovH, -Math.PI / 2 + fovH); ctx.closePath(); ctx.fill();
  mapIcons(ctx, toMap, R, u, true);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, off - u * 1.0); ctx.lineTo(u * 0.75, off + u * 0.6); ctx.lineTo(0, off + u * 0.25); ctx.lineTo(-u * 0.75, off + u * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  for (let b = 0; b < 360; b += 10) {
    const a = (b - yaw / DEG) * DEG, len = b % 30 === 0 ? u * 0.9 : u * 0.42, r0 = R + u * 0.3;
    ctx.lineWidth = b % 90 === 0 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); ctx.lineTo(Math.sin(a) * (r0 + len), -Math.cos(a) * (r0 + len)); ctx.stroke();
  }
  ctx.restore();
  // north indicator and heading (not tilted)
  const ty = cy - R * tilt - u * 1.5;
  label(ctx, 'N', cx - R * 0.98, ty, '#fff', F(700, u * 1.25), 'center');
  ctx.save(); ctx.translate(cx - R * 0.98 + u * 1.55, ty); ctx.rotate(-yaw); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, u * 0.6); ctx.lineTo(0, -u * 0.6); ctx.moveTo(-u * 0.4, -u * 0.2); ctx.lineTo(0, -u * 0.6); ctx.lineTo(u * 0.4, -u * 0.2); ctx.stroke(); ctx.restore();
  label(ctx, `${Math.round(wrap360(yaw / DEG)) % 360}°`, cx + R * 0.95, ty, '#fff', F(700, u * 1.5), 'right');
  label(ctx, `${state.minimapRange} m`, cx, cy + R * tilt + u * 1.5, 'rgba(255,255,255,0.7)', F(500, u * 0.85, true), 'center');
}
function drawBigMap(ctx, L) {
  const r = L.r, u = L.u, R = Math.min(r.w, r.h) * 0.38, cx = r.x + r.w / 2, cy = r.y + r.h / 2, range = 220, s = R / range;
  state.mapPing.mpp = range / R;
  const px = player.pos.x, pz = player.pos.z, mp = state.mapPing;
  const toMap = (x, z) => ({ x: (x - px) * s, y: (z - pz) * s });
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(8,12,14,0.8)'; ctx.beginPath(); ctx.arc(0, 0, R + u * 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(sat, (-HALF - px) * s, (-HALF - pz) * s, WORLD * s, WORLD * s);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
  for (let g = Math.ceil((px - range) / 50) * 50; g <= px + range; g += 50) { const X = (g - px) * s; ctx.beginPath(); ctx.moveTo(X, -R); ctx.lineTo(X, R); ctx.stroke(); }
  for (let g = Math.ceil((pz - range) / 50) * 50; g <= pz + range; g += 50) { const Z = (g - pz) * s; ctx.beginPath(); ctx.moveTo(-R, Z); ctx.lineTo(R, Z); ctx.stroke(); }
  ctx.beginPath(); ZONE.forEach(([x, z], i) => { const q = toMap(x, z); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath();
  ctx.fillStyle = hatch(ctx); ctx.fill(); ctx.strokeStyle = 'rgba(255,93,82,0.9)'; ctx.stroke();
  mapIcons(ctx, toMap, R, u, false);
  ctx.save(); ctx.rotate(player.yaw); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -u * 1.1); ctx.lineTo(u * 0.8, u * 0.7); ctx.lineTo(0, u * 0.3); ctx.lineTo(-u * 0.8, u * 0.7); ctx.closePath(); ctx.fill(); ctx.restore();
  const q = toMap(mp.x, mp.z);
  ctx.strokeStyle = COL.green; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(q.x, q.y, u * 0.9, 0, 7); ctx.moveTo(q.x - u * 1.8, q.y); ctx.lineTo(q.x - u * 0.5, q.y); ctx.moveTo(q.x + u * 0.5, q.y); ctx.lineTo(q.x + u * 1.8, q.y); ctx.moveTo(q.x, q.y - u * 1.8); ctx.lineTo(q.x, q.y - u * 0.5); ctx.moveTo(q.x, q.y + u * 0.5); ctx.lineTo(q.x, q.y + u * 1.8); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
  label(ctx, 'N', 0, -R - u * 1.3, '#fff', F(700, u * 1.3));
  const b = bearingTo(px, pz, mp.x, mp.z), d = Math.hypot(mp.x - px, mp.z - pz);
  label(ctx, `MAP PING  ·  ${Math.round(b)}°  ·  ${Math.round(d)} m`, 0, R + u * 1.6, COL.green, F(600, u * 1.1, true));
  label(ctx, TOUCH ? 'Drag to aim · release MAP to place' : 'Move the mouse · click or E to place · release M to close', 0, R + u * 3.1, 'rgba(255,255,255,0.75)', F(500, u * 0.95));
  ctx.restore();
}

/* ---------- drone panel ---------- */
const _dv = new THREE.Vector3();
function drawDronePanel(ctx, L) {
  const p = L.drone, u = L.u, now = state.t, W = p.w, H = p.h;
  const link = droneLink(now), video = droneVideo(now);
  ctx.save();
  ctx.setTransform(DPR, (-DPR * p.skew) / p.w, 0, DPR, DPR * p.x, DPR * p.y);
  const vv = p.v;
  ctx.fillStyle = 'rgba(44,52,56,0.55)'; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath(); rrect(ctx, 0, 0, W, H, u * 0.5); if (video) ctx.rect(vv.x, vv.y, vv.w, vv.h); ctx.fill('evenodd');
  ctx.beginPath(); rrect(ctx, 0, 0, W, H, u * 0.5); ctx.stroke();
  label(ctx, drone.name, W * 0.06, H * 0.12, '#fff', F(600, W * 0.085), 'left', 'middle');
  const stLabel = { grounded: 'On pad', takeoff: 'Take-off', transit: 'Transit', orbit: 'Orbit', return: 'Return', landing: 'Landing' }[drone.state];
  label(ctx, link ? `${stLabel} · BAT ${Math.round(drone.battery)}%` : 'Link lost', W * 0.06, H * 0.19, 'rgba(225,232,235,0.6)', F(500, W * 0.048, true), 'left', 'middle');
  ctx.fillStyle = !link ? COL.grey : video ? COL.cyan : COL.amber; ctx.fillRect(W * 0.8, H * 0.085, W * 0.13, H * 0.045);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(W * 0.06, H * 0.235, W * 0.88, 1); ctx.fillRect(W * 0.06, H * 0.335, W * 0.88, 1);
  const row = (name, value, y) => { label(ctx, name, W * 0.06, y, 'rgba(225,232,235,0.6)', F(500, W * 0.052), 'left'); label(ctx, value, W * 0.94, y, '#fff', F(600, W * 0.062, true), 'right'); };
  row('Heading', link ? `${drone.heading.toFixed(1)}°` : '- - -', H * 0.285);
  row('Altitude', link ? (settings.imperial ? `${Math.round(drone.alt * 3.281)} ft` : `${drone.alt.toFixed(1)} m`) : '- - -', H * 0.385);
  const v = p.v;
  if (!video) {
    ctx.fillStyle = 'rgba(28,34,38,0.8)'; ctx.beginPath(); rrect(ctx, v.x, v.y, v.w, v.h, u * 0.3); ctx.fill();
    label(ctx, 'No Video', v.x + v.w / 2, v.y + v.h * 0.4, '#fff', F(600, W * 0.075), 'center');
    label(ctx, 'Connection', v.x + v.w / 2, v.y + v.h * 0.62, '#fff', F(600, W * 0.075), 'center');
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.rect(v.x, v.y, v.w, v.h); ctx.stroke();
    const mark = (x, y, z, color, s) => {
      _dv.set(x, y, z).applyMatrix4(droneCam.matrixWorldInverse); if (-_dv.z < 1) return;
      _dv.applyMatrix4(droneCam.projectionMatrix); if (Math.abs(_dv.x) > 1 || Math.abs(_dv.y) > 1) return;
      const X = v.x + (_dv.x * 0.5 + 0.5) * v.w, Y = v.y + (1 - (_dv.y * 0.5 + 0.5)) * v.h;
      ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.strokeRect(X - s / 2, Y - s / 2, s, s);
    };
    for (const m of MATES) if (m.rep) mark(m.rep.x, m.rep.y + 0.9, m.rep.z, COL.cyan, W * 0.045);
    mark(player.pos.x, player.pos.y + 0.9, player.pos.z, '#ffffff', W * 0.045);
    label(ctx, settings.night ? 'IR · WHITE HOT' : 'EO · DAY', v.x + W * 0.02, v.y + v.h - W * 0.03, 'rgba(255,255,255,0.8)', F(500, W * 0.038, true), 'left', 'bottom');
    label(ctx, `${Math.round(120 + Math.sin(now * 0.7) * 25)} ms`, v.x + v.w - W * 0.02, v.y + v.h - W * 0.03, 'rgba(255,255,255,0.65)', F(500, W * 0.034, true), 'right', 'bottom');
  }
  ctx.restore();
}

/* ---------- alert card ---------- */
function drawAlert(ctx, L) {
  const a = alertCur; if (!a) return;
  const p = L.alert, W = p.w, H = p.h, t = state.t - a.shown, k = REDUCED ? 1 : sstep(0, 0.25, t);
  const edge = a.level === 'critical' ? COL.red : a.level === 'warning' ? COL.amber : 'rgba(255,255,255,0.55)';
  ctx.save(); ctx.globalAlpha = k;
  ctx.setTransform(DPR, (-DPR * p.skew) / p.w, 0, DPR, DPR * (p.x + (1 - k) * W * 0.25), DPR * p.y);
  ctx.fillStyle = 'rgba(44,52,56,0.62)'; ctx.strokeStyle = edge; ctx.lineWidth = a.level === 'critical' ? 2.4 : 1.4;
  ctx.beginPath(); rrect(ctx, 0, 0, W, H, H * 0.08); ctx.fill(); ctx.stroke();
  label(ctx, a.title, W * 0.06, H * 0.3, '#fff', F(600, H * 0.21), 'left');
  label(ctx, a.detail, W * 0.06, H * 0.52, 'rgba(225,232,235,0.72)', F(500, H * 0.145), 'left');
  label(ctx, fmtTime(state.t - a.t0), W * 0.06, H * 0.74, 'rgba(225,232,235,0.8)', F(500, H * 0.13, true), 'left');
  const life = ALERT_LIFE[a.level], frac = isFinite(life) ? clamp(1 - t / life, 0, 1) : 1;
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(W * 0.06, H * 0.86, W * 0.88, Math.max(2, H * 0.03));
  ctx.fillStyle = a.level === 'critical' ? COL.red : '#fff'; ctx.fillRect(W * 0.06, H * 0.86, W * 0.88 * frac, Math.max(2, H * 0.03));
  if (!isFinite(life)) label(ctx, TOUCH ? 'ACK to clear' : 'Space to clear', W * 0.94, H * 0.74, COL.red, F(600, H * 0.12, true), 'right');
  else if (alertQ.length) label(ctx, `+${alertQ.length}`, W * 0.94, H * 0.74, '#fff', F(600, H * 0.14, true), 'right');
  drawIcon(ctx, a.icon, W * 0.88, H * 0.3, H * 0.17, a.level === 'info' ? '#fff' : edge);
  ctx.restore();
}

/* ---------- radial menu, ping wheel, reticle ---------- */
const VISION_ITEMS = [{ id: 'lowlight', label: 'Low Light' }, { id: 'fused', label: 'Fused' }, { id: 'outline', label: 'Outline' }, { id: 'sensors', label: 'Sensors' }, { id: 'clear', label: 'Clear' }, { id: 'thermal', label: 'Thermal' }];
const SENSOR_ITEMS = [{ id: 'sixdof', label: '6DOF' }, { id: 'mesh', label: 'Mesh' }, { id: 'rtk', label: 'RTK' }, { id: 'back', label: 'Back' }, { id: 'mirrorAuto', label: 'Mirror auto' }, { id: 'ping', label: 'Ping' }];
function menuItems(level) {
  if (level === 'vision') return VISION_ITEMS.map((it) => ({ ...it, current: it.id === state.vision }));
  if (level === 'ping') return PING_ORDER.map((id) => ({ id, label: PING_TYPES[id].label, dot: PING_TYPES[id].color }));
  return SENSOR_ITEMS.map((it) => ({ ...it, state: it.id === 'back' ? '' : settings[it.id] ? 'ON' : 'OFF' }));
}
function drawRadial(ctx, cx, cy, Ro, items, sel, title, age) {
  const k = REDUCED ? 1 : sstep(0, 0.15, age), R = Ro * (0.88 + 0.12 * k), Ri = R * 0.6, n = items.length, seg = (Math.PI * 2) / n, gap = 0.035;
  ctx.save(); ctx.globalAlpha = k;
  for (let i = 0; i < n; i++) {
    const mid = -Math.PI / 2 + i * seg, a0 = mid - seg / 2 + gap, a1 = mid + seg / 2 - gap, it = items[i];
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.arc(cx, cy, Ri, a1, a0, true); ctx.closePath();
    ctx.fillStyle = i === sel ? 'rgba(215,221,225,0.44)' : 'rgba(165,174,180,0.27)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1; ctx.stroke();
    if (i === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2.5, R * 0.028); ctx.beginPath(); ctx.arc(cx, cy, Ri + R * 0.05, a0 + 0.07, a1 - 0.07); ctx.stroke(); }
    const lr = (R + Ri) / 2, lx = cx + Math.cos(mid) * lr, ly = cy + Math.sin(mid) * lr;
    label(ctx, it.label, lx, ly, i === sel ? '#fff' : 'rgba(255,255,255,0.82)', F(600, Math.max(11, R * 0.095)));
    if (it.state) { const sr = Ri * 0.8; label(ctx, it.state, cx + Math.cos(mid) * sr, cy + Math.sin(mid) * sr, it.state === 'ON' ? '#fff' : 'rgba(255,255,255,0.5)', F(500, Math.max(9, R * 0.065), true)); }
    if (it.current) { ctx.fillStyle = COL.cyan; ctx.beginPath(); ctx.arc(cx + Math.cos(mid) * (R - R * 0.07), cy + Math.sin(mid) * (R - R * 0.07), Math.max(2.5, R * 0.022), 0, 7); ctx.fill(); }
    if (it.dot) drawShape(ctx, 'diamond', cx + Math.cos(mid) * (Ri * 0.78), cy + Math.sin(mid) * (Ri * 0.78), Math.max(4, R * 0.045), it.dot, 1);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, Ri * 0.6, 0, 7); ctx.stroke();
  label(ctx, title, cx, cy, 'rgba(255,255,255,0.7)', F(600, Math.max(9, R * 0.07), true));
  ctx.restore();
}
function drawReticle(ctx, x, y, u, color = 'rgba(255,255,255,0.85)') {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, u * 0.55, 0, 7); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill(); ctx.restore();
}
function drawCenter(ctx, e) {
  const L = e.L, u = L.u, c = L.menu, cam = e.cam;
  if (state.menu) {
    drawRadial(ctx, c.cx, c.cy, c.Ro, menuItems(state.menu.level), state.menu.sel, state.menu.level === 'vision' ? 'VISION' : 'SENSORS', state.rt - state.menu.t0);
    const tip = state.menu.sticky ? (TOUCH ? 'Drag on MENU, then touch MENU to select' : 'Move the mouse, then Q or click to select · Esc closes') : (TOUCH ? 'Drag toward a segment, release to select' : 'Move the mouse to a segment, release Q to select');
    label(ctx, tip, c.cx, c.cy + c.Ro + u * 1.6, 'rgba(255,255,255,0.8)', F(500, u * 0.95));
    return;
  }
  const cpt = proj(camera.position.x + Math.sin(player.yaw) * Math.cos(player.pitch) * 30, camera.position.y + Math.sin(player.pitch) * 30, camera.position.z - Math.cos(player.yaw) * Math.cos(player.pitch) * 30, cam, L);
  if (state.pingHold) {
    drawReticle(ctx, cpt.x, cpt.y, u);
    const g = state.gaze;
    if (g) {
      const a = proj(g.x, g.y, g.z, cam, L), b = proj(g.x, g.y + 1.6, g.z, cam, L);
      const type = state.pingHold.wheel && state.pingHold.sel >= 0 ? PING_ORDER[state.pingHold.sel] : 'waypoint', col = PING_TYPES[type].color;
      ctx.save(); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(state.t * 8) ** 2; ctx.strokeStyle = col; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      drawShape(ctx, 'diamond', b.x, b.y, u * 0.65, col, 0.85);
      label(ctx, `${Math.round(g.distanceTo(camera.position))} m`, b.x, b.y - u * 1.1, col, F(600, u * 0.95, true), 'center', 'bottom');
    } else label(ctx, 'Out of range (15 m) · hold M for a map ping', cpt.x, cpt.y + u * 2, COL.amber, F(600, u * 1.0));
    if (state.pingHold.wheel) drawRadial(ctx, c.cx, c.cy, c.Ro * 0.72, menuItems('ping'), state.pingHold.sel, 'PING', state.rt - state.pingHold.t0 - 0.28);
    return;
  }
  const lp = state.looked;
  if (lp && settings.ping) {
    drawReticle(ctx, cpt.x, cpt.y, u * 0.8, 'rgba(255,255,255,0.6)');
    if (lp.author === 'ALPHA-1') label(ctx, TOUCH ? 'Hold PING to remove' : 'X or hold E to remove', cpt.x, cpt.y + u * 1.8, 'rgba(255,255,255,0.8)', F(500, u * 0.9));
  }
}

/* ---------- status line and hints ---------- */
function drawStatus(ctx, L) {
  const r = L.r, u = L.u, y = L.bottom - u * 1.3;
  const items = [
    [VISION_LABEL[state.vision].toUpperCase(), true], [settings.sixdof ? '6DOF' : '3DOF FALLBACK', settings.sixdof],
    [settings.mesh ? 'MESH' : 'MESH OFF', settings.mesh], [settings.rtk ? 'RTK' : 'RTK OFF', settings.rtk || null],
    [`BAT ${Math.round(state.battery)}%`, state.battery >= 20],
  ];
  ctx.save(); ctx.font = F(500, u * 0.85, true);
  const sep = '   ';
  const widths = items.map(([t]) => ctx.measureText(t).width), sw = ctx.measureText(sep).width;
  let x = r.x + r.w / 2 - (widths.reduce((a, b) => a + b, 0) + sw * (items.length - 1)) / 2;
  items.forEach(([t, ok], i) => { label(ctx, t, x, y, ok === false ? COL.amber : ok === null ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.72)', F(500, u * 0.85, true), 'left'); x += widths[i] + sw; });
  if (state.hint && state.hintA > 0.01) {
    ctx.globalAlpha = state.hintA;
    ctx.font = F(600, u * 1.05);
    const w = ctx.measureText(state.hint).width + u * 2.4, hy = y - u * 2.4;
    ctx.fillStyle = 'rgba(10,14,16,0.6)'; ctx.beginPath(); rrect(ctx, r.x + r.w / 2 - w / 2, hy - u * 0.95, w, u * 1.9, u * 0.95); ctx.fill();
    label(ctx, state.hint, r.x + r.w / 2, hy, '#fff', F(600, u * 1.05));
  }
  ctx.restore();
}
