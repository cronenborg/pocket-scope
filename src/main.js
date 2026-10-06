import './style.css';
import { AudioEngine } from './audio.js';
import { Renderer } from './renderer.js';
import { SignalPipeline } from './signal.js';
import { DEFAULTS, loadSettings, saveSettings } from './settings.js';
import { bindControls } from './ui.js';

const $ = (id) => document.getElementById(id);
const body = document.body;
const settings = loadSettings();

// Total beam energy per second of signal, calibrated so a mid-size circle
// at intensity 0 sits just below saturation.
const ENERGY_PER_SECOND = 1000;
const MAX_QUEUE_SECONDS = 0.2;

// ---------------------------------------------------------------- rendering

let renderer = null;
try {
  renderer = new Renderer($('scope'));
} catch (err) {
  $('start').querySelector('p').textContent = String(err.message || err);
  $('start-btn').disabled = true;
}

const pipeline = new SignalPipeline();
let geo = null;

function layout() {
  if (!renderer) return;
  geo = renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio, settings.aspect);
  pipeline.resetHistory();
  drawGraticule();
}

function drawGraticule() {
  const canvas = $('graticule');
  if (!geo) return;
  const { rect, divUnits, xRange } = geo;
  const dpr = window.devicePixelRatio || 1;
  Object.assign(canvas.style, {
    left: rect.x + 'px',
    top: rect.y + 'px',
    width: rect.w + 'px',
    height: rect.h + 'px',
  });
  canvas.width = Math.round(rect.w * dpr);
  canvas.height = Math.round(rect.h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.w, rect.h);
  if (!settings.graticule) return;

  const unit = rect.w / 2 / xRange; // CSS px per signal unit
  const div = divUnits * unit;
  const cx = rect.w / 2;
  const cy = rect.h / 2;
  ctx.strokeStyle = `hsla(${settings.hue}, 60%, 55%, 0.2)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; cx + i * div <= rect.w + 0.5; i++) {
    for (const x of i ? [cx - i * div, cx + i * div] : [cx]) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.h);
    }
  }
  for (let i = 0; cy + i * div <= rect.h + 0.5; i++) {
    for (const y of i ? [cy - i * div, cy + i * div] : [cy]) {
      ctx.moveTo(0, y);
      ctx.lineTo(rect.w, y);
    }
  }
  // Minor ticks on the centre axes.
  const minor = div / 5;
  for (let x = cx % minor; x <= rect.w; x += minor) {
    ctx.moveTo(x, cy - 3);
    ctx.lineTo(x, cy + 3);
  }
  for (let y = cy % minor; y <= rect.h; y += minor) {
    ctx.moveTo(cx - 3, y);
    ctx.lineTo(cx + 3, y);
  }
  ctx.stroke();

  // Trigger level marker in sweep mode.
  if (settings.mode === 'sweep') {
    const ty = cy - settings.trigger * unit;
    ctx.fillStyle = `hsla(${settings.hue}, 80%, 60%, 0.6)`;
    ctx.beginPath();
    ctx.moveTo(0, ty - 5);
    ctx.lineTo(7, ty);
    ctx.lineTo(0, ty + 5);
    ctx.fill();
  }
}

function beamColor(hue) {
  // HSV(hue, 1, 1) -> rgb, then a little white so hot spots bloom to white.
  const f = (n) => {
    const k = (n + hue / 60) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((c) => 0.1 + 0.9 * c);
}

// ---------------------------------------------------------------- audio

let queue = [];
let queued = 0;

const audio = new AudioEngine({
  onSamples(l, r) {
    queue.push(l, r);
    queued += l.length;
    // If frames stall (tab hidden), drop the oldest audio instead of piling up.
    const max = audio.sampleRate * MAX_QUEUE_SECONDS;
    while (queued > max) {
      queued -= queue[0].length;
      queue.splice(0, 2);
    }
  },
});
audio.onEnded = () => {
  setStatus('Input disconnected — reconnecting…', true);
  setTimeout(() => startMic(), 600);
};

let X = new Float32Array(8192);
let Y = new Float32Array(8192);
let lastTime = performance.now();

let samplesSeen = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (!renderer || !geo) return;
  const s = settings;

  const n = queued;
  samplesSeen += n;
  if (X.length < n) {
    X = new Float32Array(n * 2);
    Y = new Float32Array(n * 2);
  }
  const g = 2 ** s.gain;
  const sx = s.invertX ? -g : g;
  const sy = s.invertY ? -g : g;
  let o = 0;
  for (let c = 0; c < queue.length; c += 2) {
    const a = s.swapXY ? queue[c + 1] : queue[c];
    const b = s.swapXY ? queue[c] : queue[c + 1];
    for (let i = 0; i < a.length; i++, o++) {
      X[o] = a[i] * sx;
      Y[o] = b[i] * sy;
    }
  }
  queue = [];
  queued = 0;

  const color = beamColor(s.hue);
  if (s.freeze) {
    renderer.frame({ frozen: true, color, glow: s.glow });
    return;
  }

  let count;
  let perSample = 1;
  if (s.mode === 'xy') {
    count = pipeline.xy(X, Y, n, s.upsample);
    if (s.upsample) perSample = 4;
  } else {
    count = pipeline.sweepTrace(X, n, {
      xRange: geo.xRange,
      divUnits: geo.divUnits,
      samplesPerDiv: (s.msPerDiv / 1000) * audio.sampleRate,
      trigger: s.trigger,
    });
  }

  const tau = s.persistence * s.persistence * 3; // seconds
  renderer.frame({
    segs: pipeline.segs,
    count,
    energy: (ENERGY_PER_SECOND * 10 ** s.intensity) / audio.sampleRate / perSample,
    focus: s.focus,
    fade: tau > 0 ? Math.exp(-dt / tau) : 0,
    frozen: false,
    color,
    glow: s.glow,
  });
}

// ---------------------------------------------------------------- input / devices

const statusEl = $('status');
const deviceSelect = $('device-select');
const powerBtn = $('power-btn');

function setStatus(text, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
}

let deviceSignature = '';
async function refreshDevices() {
  const inputs = await AudioEngine.listInputs();
  const signature = inputs.map((d) => d.deviceId).join('|');
  const changed = signature !== deviceSignature;
  deviceSignature = signature;
  deviceSelect.replaceChildren(new Option('Default microphone', ''));
  inputs
    .filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .forEach((d, i) => deviceSelect.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
  const known = [...deviceSelect.options].some((o) => o.value === settings.deviceId);
  deviceSelect.value = known ? settings.deviceId : '';
  return changed;
}

let starting = false;
async function startMic() {
  if (starting) return;
  starting = true;
  setStatus('Starting…');
  try {
    const info = await audio.start(settings.deviceId);
    const mono = info.channels < 2;
    setStatus(
      `${info.label} · ${mono ? 'mono' : 'stereo'} · ${info.sampleRate / 1000} kHz` +
        (mono ? ' — mono input draws a diagonal in XY; Sweep mode shows the waveform.' : ''),
    );
    powerBtn.textContent = 'Stop';
    powerBtn.classList.add('on');
    requestWakeLock();
    await refreshDevices();
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    const missing = err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError');
    if (missing && settings.deviceId) {
      // The chosen device (e.g. an unplugged USB mic) is gone: fall back to default.
      settings.deviceId = '';
      saveSettings(settings);
      starting = false;
      return startMic();
    }
    setStatus(
      denied
        ? 'Microphone permission denied (it needs HTTPS or localhost, and an allowed permission).'
        : `Could not open microphone: ${err.message || err}`,
      true,
    );
  } finally {
    starting = false;
  }
}

function stopMic() {
  audio.stop();
  powerBtn.textContent = 'Start';
  powerBtn.classList.remove('on');
  setStatus('Stopped');
}

powerBtn.addEventListener('click', () => (audio.running ? stopMic() : startMic()));

deviceSelect.addEventListener('change', () => {
  settings.deviceId = deviceSelect.value;
  saveSettings(settings);
  if (audio.running) startMic();
});

// Plugging/unplugging a USB-C mic fires devicechange. With "Default" selected,
// reopen so the stream follows the newly routed device.
let deviceTimer = 0;
navigator.mediaDevices?.addEventListener('devicechange', () => {
  clearTimeout(deviceTimer);
  deviceTimer = setTimeout(async () => {
    const changed = await refreshDevices();
    if (changed && audio.running && (settings.deviceId === '' || deviceSelect.value !== settings.deviceId)) {
      settings.deviceId = deviceSelect.value;
      startMic();
    }
  }, 500);
});

// ---------------------------------------------------------------- screen helpers

async function requestWakeLock() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  // The browser drops wake locks whenever the page is hidden.
  if (document.visibilityState === 'visible' && audio.running) requestWakeLock();
});

async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation?.lock?.('landscape');
  } catch {}
}

async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  else await enterFullscreen();
}

// Installed as an app with display "fullscreen", the system bars are already hidden.
// (Standalone or a home-screen shortcut still show them, so the Fullscreen API is used there.)
const launchedFullscreen = () => matchMedia('(display-mode: fullscreen)').matches;

// Chrome leaves fullscreen whenever it must show browser UI, notably the microphone
// permission prompt that follows "Tap to start". Fullscreen can only be re-entered
// from a user gesture, so any tap on the scope does it, and a hint says so.
function updateFullscreenHint() {
  const off = document.fullscreenEnabled && !document.fullscreenElement && !launchedFullscreen();
  body.classList.toggle('not-fullscreen', off);
}
document.addEventListener('fullscreenchange', updateFullscreenHint);
$('stage').addEventListener('click', () => {
  if (body.classList.contains('started') && !document.fullscreenElement && !launchedFullscreen()) enterFullscreen();
});

// ---------------------------------------------------------------- panel

function setPanel(open) {
  body.classList.toggle('panel-open', open);
  $('panel').setAttribute('aria-hidden', String(!open));
}

$('menu-btn').addEventListener('click', () => setPanel(true));
$('close-btn').addEventListener('click', () => setPanel(false));
$('backdrop').addEventListener('click', () => setPanel(false));
$('fs-btn').addEventListener('click', toggleFullscreen);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'h') setPanel(!body.classList.contains('panel-open'));
});

let saveTimer = 0;
function onChange(key) {
  if (key === 'aspect') layout();
  if (key === 'mode' || key === 'upsample' || key === 'swapXY') pipeline.resetHistory();
  if (key === 'hue' || key === 'graticule' || key === 'mode' || key === 'trigger') applyLook();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(settings), 300);
}

function applyLook() {
  document.documentElement.style.setProperty('--hue', settings.hue);
  body.classList.toggle('mode-sweep', settings.mode === 'sweep');
  drawGraticule();
}

const refreshControls = bindControls($('panel'), settings, onChange);

$('reset-btn').addEventListener('click', () => {
  Object.assign(settings, DEFAULTS, { deviceId: settings.deviceId, freeze: false });
  saveSettings(settings);
  refreshControls();
  layout();
  applyLook();
});

$('start-btn').addEventListener('click', () => {
  body.classList.add('started');
  enterFullscreen();
  startMic();
});

// ---------------------------------------------------------------- install

// Chrome fires beforeinstallprompt only when the app is installable; keep it for
// the "Install app" button so the user gets a real fullscreen app, not a shortcut.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install-btn').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install-btn').hidden = true;
});
$('install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-btn').hidden = true;
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------------------------------------------------------------- boot

window.addEventListener('resize', layout);
screen.orientation?.addEventListener?.('change', layout);
layout();
applyLook();
refreshDevices();
updateFullscreenHint();
requestAnimationFrame(tick);

if (import.meta.env.DEV) {
  window.__scope = { audio, renderer, pipeline, settings, stats: () => ({ queued, samplesSeen, geo }) };
}
