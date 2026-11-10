// One serialized controller for page visibility and the phone's pause controls.
// Native generation guards are required: a control request can otherwise queue
// behind a replacement launch and affect a different game.
export function createSessionController(api, {
  isHidden = () => false, onStatus = () => {}, onError = () => {}
} = {}) {
  let tail = Promise.resolve(), refreshTask = null, refreshAgain = false;
  let latest = null, automaticGeneration = null, manualRevision = 0, disposed = false;
  const stateOf = status => String(status?.state ?? '').toLowerCase();
  const generationOf = status => Number.isSafeInteger(status?.launchGeneration) && status.launchGeneration >= 0
    ? status.launchGeneration : null;
  const active = status => status?.hasGame && !status.busy && !status.isLaunching && !status.ErrorCode;

  function publish(status) {
    latest = { ...status, automaticallyPaused: automaticGeneration !== null &&
      automaticGeneration === generationOf(status) && stateOf(status) === 'paused' };
    if (!disposed) onStatus(latest);
    return latest;
  }

  async function read() {
    const raw = await api.Status();
    const status = raw === 'loading' ? { Status: 'Loading', state: null, hasGame: false, busy: false,
      isLaunching: false, launchGeneration: 0, title: null, frames: 0 } : typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('The game session returned an invalid status.');
    if (!status.hasGame || generationOf(status) !== automaticGeneration ||
        !['running', 'paused'].includes(stateOf(status)) || status.ErrorCode)
      automaticGeneration = null;
    // An outside action resumed this game. Its later manual pause belongs to the
    // user, even if it is still the same launch generation.
    if (stateOf(status) === 'running') automaticGeneration = null;
    return publish(status);
  }

  function enqueue(action) {
    const task = tail.then(async () => {
      if (disposed) return latest;
      try { return await action(); }
      catch (error) {
        automaticGeneration = null;
        if (!disposed) {
          onError(error);
          // A failed pause/resume may still have changed native state. Report
          // the observation without attempting another automatic transition.
          try { await read(); } catch {}
        }
        throw error;
      }
    });
    tail = task.catch(() => {});
    return task;
  }

  async function change(paused, generation) {
    const operation = paused ? api.PauseSession : api.ResumeSession;
    if (typeof operation !== 'function') throw new Error('Reload Mochi to update its game session controls.');
    await operation.call(api, generation);
    const status = await read();
    if (status.ErrorCode) throw new Error(status.ErrorMessage || 'The game session could not change state.');
    if (generationOf(status) !== generation || !status.hasGame)
      throw new Error('The game session changed before the control request completed.');
    if (stateOf(status) !== (paused ? 'paused' : 'running'))
      throw new Error(paused ? 'The game did not pause.' : 'The game did not resume.');
    return status;
  }

  async function reconcile() {
    let status = await read();
    // Recheck visibility after each awaited native action. Bound the work if the
    // page keeps changing visibility; the next explicit refresh reconciles again.
    for (let attempts = 0; attempts < 3 && !disposed; attempts++) {
      const generation = generationOf(status);
      if (!active(status) || generation === null) return status;
      if (isHidden() && stateOf(status) === 'running') {
        const revision = manualRevision;
        status = await change(true, generation);
        if (!disposed && manualRevision === revision) automaticGeneration = generation;
        status = publish(status);
      } else if (!isHidden() && stateOf(status) === 'paused' && automaticGeneration === generation) {
        automaticGeneration = null;
        status = await change(false, generation);
      } else return status;
    }
    return status;
  }

  function refresh() {
    if (disposed) return Promise.resolve(latest);
    if (refreshTask) { refreshAgain = true; return refreshTask; }
    refreshTask = enqueue(async () => {
      let status;
      do { refreshAgain = false; status = await reconcile(); } while (refreshAgain && !disposed);
      return status;
    }).finally(() => { refreshTask = null; });
    return refreshTask;
  }

  function manual(paused) {
    // Relinquish ownership immediately, including while an automatic pause is
    // in flight. Returning to the app must not undo an explicit user pause.
    automaticGeneration = null; manualRevision++;
    return enqueue(async () => {
      const status = await read(), generation = generationOf(status);
      if (!status.hasGame || status.busy || status.isLaunching || generation === null)
        throw new Error(status.busy || status.isLaunching ? 'Wait for the current game action to finish.' : 'There is no active game to control.');
      if (stateOf(status) === (paused ? 'paused' : 'running') && !status.ErrorCode) return status;
      if (!['paused', 'running'].includes(stateOf(status))) throw new Error('There is no active game to control.');
      return change(paused, generation);
    });
  }

  return {
    refresh,
    pause: () => manual(true),
    resume: () => manual(false),
    dispose() { disposed = true; automaticGeneration = null; refreshAgain = false; }
  };
}
