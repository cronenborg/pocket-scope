// Turns raw stereo sample blocks into beam segments (x0,y0,x1,y1) in signal units.

export class SignalPipeline {
  constructor() {
    this.segs = new Float32Array(4 * 16384);
    // Last raw points of the previous frame, so consecutive frames join seamlessly.
    this.hx = [];
    this.hy = [];
    this.sweep = { pos: 0, waiting: true, wait: 0, prevV: 0, has: false, px: 0, py: 0 };
  }

  reserve(n) {
    if (this.segs.length < n * 4) this.segs = new Float32Array(Math.ceil(n * 1.5) * 4);
  }

  resetHistory() {
    this.hx.length = this.hy.length = 0;
    this.sweep.has = false;
  }

  /** Catmull-Rom upsampled XY trace. Returns segment count. */
  xy(X, Y, n, upsample) {
    const U = upsample ? 4 : 1;
    const h = this.hx.length;
    const m = h + n;
    const rx = new Float32Array(m);
    const ry = new Float32Array(m);
    for (let i = 0; i < h; i++) {
      rx[i] = this.hx[i];
      ry[i] = this.hy[i];
    }
    rx.set(X.subarray(0, n), h);
    ry.set(Y.subarray(0, n), h);

    const count = Math.max(0, m - 3) * U;
    this.reserve(count);
    const s = this.segs;
    let k = 0;
    for (let i = 1; i < m - 2; i++) {
      const x0 = rx[i - 1], x1 = rx[i], x2 = rx[i + 1], x3 = rx[i + 2];
      const y0 = ry[i - 1], y1 = ry[i], y2 = ry[i + 1], y3 = ry[i + 2];
      let px = x1, py = y1;
      for (let j = 1; j <= U; j++) {
        const t = j / U, t2 = t * t, t3 = t2 * t;
        const nx = 0.5 * (2 * x1 + (x2 - x0) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (3 * x1 - x0 - 3 * x2 + x3) * t3);
        const ny = 0.5 * (2 * y1 + (y2 - y0) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (3 * y1 - y0 - 3 * y2 + y3) * t3);
        s[k++] = px; s[k++] = py; s[k++] = nx; s[k++] = ny;
        px = nx; py = ny;
      }
    }
    const keep = Math.min(3, m);
    this.hx = Array.from(rx.subarray(m - keep));
    this.hy = Array.from(ry.subarray(m - keep));
    return k / 4;
  }

  /**
   * Triggered time sweep of V (rising-edge trigger, auto free-run when no
   * trigger arrives within two screen widths). Returns segment count.
   */
  sweepTrace(V, n, { xRange, divUnits, samplesPerDiv, trigger }) {
    const st = this.sweep;
    const dx = divUnits / samplesPerDiv;
    const screen = (2 * xRange) / dx;
    this.reserve(n);
    const s = this.segs;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const v = V[i];
      if (st.waiting) {
        const crossed = st.prevV < trigger && v >= trigger;
        if (crossed || ++st.wait > screen * 2) {
          st.waiting = false;
          st.pos = -xRange;
          st.has = false;
        }
      }
      if (!st.waiting) {
        if (st.has) {
          s[k++] = st.px; s[k++] = st.py; s[k++] = st.pos; s[k++] = v;
        }
        st.px = st.pos;
        st.py = v;
        st.has = true;
        st.pos += dx;
        if (st.pos > xRange) {
          st.waiting = true;
          st.wait = 0;
        }
      }
      st.prevV = v;
    }
    return k / 4;
  }
}
