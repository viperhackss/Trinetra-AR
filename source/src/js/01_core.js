import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
const ASSETS = './assets/';

/* ---------- small helpers ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
const wrap360 = (d) => ((d % 360) + 360) % 360;
const wrap180 = (d) => wrap360(d + 180) - 180;
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const dampAngle = (cur, target, rate, dt) => { let d = target - cur; d = Math.atan2(Math.sin(d), Math.cos(d)); return cur + d * (1 - Math.exp(-rate * dt)); };
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const bearingTo = (fx, fz, tx, tz) => wrap360(Math.atan2(tx - fx, -(tz - fz)) / DEG);
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(20261017);
const rr = (a, b) => a + (b - a) * rand();
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const TOUCH = ('ontouchstart' in window) || !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

const COL = { cyan: '#3fe0e6', green: '#5fe08c', amber: '#ffb547', red: '#ff5d52', white: '#f2f6f7', grey: '#9aa7ac', ink: '#e6eef0', muted: '#8ea2a9' };
const FONT = '"Barlow Semi Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

/* ---------- settings (per-viewer convenience only) ---------- */
const DEFAULTS = { night: false, sun: 'golden', quality: TOUCH ? 'medium' : 'high', autoRes: true, motionLook: false, haptics: true, foldLayout: true, glassesFov: false, stereo: false, sound: true, imperial: false, sixdof: true, mesh: true, rtk: false, mirrorAuto: true, ping: true };
let settings = { ...DEFAULTS };
let userQuality = false;
try { const s = JSON.parse(localStorage.getItem('kite-hud-settings') || '{}'); userQuality = 'quality' in s; settings = { ...DEFAULTS, ...s, stereo: false, motionLook: false }; } catch (e) { /* storage blocked: keep defaults */ }
const URLP = new URLSearchParams(location.search);
function saveSettings() { try { localStorage.setItem('kite-hud-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } }

const state = {
  view: 'start',      // start | field | helmet
  vision: 'clear',    // clear | lowlight | thermal | outline | fused
  t: 0, rt: 0, frame: 0,
  menu: null,         // { level, sel, vx, vy, t0 }
  pingHold: null,     // { t0, wheel, sel, vx, vy }
  mapPing: null,      // { x, z }
  mirrorManual: false, mirrorUntil: -1, mirrorAnim: 0,
  minimapRange: 150,
  battery: 100, batteryDrain: false,
  locked: false,
  hint: '', hintA: 0,
  yawAccum: 0, moved: 0,
};

const bus = { fns: {}, on(e, f) { (this.fns[e] = this.fns[e] || []).push(f); }, emit(e, d) { (this.fns[e] || []).forEach((f) => f(d)); } };

function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- audio ---------- */
let actx = null, master = null;
function initAudio() {
  if (actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = 0.16; master.connect(actx.destination); } catch (e) { actx = null; }
}
function tone(freqs, dur = 0.12, pan = 0, type = 'sine', gain = 1) {
  if (!actx || !settings.sound) return;
  try {
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime + 0.01;
    freqs.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      let out = g;
      if (actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); out = p; }
      out.connect(master);
      o.type = type; o.frequency.value = f;
      const st = t0 + i * dur * 0.85;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.9 * gain, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
      o.connect(g); o.start(st); o.stop(st + dur + 0.05);
    });
  } catch (e) { /* audio is optional */ }
}
