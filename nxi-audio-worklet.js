// Plays the core's audio ring (AudioRing in the shared heap): int16 stereo at 48 kHz.
class NxiAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      this.memory = data.memory; this.base = data.address; this.views();
      // audio.js owns the running flag. This message can arrive after the page
      // has hidden or suspended the context; attaching must not re-enable it.
    };
  }
  views() {
    this.buffer = this.memory.buffer;
    this.head = new Int32Array(this.buffer, this.base, 16);
    this.samples = new Int16Array(this.buffer, this.base + 64, Atomics.load(this.head, 2) * 2);
  }
  process(_, outputs) {
    if (!this.memory) return true;
    if (this.buffer !== this.memory.buffer) this.views();
    const [left, right] = outputs[0], cap = Atomics.load(this.head, 2);
    let read = Atomics.load(this.head, 1);
    // Native counters are wrapping int32 values. JavaScript subtraction must
    // wrap too when written crosses the signed boundary before played does.
    const available = Math.min(cap, (Atomics.load(this.head, 0) - read) >>> 0);
    const n = Math.min(left.length, available);
    for (let i = 0; i < n; i++, read++) {
      const slot = (read >>> 0) % cap;
      left[i] = this.samples[slot * 2] / 32768;
      if (right) right[i] = this.samples[slot * 2 + 1] / 32768;
    }
    for (let i = n; i < left.length; i++) { left[i] = 0; if (right) right[i] = 0; }
    Atomics.store(this.head, 1, read);
    return true;
  }
}
registerProcessor('nxi-audio', NxiAudio);
