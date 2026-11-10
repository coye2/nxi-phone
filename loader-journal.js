// Version 1 of BrowserLaunchJournalLayout. Decode only a stable private copy.
const stages = [null, 'native.partition.open', 'native.content.select', 'native.program-map.register',
  'native.sections.open', 'native.metadata.load', 'native.nso.header', 'native.nso.allocate',
  'native.nso.sections', 'native.process.initialize'];
const bytes = 2112, capacity = 64;
const safe = n => Number.isSafeInteger(n) && n >= 0;

export function readLoaderJournal(memory, address, lastOrdinal = 0) {
  try {
    if (!safe(address) || !address || address % 8 || !safe(lastOrdinal)) return null;
    const buffer = memory?.buffer;
    if (!buffer || address > buffer.byteLength - bytes) return null;
    const sequence = new Int32Array(buffer, address + 16, 1);
    const before = Atomics.load(sequence, 0);
    if (before <= 0 || (before & 1)) return null;
    const copy = new Uint8Array(buffer, address, bytes).slice();
    if (Atomics.load(sequence, 0) !== before) return null;
    const view = new DataView(copy.buffer);
    if (view.getInt32(0, true) !== 0x4e584a31 || view.getInt32(4, true) !== 1 ||
        view.getInt32(8, true) !== capacity || view.getInt32(12, true) !== 32) return null;
    const total = Number(view.getBigInt64(24, true));
    const overwritten = Number(view.getBigInt64(32, true));
    const generation = Number(view.getBigInt64(40, true));
    if (!safe(total) || total <= lastOrdinal || !safe(generation) || overwritten !== Math.max(0, total - capacity)) return null;
    const first = Math.max(lastOrdinal + 1, total - capacity + 1), events = [];
    for (let ordinal = first; ordinal <= total; ordinal++) {
      const offset = 64 + ((ordinal - 1) % capacity) * 32;
      if (view.getBigInt64(offset, true) !== BigInt(ordinal)) return null;
      const launchGeneration = Number(view.getBigInt64(offset + 8, true));
      const stage = stages[view.getInt32(offset + 16, true)];
      const completed = view.getInt32(offset + 20, true);
      const at = Number(view.getBigInt64(offset + 24, true));
      if (!safe(launchGeneration) || !stage || (completed !== 0 && completed !== 1) || !safe(at) || at > 8640000000000000) return null;
      events.push({ ordinal, launchGeneration, stage, completed: !!completed, at });
    }
    return { total, overwritten, generation, lost: Math.max(0, total - lastOrdinal - capacity), events };
  } catch { return null; }
}

// Select only fixed-schema data from persisted state; no arbitrary strings or payloads.
export function restoreLoaderJournal(value) {
  if (!value || !safe(value.total) || !safe(value.overwritten) || !safe(value.lost) ||
      !safe(value.generation) || !safe(value.sampledAt) || !Array.isArray(value.events)) return null;
  const events = value.events.slice(-64).filter(e => safe(e?.ordinal) && safe(e?.launchGeneration) &&
    stages.includes(e?.stage) && e.stage !== null && typeof e.completed === 'boolean' && safe(e.at))
    .map(({ordinal, launchGeneration, stage, completed, at}) => ({ordinal, launchGeneration, stage, completed, at}));
  return { total: value.total, overwritten: value.overwritten, lost: value.lost, generation: value.generation,
    sampledAt: value.sampledAt, events };
}

export function mergeLoaderJournal(previous, batch, sampledAt = Date.now()) {
  const same = previous?.generation === batch.generation;
  const events = [...(same ? previous.events : []), ...batch.events.filter(e => e.launchGeneration === batch.generation)].slice(-64);
  return { total: batch.total, overwritten: batch.overwritten, lost: (same ? previous.lost : 0) + batch.lost,
    generation: batch.generation, sampledAt, events };
}

export function summarizeLoaderJournal(value) {
  if (!value) return null;
  const pending = new Map();
  let lastCompleted = null;
  for (const event of value.events) {
    if (event.completed) { pending.delete(event.stage); lastCompleted = event; }
    else pending.set(event.stage, event);
  }
  return { ...value, pending: [...pending.values()], lastCompleted,
    sampleAgeMs: Math.max(0, Date.now() - value.sampledAt),
    historyMayBeIncomplete: value.lost > 0 || value.events.length === capacity };
}
