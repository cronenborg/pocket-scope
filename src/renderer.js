// WebGL2 beam renderer.
//
// Each audio sample interval is one line segment. A segment is drawn as a quad
// whose fragment shader evaluates the exact energy a gaussian beam deposits
// while moving along it at constant speed (erf along the segment, gaussian
// across it). Equal time per segment means fast-moving parts of the trace are
// dim and slow parts bright, like a real CRT.
//
// Passes per frame: fade(prev accum) -> additive segments -> downsample+blur
// (glow) -> tone-mapped composite to screen.

const QUAD_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const LINE_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg;
uniform vec2 uRes;     // target size in px
uniform float uUnit;   // px per signal unit
uniform float uSigma;  // beam radius in px
out vec2 vLocal;
flat out float vLen;
void main() {
  vec2 c = uRes * 0.5;
  vec2 a = c + aSeg.xy * uUnit;
  vec2 b = c + aSeg.zw * uUnit;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float ext = 3.0 * uSigma;
  float along = aCorner.x < 0.5 ? -ext : len + ext;
  float across = (aCorner.y * 2.0 - 1.0) * ext;
  vec2 p = a + dir * along + nrm * across;
  vLocal = vec2(along, across);
  vLen = len;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const LINE_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vLen;
uniform float uSigma;
uniform float uEnergy;
out vec4 o;
const float SQRT_PI = 1.7724539;
float erfApprox(float x) {
  float s = sign(x), a = abs(x);
  float d = 1.0 + (0.278393 + (0.230389 + 0.078108 * a * a) * a) * a;
  d *= d;
  return s - s / (d * d);
}
void main() {
  float s = uSigma;
  float across = exp(-vLocal.y * vLocal.y / (s * s));
  float along;
  if (vLen < 0.25 * s) {
    along = exp(-vLocal.x * vLocal.x / (s * s)) / (s * SQRT_PI);
  } else {
    along = 0.5 * (erfApprox(vLocal.x / s) - erfApprox((vLocal.x - vLen) / s)) / vLen;
  }
  o = vec4(uEnergy * along * across / (s * SQRT_PI), 0.0, 0.0, 1.0);
}`;

const FADE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uFade;
out vec4 o;
void main() {
  float v = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0).r * uFade;
  o = vec4(min(v, 60000.0), 0.0, 0.0, 1.0); // also scrubs half-float inf
}`;

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel; // source texel size
out vec4 o;
void main() {
  float v = texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).r
          + texture(uTex, vUv + uTexel * vec2( 1.0, -1.0)).r
          + texture(uTex, vUv + uTexel * vec2(-1.0,  1.0)).r
          + texture(uTex, vUv + uTexel * vec2( 1.0,  1.0)).r;
  o = vec4(min(v * 0.25, 60000.0), 0.0, 0.0, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
out vec4 o;
void main() {
  float v = texture(uTex, vUv).r * 0.227027;
  v += (texture(uTex, vUv + uStep).r       + texture(uTex, vUv - uStep).r)       * 0.1945946;
  v += (texture(uTex, vUv + uStep * 2.0).r + texture(uTex, vUv - uStep * 2.0).r) * 0.1216216;
  v += (texture(uTex, vUv + uStep * 3.0).r + texture(uTex, vUv - uStep * 3.0).r) * 0.054054;
  v += (texture(uTex, vUv + uStep * 4.0).r + texture(uTex, vUv - uStep * 4.0).r) * 0.016216;
  o = vec4(v, 0.0, 0.0, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAcc;
uniform sampler2D uGlow;
uniform vec3 uColor;
uniform float uGlowAmt;
uniform float uExposure;
out vec4 o;
void main() {
  float e = (texture(uAcc, vUv).r + texture(uGlow, vUv).r * uGlowAmt) * uExposure;
  // Per-channel saturation: the dominant hue fills first, very bright spots go white.
  o = vec4(1.0 - exp(-e * uColor), 1.0);
}`;

const MAX_TEX = 2048;

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      desynchronized: true,
    });
    if (!gl) throw new Error('WebGL2 is not available on this device/browser.');
    this.gl = gl;
    this.segCapacity = 0;
    this.init();
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => {
      this.segCapacity = 0;
      this.init();
      if (this.lastResize) this.resize(...this.lastResize);
    });
  }

  init() {
    const gl = this.gl;
    const floatOK = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.fmt = floatOK
      ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    this.floatOK = floatOK;

    this.progLine = this.program(LINE_VS, LINE_FS);
    this.progFade = this.program(QUAD_VS, FADE_FS);
    this.progDown = this.program(QUAD_VS, DOWN_FS);
    this.progBlur = this.program(QUAD_VS, BLUR_FS);
    this.progComp = this.program(QUAD_VS, COMPOSITE_FS);

    this.quadVao = gl.createVertexArray();

    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.segBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  program(vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  target(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.fmt.internal, w, h, 0, gl.RGBA, this.fmt.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  freeTargets() {
    const gl = this.gl;
    for (const t of [this.accA, this.accB, this.glowA, this.glowB]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
  }

  /**
   * Lays out the scope area inside the viewport.
   * @param {'square'|'fill'} aspect
   * @returns geometry used by the signal pipeline and the graticule
   */
  resize(cssW, cssH, dpr, aspect) {
    this.lastResize = [cssW, cssH, dpr, aspect];
    const pr = Math.min(dpr || 1, 3);
    this.canvas.width = Math.round(cssW * pr);
    this.canvas.height = Math.round(cssH * pr);

    let rw = cssW, rh = cssH;
    if (aspect === 'square') rw = rh = Math.min(cssW, cssH);
    const rect = { x: (cssW - rw) / 2, y: (cssH - rh) / 2, w: rw, h: rh };
    this.rectPx = {
      x: Math.round(rect.x * pr),
      y: Math.round(rect.y * pr),
      w: Math.round(rw * pr),
      h: Math.round(rh * pr),
    };
    const q = Math.min(1, MAX_TEX / Math.max(this.rectPx.w, this.rectPx.h));
    const tw = Math.max(4, Math.round(this.rectPx.w * q));
    const th = Math.max(4, Math.round(this.rectPx.h * q));
    this.pxPerCss = pr * q; // texture px per CSS px

    this.freeTargets();
    this.accA = this.target(tw, th);
    this.accB = this.target(tw, th);
    const gw = Math.max(2, Math.round(tw / 4));
    const gh = Math.max(2, Math.round(th / 4));
    this.glowA = this.target(gw, gh);
    this.glowB = this.target(gw, gh);

    // One signal unit = half the short side, so a full-scale (+/-1) signal touches the edges.
    this.unitPx = Math.min(tw, th) / 2;
    const geo = {
      rect,
      xRange: tw / 2 / this.unitPx,
      yRange: th / 2 / this.unitPx,
      divUnits: aspect === 'square' ? 0.2 : 0.25, // 10 divisions across a square, 8 vertically when filling
    };
    this.geo = geo;
    return geo;
  }

  /**
   * @param {object} f
   * @param {Float32Array} f.segs  x0,y0,x1,y1 per segment, signal units
   * @param {number} f.count       number of segments
   * @param {number} f.energy      energy per segment (signal-unit normalised)
   * @param {number} f.focus       beam radius in CSS px
   * @param {number} f.fade        multiplier applied to last frame (0 = clear)
   * @param {boolean} f.frozen     keep the previous image untouched
   * @param {number[]} f.color     rgb absorption weights
   * @param {number} f.glow        glow amount
   */
  frame(f) {
    const gl = this.gl;
    if (!this.accA || gl.isContextLost()) return;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quadVao);

    if (!f.frozen) {
      const src = this.accA;
      const dst = this.accB;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      if (f.fade > 0.001) {
        gl.useProgram(this.progFade.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(this.progFade.u.uTex, 0);
        gl.uniform1f(this.progFade.u.uFade, f.fade);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }

      if (f.count > 0) {
        const sigma = Math.max(0.5, f.focus * this.pxPerCss);
        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
        const data = f.segs.subarray(0, f.count * 4);
        if (f.count > this.segCapacity) {
          this.segCapacity = Math.max(f.count, this.segCapacity * 2, 4096);
          gl.bufferData(gl.ARRAY_BUFFER, this.segCapacity * 16, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        const { p, u } = this.progLine;
        gl.useProgram(p);
        gl.uniform2f(u.uRes, dst.w, dst.h);
        gl.uniform1f(u.uUnit, this.unitPx);
        gl.uniform1f(u.uSigma, sigma);
        gl.uniform1f(u.uEnergy, f.energy * this.unitPx * (this.floatOK ? 1 : 0.05));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, f.count);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(this.quadVao);
      }
      this.accA = dst;
      this.accB = src;

      // Glow: quarter-res downsample, then separable gaussian blur.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowA.fbo);
      gl.viewport(0, 0, this.glowA.w, this.glowA.h);
      gl.useProgram(this.progDown.p);
      gl.bindTexture(gl.TEXTURE_2D, this.accA.tex);
      gl.uniform1i(this.progDown.u.uTex, 0);
      gl.uniform2f(this.progDown.u.uTexel, 1 / this.accA.w, 1 / this.accA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(this.progBlur.p);
      gl.uniform1i(this.progBlur.u.uTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowB.fbo);
      gl.bindTexture(gl.TEXTURE_2D, this.glowA.tex);
      gl.uniform2f(this.progBlur.u.uStep, 1.5 / this.glowA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowA.fbo);
      gl.bindTexture(gl.TEXTURE_2D, this.glowB.tex);
      gl.uniform2f(this.progBlur.u.uStep, 0, 1.5 / this.glowA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Composite into the scope rectangle on screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const r = this.rectPx;
    gl.viewport(r.x, this.canvas.height - r.y - r.h, r.w, r.h);
    const { p, u } = this.progComp;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accA.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.glowA.tex);
    gl.uniform1i(u.uAcc, 0);
    gl.uniform1i(u.uGlow, 1);
    gl.uniform3fv(u.uColor, f.color);
    gl.uniform1f(u.uGlowAmt, f.glow * 4);
    gl.uniform1f(u.uExposure, this.floatOK ? 1.5 : 30);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}
