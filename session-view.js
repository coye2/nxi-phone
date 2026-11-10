import { createSessionController } from './session.js';

export function sessionPresentation(status, stopping = false) {
  const state = String(status.state ?? '').toLowerCase();
  const active = !!(status.hasGame || status.isLaunching);
  const failed = !!status.ErrorCode;
  const paused = state === 'paused';
  return {
    active,
    title: status.title || 'Mochi',
    message: stopping ? 'Stopping and saving progress…' : failed ? (status.ErrorMessage || 'The game stopped with an error.')
      : paused ? 'Paused' : status.isLaunching ? (status.Status || 'Starting game…')
      : Number(status.frames) > 0 ? '' : 'Waiting for the first game frame…',
    showMessage: stopping || failed || paused || !!status.isLaunching || !Number(status.frames),
    canPause: active && !stopping && !status.busy && !failed && ['running', 'paused'].includes(state),
    paused,
  };
}

export function startSessionView(api, game, report = () => {}) {
  const panel = document.getElementById('game-status');
  const title = document.getElementById('game-title');
  const message = document.getElementById('game-message');
  const pause = document.getElementById('pause');
  const stop = document.getElementById('stop');
  let stopped = false, stopping = false, current = {}, manualAction = false;
  function render(status = current) {
    current = status;
    const view = sessionPresentation(status, stopping);
    const visible = view.active || stopping;
    if (game.hidden === visible) game.hidden = !visible;
    title.textContent = view.title; message.textContent = view.message;
    panel.hidden = !view.showMessage;
    pause.textContent = view.paused ? 'Resume' : 'Pause';
    pause.disabled = manualAction || !view.canPause;
    stop.disabled = stopping;
  }
  const controller = createSessionController(api, {
    isHidden: () => document.visibilityState === 'hidden',
    onStatus: render,
    onError: error => { report(error.message || String(error)); message.textContent = error.message || String(error); panel.hidden = false; },
  });
  // The controller already reports errors; event/timer callbacks must not leave
  // rejected Promises behind when a device or a game is shutting down.
  const refresh = () => stopped ? Promise.resolve() : controller.refresh().catch(() => {});
  pause.onclick = async () => {
    if (manualAction) return;
    manualAction = true; render();
    try {
      if (String(current.state).toLowerCase() === 'paused') await controller.resume();
      else await controller.pause();
    } catch (error) {
      report(error.message || String(error));
    } finally { manualAction = false; await refresh(); render(); }
  };
  const timer = setInterval(refresh, 500);
  document.addEventListener('visibilitychange', refresh);
  addEventListener('pageshow', refresh);
  addEventListener('pagehide', event => {
    if (event.persisted) { void refresh(); return; }
    stopped = true; clearInterval(timer);
    document.removeEventListener('visibilitychange', refresh);
    removeEventListener('pageshow', refresh);
    controller.dispose?.();
  }, { once: false });
  void refresh();
  return { refresh, stopping(value) { stopping = value; render(); } };
}
