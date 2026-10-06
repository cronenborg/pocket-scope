// Audio graph:  microphone -> capture (worklet, taps samples) -> silent gain -> destination
// The capture node is pulled through a zero-gain node so it keeps processing
// without ever playing the microphone back (no feedback).

const STEREO = { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' };

export class AudioEngine {
  constructor({ onSamples }) {
    this.onSamples = onSamples;
    this.ctx = null;
    this.stream = null;
    this.source = null;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  get running() {
    return !!this.stream;
  }

  async ensure() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(new URL('worklets/capture.js', document.baseURI));
    this.capture = new AudioWorkletNode(ctx, 'scope-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      ...STEREO,
    });
    this.capture.port.onmessage = (e) => this.onSamples(e.data[0], e.data[1]);
    this.capture.connect(new GainNode(ctx, { gain: 0 })).connect(ctx.destination);
    if (ctx.state !== 'running') await ctx.resume();
  }

  /**
   * Opens a microphone. deviceId '' = system default (on Android a plugged-in
   * USB-C mic usually becomes the default; it can also be picked explicitly).
   * @returns {{label: string, channels: number, sampleRate: number}}
   */
  async start(deviceId = '') {
    await this.ensure();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    });
    this.stop();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.capture);
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    track.addEventListener('ended', () => this.onEnded && this.onEnded());
    return {
      label: track.label || 'Microphone',
      deviceId: settings.deviceId || '',
      channels: settings.channelCount || 1,
      sampleRate: this.ctx.sampleRate,
    };
  }

  stop() {
    if (this.source) this.source.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.source = this.stream = null;
  }

  /** Audio inputs; labels are only filled in after permission has been granted once. */
  static async listInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }
}
