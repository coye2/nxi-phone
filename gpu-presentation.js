// Owns the transferable game canvas and the WebGPU worker's lifetime. A failed
// device is not restarted: texture ids and queued commands belong to that device.
export class GpuPresentation {
  constructor({ canvas, memory, address, workerUrl, readback = false, makeWorker = url => new Worker(url), timeoutMs = 10000, report = text => console.log('NXI-GPU ' + text) }) {
    Object.assign(this, { canvas, memory, address, workerUrl, readback, makeWorker, timeoutMs, report });
    this.ready = false;
    this.failed = false;
  }

  get header() { return new Int32Array(this.memory.buffer, this.address, 16); }
  get context2d() { return this.ready ? null : (this.ctx ??= this.canvas.getContext('2d')); }

  async start() {
    if (this.started) return this.ready;
    this.started = true;
    try {
      const offscreen = this.canvas.transferControlToOffscreen();
      this.transferred = true;
      this.worker = this.makeWorker(this.workerUrl);
      return await new Promise(resolve => {
        this.finishStart = resolve;
        this.timer = setTimeout(() => this.disable('WebGPU startup timed out'), this.timeoutMs);
        this.worker.onmessage = ({ data }) => {
          if (this.failed) return;
          if (data.frame) { this.showReadback(data); return; }
          if (data.ready && Atomics.load(this.header, 3) === 1) {
            this.ready = true;
            clearTimeout(this.timer);
            this.finishStart?.(true); this.finishStart = null;
            this.report('WebGPU ready: ' + data.adapter);
          } else this.disable(data.error || 'WebGPU worker unavailable');
        };
        this.worker.onerror = event => this.disable(event.message || 'WebGPU worker failed');
        this.worker.onmessageerror = () => this.disable('Invalid WebGPU worker message');
        this.worker.postMessage({ memory: this.memory, address: this.address, canvas: offscreen, readback: this.readback }, [offscreen]);
      });
    } catch (error) {
      this.disable(error.message || String(error));
      return false;
    }
  }

  // Test mode (?gpu=readback): frames come back from the worker and go into a fresh 2D canvas,
  // because headless Chromium loses the device when it presents to a canvas.
  showReadback({ frame, width, height }) {
    if (!this.readbackCanvas) {
      this.readbackCanvas = this.canvas.cloneNode();
      this.canvas.replaceWith(this.readbackCanvas);
      this.canvas = this.readbackCanvas;
    }
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.canvas.getContext('2d').putImageData(new ImageData(frame, width, height), 0, 0);
  }

  // The managed producer can disable the ring on timeout without a JS message.
  poll() {
    if (this.ready && Atomics.load(this.header, 3) !== 1) this.disable('WebGPU command queue stopped');
    return this.ready;
  }

  disable(reason) {
    if (this.failed) return;
    this.failed = true;
    this.ready = false;
    clearTimeout(this.timer);
    Atomics.store(this.header, 3, 0);
    Atomics.notify(this.header, 0);
    this.worker?.terminate();
    // A transferred canvas cannot acquire a 2D context, even after its worker dies.
    if (this.transferred) {
      const fresh = this.canvas.cloneNode();
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
    }
    this.finishStart?.(false); this.finishStart = null;
    this.report('Using framebuffer display: ' + reason);
  }
}
