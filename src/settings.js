const KEY = 'pocket-scope.settings.v1';

export const DEFAULTS = {
  deviceId: '',        // '' = system default microphone
  mode: 'xy',          // 'xy' | 'sweep'
  msPerDiv: 1,
  trigger: 0,
  gain: 0,             // log2 display gain
  intensity: 0,        // log10 beam energy
  focus: 1,            // beam radius, CSS px
  persistence: 0.2,
  glow: 0.5,
  hue: 125,
  swapXY: false,
  invertX: false,
  invertY: false,
  upsample: true,
  graticule: true,
  aspect: 'fill',      // 'square' | 'fill'
};

// Not persisted: a frozen screen should never come back after a reload.
const TRANSIENT = ['freeze'];

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {}
  return { ...DEFAULTS, ...saved, freeze: false };
}

export function saveSettings(s) {
  const out = { ...s };
  TRANSIENT.forEach((k) => delete out[k]);
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {}
}
