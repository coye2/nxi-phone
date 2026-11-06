// Resume inside the gesture before awaiting the worklet or the core. Keep the
// gesture listeners: phones can suspend or interrupt audio again after startup.
export function startAudio(api, memory) {
  const gestures = ['pointerdown', 'keydown', 'touchend'];
  let current = null, disposed = false, pageHidden = false, disposing;
  const foreground = () => !document.hidden && !pageHidden;
  const live = session => !disposed && current === session && !session.closed;
  const warn = error => console.warn('NXI-AUDIO unavailable: ' + (error?.message || String(error)));

  function ringRunning(session, running) {
    if (session.address !== undefined)
      Atomics.store(new Int32Array(memory.buffer, session.address, 16), 3, running ? 1 : 0);
  }

  function release(session) {
    if (!session || session.closed) return session?.closing || Promise.resolve();
    session.closed = true;
    if (current === session) current = null;
    ringRunning(session, false);
    session.ctx.removeEventListener('statechange', session.stateChanged);
    if (session.node) {
      session.node.removeEventListener('processorerror', session.processorFailed);
      try { session.node.disconnect(); } catch {}
      try { session.node.port.close(); } catch {}
    }
    try { session.closing = session.ctx.state === 'closed' ? Promise.resolve() : Promise.resolve(session.ctx.close()).catch(() => {}); }
    catch { session.closing = Promise.resolve(); }
    return session.closing;
  }

  function failed(session, error) {
    if (!live(session)) return;
    warn(error);
    void release(session);
  }

  function sync(session) {
    if (!live(session)) return;
    try {
      const running = session.ready && foreground() && session.ctx.state === 'running';
      // Do not let the worklet's initial message mark a suspended context as
      // running. The native driver must keep consuming buffers without audio.
      if (running && !session.posted) {
        session.node.port.postMessage({ memory, address: session.address });
        session.posted = true;
      }
      ringRunning(session, running);
    } catch (error) { failed(session, error); }
  }

  function suspend(session) {
    if (!live(session)) return;
    ringRunning(session, false);
    if (session.ctx.state === 'closed' || session.ctx.state === 'suspended') return;
    try { Promise.resolve(session.ctx.suspend()).then(() => sync(session)).catch(() => {}); }
    catch {}
  }

  function resume(session) {
    if (!live(session) || !foreground()) return;
    try {
      // This call must happen synchronously in the input listener. A previous
      // blocked resume does not prevent the next real gesture from trying again.
      const task = session.ctx.state === 'running' ? Promise.resolve() : session.ctx.resume();
      Promise.resolve(task).then(() => {
        if (!live(session)) return;
        if (foreground()) sync(session); else suspend(session);
      }).catch(() => { if (live(session)) sync(session); });
    } catch { sync(session); }
  }

  async function initialize(session) {
    try {
      await session.ctx.audioWorklet.addModule(new URL('./nxi-audio-worklet.js', import.meta.url));
      if (!live(session)) return;
      const rawAddress = await api.AudioRingAddress();
      if (!live(session)) return;
      if (!Number.isInteger(rawAddress)) throw Error('Invalid audio ring address.');
      const address = rawAddress >>> 0;
      if (address % 4 || address + 64 > memory.buffer.byteLength) throw Error('Invalid audio ring address.');
      session.address = address;
      session.node = new AudioWorkletNode(session.ctx, 'nxi-audio', { numberOfInputs: 0, outputChannelCount: [2] });
      session.processorFailed = () => failed(session, Error('The audio processor stopped. Tap to retry sound.'));
      session.node.addEventListener('processorerror', session.processorFailed);
      session.node.connect(session.ctx.destination);
      session.ready = true;
      sync(session);
      if (!foreground()) suspend(session);
      if (live(session)) console.log('NXI-AUDIO ready at ' + session.ctx.sampleRate + ' Hz');
    } catch (error) { failed(session, error); }
  }

  function gesture() {
    if (disposed || !foreground()) return;
    if (current?.ctx.state === 'closed') void release(current);
    if (current) { resume(current); return; }
    let session;
    try {
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      session = current = { ctx, ready: false, posted: false, closed: false };
      session.stateChanged = () => {
        if (ctx.state === 'closed') void release(session); else sync(session);
      };
      ctx.addEventListener('statechange', session.stateChanged);
      resume(session);
      void initialize(session);
    } catch (error) { if (session) void release(session); warn(error); }
  }

  const visibility = () => { if (current) foreground() ? resume(current) : suspend(current); };
  const pagehide = event => { pageHidden = true; if (event.persisted) visibility(); else void dispose(); };
  const pageshow = () => { pageHidden = false; visibility(); };
  function dispose() {
    if (disposed) return disposing;
    disposed = true;
    for (const type of gestures) removeEventListener(type, gesture, true);
    document.removeEventListener('visibilitychange', visibility);
    removeEventListener('pagehide', pagehide);
    removeEventListener('pageshow', pageshow);
    disposing = release(current);
    return disposing;
  }

  for (const type of gestures) addEventListener(type, gesture, { capture: true, passive: true });
  document.addEventListener('visibilitychange', visibility);
  addEventListener('pagehide', pagehide);
  addEventListener('pageshow', pageshow);
  return { dispose };
}
