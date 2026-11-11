// How far each game got the last time it was played on this device. Kept per
// device in localStorage; losing it only loses the label.
const KEY = 'mochi-compat-v1';

export const COMPAT_LABELS = {
  'start-failed': "Doesn't start",
  crashed: 'Crashes',
  'no-picture': 'Runs, no picture yet',
  picture: 'Shows a picture',
};

export function readCompatibility(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
}

export function compatibilityLabel(id, storage = globalThis.localStorage) {
  return COMPAT_LABELS[readCompatibility(storage)[id]?.status] ?? null;
}

export function recordCompatibility(id, status, storage = globalThis.localStorage, now = () => new Date()) {
  if (!id || !COMPAT_LABELS[status]) return;
  try {
    const all = readCompatibility(storage);
    all[id] = { status, at: now().toISOString() };
    storage?.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the label is a convenience */ }
}

// Classifies a Play call that threw. A CPU fault means the game's code ran.
export function failedPlayStatus(error) {
  return /cpu_execution_failed|crashed while running|couldn't keep running/i.test(String(error?.message ?? error)) ? 'crashed' : 'start-failed';
}

// Watches a running game until it stops. Only real draw commands count as a
// picture; Present/Clear counts do not. A crash after a picture keeps
// "Shows a picture", since that is how far the game got.
export function watchCompatibility(id, { readStatus, readDraws, onChange = () => {}, record = recordCompatibility,
  setInterval: every = globalThis.setInterval, clearInterval: stop = globalThis.clearInterval, periodMs = 2000 }) {
  let picture = false, done = false;
  record(id, 'no-picture'); onChange();
  const timer = every(async () => {
    if (done) return;
    try {
      if (!picture && (await readDraws()) > 0) { picture = true; record(id, 'picture'); onChange(); }
      const status = await readStatus();
      if (status?.ErrorCode) { finish(picture ? 'picture' : 'crashed'); return; }
      if (status && !status.hasGame && !status.isLaunching && !status.busy) finish(picture ? 'picture' : 'no-picture');
    } catch { /* a missed sample is retried on the next tick */ }
  }, periodMs);
  function finish(status) { if (done) return; done = true; stop(timer); record(id, status); onChange(); }
  return () => { if (!done) { done = true; stop(timer); } };
}
