# Using Pocket Scope

Live at **https://oscilloscope.gianpa.com**. The app is built for a Samsung Galaxy S21 in landscape
(800 × 360 CSS px at 3× pixel density), and works in any recent Chrome.

## Install it on the phone (recommended)

Installed as an app, it opens **fullscreen and locked to landscape**, with no address bar or system bars.

1. Open https://oscilloscope.gianpa.com in Chrome on the phone.
2. Open the controls (the small icon in the bottom-right corner) and tap **Install app (fullscreen)**
   under *Screen*. If the button isn't there, use Chrome's **⋮ → Add to Home screen** and choose
   **Install**, not "Create shortcut".
3. Launch it from the new home-screen icon.

A home-screen **shortcut** isn't the same thing: it opens in a normal Chrome tab, where the manifest's
fullscreen and landscape settings don't apply. If you have an old shortcut, delete it and install as above.

## Using it in the browser

- **Tap to start** turns on the microphone and asks for fullscreen.
- The microphone permission prompt can take Chrome out of fullscreen. A browser can only enter fullscreen
  right after a tap, so a hint *"Tap the screen for fullscreen"* appears. One tap anywhere on the scope
  brings it back.
- After a reload the page can never go fullscreen by itself; the first tap does it.

## Inputs

- **Microphone only.** It uses the system default, or a specific device chosen in the *Input* section.
- **USB-C microphones and audio interfaces** appear in the device list once the microphone permission has
  been granted. The list refreshes when a device is plugged in or out. With *Default microphone* selected,
  the stream reopens on the newly routed device. If the selected device disappears, it falls back to the default.
- Echo cancellation, noise suppression and automatic gain are turned off, so the raw waveform reaches the scope.
- The microphone is never played back through the speaker, so there's no feedback.

### Mono vs stereo

XY mode plots **left = X** and **right = Y**, so it needs a **stereo** source. The S21's built-in microphone
is mono, and in XY mode a mono signal is a 45° diagonal line. Use **Sweep** mode to see the waveform from
a mono source. A stereo USB-C audio interface gives real XY (Lissajous / oscilloscope-music) figures.
The status line under the device list shows whether the current input is mono or stereo.

## Controls

The controls slide in from the right when you tap the icon in the bottom-right corner. Tap outside the
panel, or the ✕, to close it. On a desktop keyboard, `Esc` or `h` toggles it.

| Section | Control | What it does |
|---|---|---|
| Input | Device, Start/Stop | Picks the microphone; the status line shows device · mono/stereo · sample rate |
| Mode | XY / Sweep | XY plots left vs right; Sweep plots the signal over time |
| | Time / div | Sweep speed, 0.1–50 ms per division (Sweep only) |
| | Trigger | Level for the rising-edge trigger, marked by a small arrow on the left edge. With no trigger it free-runs (Sweep only) |
| Beam | Intensity | Beam brightness (log scale) |
| | Focus | Beam width |
| | Persistence | How long the phosphor glows after the beam passes |
| | Glow | Strength of the halo around bright lines |
| | Hue | Phosphor colour, also used for the graticule and the controls |
| Signal | Gain | Display gain (log scale) |
| | Swap X / Y, Invert X, Invert Y | Re-map the channels |
| | Upsampling | 4× curve interpolation between samples for smoother XY figures |
| | Freeze | Holds the current image |
| Screen | Square / Fill | Scope area as a centred square, or across the full screen width (default) |
| | Graticule | Shows or hides the grid |
| | Install app | Shown only when Chrome offers the install (see above) |
| | Reset all settings | Restores the defaults (keeps the chosen microphone) |

- **Double-tap a slider's label** to reset that slider.
- Settings are saved on the device and restored on the next visit. *Freeze* is never saved.
- The screen stays awake while the microphone is running.

## Graticule scale

A full-scale signal (±1) reaches the top and bottom edges. In *Fill* mode the vertical axis has
8 divisions and the horizontal axis extends further on a wide screen; in *Square* mode there are
10 × 10 divisions. In Sweep mode, *Time / div* refers to these divisions.
