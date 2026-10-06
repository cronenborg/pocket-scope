import { DEFAULTS } from './settings.js';

const signed = (d) => (v) => (v >= 0 ? '+' : '') + v.toFixed(d);

const FORMAT = {
  intensity: signed(2),
  gain: signed(2),
  trigger: signed(2),
  focus: (v) => v.toFixed(2),
  persistence: (v) => v.toFixed(2),
  glow: (v) => v.toFixed(2),
  hue: (v) => Math.round(v) + '°',
};

/**
 * Two-way binds every [data-key] control inside root to settings[key].
 * Returns a function that pushes the current settings back into the controls.
 */
export function bindControls(root, settings, onChange) {
  const syncers = [];

  root.querySelectorAll('input[type="range"][data-key]').forEach((el) => {
    const key = el.dataset.key;
    const out = el.parentElement.querySelector('output');
    const show = () => {
      if (out) out.textContent = (FORMAT[key] || String)(settings[key]);
    };
    const set = (v) => {
      settings[key] = v;
      el.value = v;
      show();
      onChange(key);
    };
    syncers.push(() => {
      el.value = settings[key];
      show();
    });
    el.addEventListener('input', () => set(parseFloat(el.value)));
    el.parentElement.querySelector('span')?.addEventListener('dblclick', (e) => {
      e.preventDefault();
      set(DEFAULTS[key]);
    });
  });

  root.querySelectorAll('input[type="checkbox"][data-key]').forEach((el) => {
    const key = el.dataset.key;
    syncers.push(() => (el.checked = !!settings[key]));
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      onChange(key);
    });
  });

  root.querySelectorAll('select[data-key]').forEach((el) => {
    const key = el.dataset.key;
    const numeric = el.dataset.type === 'number';
    syncers.push(() => (el.value = String(settings[key])));
    el.addEventListener('change', () => {
      settings[key] = numeric ? parseFloat(el.value) : el.value;
      onChange(key);
    });
  });

  root.querySelectorAll('.seg[data-key]').forEach((seg) => {
    const key = seg.dataset.key;
    const buttons = [...seg.querySelectorAll('button')];
    const show = () => buttons.forEach((b) => b.classList.toggle('on', b.dataset.value === settings[key]));
    syncers.push(show);
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        settings[key] = b.dataset.value;
        show();
        onChange(key);
      }),
    );
  });

  const refresh = () => syncers.forEach((f) => f());
  refresh();
  return refresh;
}
