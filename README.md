# Pocket Scope

A microphone-driven XY / sweep oscilloscope for the phone, in the spirit of Neil Thapen's
[XXY Oscilloscope](https://dood.al/oscilloscope/). It's made for a **Samsung Galaxy S21 in landscape**:
the scope fills the screen, and every control lives in a panel opened from a small icon in the corner.

**Live:** https://oscilloscope.gianpa.com. On Android, open it in Chrome and use **Install app** in the
control panel, so it runs fullscreen and locked to landscape.

## Features

- **Microphone input only:** the built-in mic or a **USB-C** microphone / audio interface, picked from a
  device list that follows plugging and unplugging. Echo cancellation, noise suppression and auto-gain are off.
  The mic is never played back, so there's no feedback.
- **XY mode** (left = X, right = Y) for Lissajous figures and oscilloscope music from a stereo source.
- **Sweep mode** with time/div (0.1–50 ms) and a rising-edge trigger with auto free-run, which suits the
  mono built-in mic.
- **Physically based beam:** each sample is a gaussian beam segment, with persistence, glow,
  white-hot highlights and a choice of phosphor hue. It runs on WebGL2.
- **Phone-first:** fullscreen with landscape lock, the screen kept awake, an installable app that works
  offline, and settings saved on the device.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5180
npm run dev:phone    # https://<pc-lan-ip>:5180 for testing on the phone (self-signed cert; the mic needs HTTPS)
npm run build        # production build in dist/
npm run deploy       # publish to AWS (see docs/deployment.md)
```

## Documentation

| Document | Contents |
|---|---|
| [docs/usage.md](docs/usage.md) | Installing on the phone, fullscreen, inputs (mono vs stereo, USB-C), every control |
| [docs/architecture.md](docs/architecture.md) | Audio graph, signal pipeline, WebGL beam rendering, screen handling, installable-app setup |
| [docs/deployment.md](docs/deployment.md) | AWS infrastructure (S3, CloudFront, ACM, Route 53), the deploy script, rollback |

## Project layout

```
index.html                 page shell and control panel
src/                       app code (main, audio, signal, renderer, ui, settings, style)
public/worklets/capture.js AudioWorklet that taps the microphone stream
public/sw.js               service worker (network-first, offline fallback)
public/manifest.webmanifest, public/icon*   installable-app manifest and icons
infra/frontend.yml         CloudFormation: S3 + CloudFront + ACM + Route 53
scripts/deploy.sh          build, upload, invalidate, smoke test
scripts/icons.mjs          renders the PNG icons from the SVGs
```

## Ideas

- On-screen readouts (Vpp, frequency) in sweep mode.
- Both channels at once in sweep mode.

## Credits

Inspired by the [XXY Oscilloscope](https://dood.al/oscilloscope/) by Neil Thapen and by
[woscope](https://github.com/m1el/woscope) by m1el, whose gaussian-beam line rendering pioneered the
approach. Pocket Scope is a separate implementation, and none of their code is used.

## License

Copyright (C) 2026 cronenborg.

Pocket Scope is free software: you can redistribute it and/or modify it under the terms of the
**GNU Lesser General Public License** as published by the Free Software Foundation, either version 3 of
the License, or (at your option) any later version. See [LICENSE](LICENSE) (LGPL-3.0) and
[COPYING](COPYING) (GPL-3.0, which the LGPL builds on).

It's distributed in the hope that it will be useful, but **without any warranty**; without even the
implied warranty of merchantability or fitness for a particular purpose.
