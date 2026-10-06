// Passes stereo audio through unchanged and ships the samples to the main
// thread in fixed-size blocks so the renderer sees a continuous stream.
const BLOCK = 512;

class ScopeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alloc();
  }

  alloc() {
    this.l = new Float32Array(BLOCK);
    this.r = new Float32Array(BLOCK);
    this.i = 0;
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp || inp.length === 0) return true; // nothing connected
    const l = inp[0];
    const r = inp[1] || inp[0];
    out[0].set(l);
    if (out[1]) out[1].set(r);
    for (let k = 0; k < l.length; k++) {
      this.l[this.i] = l[k];
      this.r[this.i] = r[k];
      if (++this.i === BLOCK) {
        this.port.postMessage([this.l, this.r], [this.l.buffer, this.r.buffer]);
        this.alloc();
      }
    }
    return true;
  }
}

registerProcessor('scope-capture', ScopeCapture);
