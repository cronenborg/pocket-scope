# Architecture

Pocket Scope is a static single-page app: Vite + vanilla JavaScript, WebGL2 and the Web Audio API.
There's no framework and no backend, and the production bundle is about 21 kB of JavaScript.

```
microphone ─► MediaStreamSource ─► capture AudioWorklet ─► zero-gain node ─► destination
                                          │ 512-sample stereo blocks (postMessage)
                                          ▼
                                main thread queue ─► SignalPipeline ─► segments ─► Renderer (WebGL2)
                                                       (XY / sweep)                    │
                                                                                       ▼
                                          fade ─► additive beam segments ─► glow ─► tone-mapped composite
```

## Files

| File | Role |
|---|---|
| `index.html` | Page shell: scope canvas, graticule canvas, start screen, control panel markup |
| `src/main.js` | Wiring: frame loop, sample queue, device handling, fullscreen, wake lock, install prompt, service-worker registration |
| `src/audio.js` | `AudioEngine`: opens the microphone, builds the audio graph, lists input devices |
| `public/worklets/capture.js` | AudioWorklet that taps the stereo stream in 512-sample blocks |
| `src/signal.js` | `SignalPipeline`: turns samples into beam segments (XY with upsampling, or triggered sweep) |
| `src/renderer.js` | `Renderer`: the WebGL2 beam simulation |
| `src/ui.js` | Two-way binding between `[data-key]` controls and the settings object |
| `src/settings.js` | Defaults, plus load/save to `localStorage` |
| `src/style.css` | Layout, control panel, hints; colours derive from the `--hue` custom property |
| `public/manifest.webmanifest`, `public/sw.js`, `public/icon*` | Installable-app support (see below) |
| `scripts/icons.mjs` | Renders the PNG icons from the SVGs with `sharp` |
| `scripts/deploy.sh`, `infra/frontend.yml` | Deployment (see [deployment.md](deployment.md)) |

## Audio

- `getUserMedia` is called with `echoCancellation`, `noiseSuppression` and `autoGainControl` off and
  `channelCount: { ideal: 2 }`, so stereo devices stay stereo.
- The capture worklet copies its input to its output and sends each 512-frame block to the main thread,
  moving the buffers rather than copying them.
- The worklet must be pulled by the graph to keep running. It's connected to the destination through
  a gain of **0**, so the microphone is never audible.
- The main-thread queue is capped at 0.2 s. If frames stall (for example while the page is hidden),
  the oldest audio is dropped instead of piling up.
- `devicechange` events (a USB-C mic plugged in or out) refresh the device list. The stream reopens when
  *Default* is selected or the chosen device is gone. An `ended` track triggers an automatic reconnect.

## Signal pipeline

Every animation frame drains the queue, applies gain, swap and invert, and builds an array of segments
(`x0, y0, x1, y1`) in signal units, where ±1 is full scale.

- **XY mode:** one segment per sample interval. With *Upsampling* on, each interval is split into
  4 Catmull-Rom sub-segments. The last 3 raw points of each frame carry over to the next, so the trace is
  continuous across frames.
- **Sweep mode:** the left channel (after swap) is plotted against time. When a sweep reaches the right
  edge, the pipeline waits for a rising edge through the trigger level. If none comes within two screen
  widths, it starts anyway (auto mode).

## Rendering (WebGL2)

The beam is simulated physically rather than drawn as lines.

1. **Beam segments.** Each segment is an instanced quad. Its fragment shader evaluates the energy a
   gaussian beam deposits while moving along the segment at constant speed: an `erf` difference along the
   segment, times a gaussian across it. Every sample interval lasts the same time, so fast strokes are dim
   and slow ones bright, as on a real CRT. Segments are drawn with additive blending.
2. **Accumulation and persistence.** Energy accumulates in an `RGBA16F` texture. Each frame the previous
   image is multiplied by `exp(-dt / τ)`, where τ comes from the *Persistence* slider. The two buffers swap
   every frame. The fade pass clamps values to keep half-float overflow from ever becoming a permanent
   bright spot. Without float render targets it falls back to `RGBA8`.
3. **Glow.** A quarter-resolution downsample plus a separable 9-tap gaussian blur.
4. **Composite.** `colour = 1 − exp(−energy × weights)` per channel, where the weights are the
   *Hue* colour plus a little white. The dominant channel saturates first, and very bright spots bloom
   to white.

The graticule is a separate 2D canvas on top, redrawn only on resize or settings changes. Render targets
are capped at 2048 px per side, and the device pixel ratio at 3.

## Screen handling

- **Layout:** *Fill* (the default) uses the whole viewport; *Square* uses a centred square. One signal unit
  is half the shorter side in both cases, so a circle stays round.
- **Fullscreen:** requested on *Tap to start*. Chrome leaves fullscreen to show the microphone permission
  prompt and only re-enters it from a user gesture. So whenever the page isn't fullscreen, a hint is shown
  and any tap on the scope calls `requestFullscreen()` plus `screen.orientation.lock('landscape')`.
  An app launched with `display-mode: fullscreen` is already fullscreen and skips this.
- **Wake lock:** `navigator.wakeLock` keeps the screen on while the microphone runs. It's re-acquired
  when the page becomes visible again.

## Installable app

Chrome installs a site as a real app (a WebAPK on Android) only when it has a manifest with PNG icons
(192 and 512 px) and a service worker. Otherwise "Add to Home screen" just makes a shortcut that opens in
a browser tab.

- `manifest.webmanifest`: `display: fullscreen`, `orientation: landscape`, PNG icons, plus a maskable
  icon for Android's adaptive icon shapes.
- `sw.js`: network-first. Online it always serves the latest deploy; offline it falls back to the last
  cached copy. It's registered only in production builds.
- `beforeinstallprompt` is captured to show the **Install app** button in the control panel.

## Development helpers

- `npm run dev` serves on port **5180**, fixed so it doesn't clash with other local Vite projects.
- `npm run dev:phone` serves the same over HTTPS on the LAN with a self-signed certificate
  (`@vitejs/plugin-basic-ssl`). Phones only allow microphone access on a secure origin.
- In dev builds, `window.__scope` exposes `{ audio, renderer, pipeline, settings, stats() }` for inspection.
  To test without a stereo source, replace `navigator.mediaDevices.getUserMedia` in the console with a
  function that returns an `OscillatorNode` stream (two oscillators into a `ChannelMergerNode` and a
  `MediaStreamAudioDestinationNode`).
