// Independent of native exports and the storage worker's event loop. Only
// counters are shared: no file names, contents, keys, or guest addresses.
const stages = ['idle', 'open', 'read', 'close', 'failed'];
export function createStorageDiagnostics() {
  const buffer = new SharedArrayBuffer(64);
  const words = new Int32Array(buffer);
  return { buffer, snapshot() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const sequence = Atomics.load(words, 0);
      if (sequence & 1) continue;
      const copy = words.slice();
      if (Atomics.load(words, 0) !== sequence) continue;
      return { scope: 'page-local', stage: stages[copy[1]] ?? 'unknown',
        operation: stages[copy[2]] ?? 'unknown', requests: copy[3] >>> 0,
        completed: copy[4] >>> 0, reads: copy[5] >>> 0,
        bytesRead: (copy[7] >>> 0) * 4294967296 + (copy[6] >>> 0),
        openHandles: copy[8] >>> 0, reopenRetries: copy[9] >>> 0,
        lastRequestFailed: copy[10] !== 0, eventYields: copy[11] >>> 0 };
    }
    return null;
  } };
}
