// Read only mailboxes registered by nxiSpawnCpuWorker. Never scan the heap.
// WasmAbi: State=0, Kind=4, HelperId=8, Generation=40, mailbox size=256.
export const MAX_CPU_MAILBOX_SAMPLES = 64;

export function readCpuMailboxDiagnostics(memory, records, { totalWorkersCreated } = {}) {
  const registered = Array.isArray(records) ? records : [];
  const total = Number.isSafeInteger(totalWorkersCreated) && totalWorkersCreated >= registered.length
    ? totalWorkersCreated : registered.length;
  let buffer = null;
  try {
    const candidate = memory?.buffer;
    if (typeof SharedArrayBuffer !== 'undefined' && candidate instanceof SharedArrayBuffer) buffer = candidate;
  } catch { /* A missing/inaccessible memory is an unavailable observation. */ }

  const workers = [];
  for (let i = 0; i < Math.min(registered.length, MAX_CPU_MAILBOX_SAMPLES); i++) {
    const record = registered[i];
    const workerId = Number.isSafeInteger(record?.workerId) && record.workerId >= 0 ? record.workerId : null;
    const birthPlayAttempt = Number.isSafeInteger(record?.birthPlayAttempt) && record.birthPlayAttempt >= 0
      ? record.birthPlayAttempt : null;
    const row = { workerId, birthPlayAttempt, available: false, reason: null,
      state: null, kind: null, helperId: null, mailboxGeneration: null };
    workers.push(row);
    if (workerId === null || (record.birthPlayAttempt != null && birthPlayAttempt === null)) {
      row.reason = 'invalid-record'; continue;
    }
    // JSExport/JSImport int parameters carry wasm32 pointers as signed int32.
    // Accept their unsigned representation too, but never truncate other inputs.
    const raw = record.address;
    if (!Number.isInteger(raw) || raw < -0x80000000 || raw > 0xffffffff || raw === 0) {
      row.reason = 'invalid-address'; continue;
    }
    const address = raw >>> 0;
    if (address % 4 !== 0) { row.reason = 'unaligned'; continue; }
    if (!buffer) { row.reason = 'memory-unavailable'; continue; }
    if (address + 256 > buffer.byteLength) { row.reason = 'out-of-bounds'; continue; }
    try {
      // No retained view: a later capture sees the latest shared memory buffer.
      const words = new Int32Array(buffer, address, 11);
      row.reason = 'changed-during-read';
      for (let attempt = 0; attempt < 2; attempt++) {
        const state = Atomics.load(words, 0);
        const kind = Atomics.load(words, 1);
        const helperId = Atomics.load(words, 2);
        const mailboxGeneration = Atomics.load(words, 10);
        if (state !== Atomics.load(words, 0)) continue;
        Object.assign(row, { available: true, reason: null, state, kind, helperId, mailboxGeneration });
        break;
      }
    } catch { row.reason = 'read-unavailable'; }
  }
  return {
    scope: 'page-local', lifecycle: 'unknown',
    consistency: 'independent-atomic-fields',
    generationMeaning: 'translation-cache-invalidation-not-launch-generation',
    birthPlayAttemptMeaning: 'ui-play-attempt-not-native-launch-generation',
    // State recheck rejects some transitions, not ABA or all mixed observations.
    fieldMeaning: 'kind-is-request-kind-only-in-REQUEST; helperId-is-current-only-for-REQUEST-CALL',
    registryAvailable: Array.isArray(records), memoryAvailable: buffer !== null,
    totalWorkersCreated: total, omittedWorkers: Math.max(0, total - workers.length), workers,
  };
}
