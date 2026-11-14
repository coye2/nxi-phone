const MiB = 1024 * 1024;
const wasmPage = 65536;

// Experiment only: an initial allocation and a later shared-memory grow can take
// different WebKit paths. Never infer resident memory from either byte length.
export function initialMemoryExperiment(search = '') {
  const raw = new URLSearchParams(search).get('wasmInitialMiB');
  if (raw === null) return null;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 128 || value > 3072)
    throw new RangeError('wasmInitialMiB must be an integer from 128 to 3072.');
  return value * MiB / wasmPage;
}

// Preserve the existing first-shared-memory capture, with an opt-in descriptor
// override. Do not change maximum, touch pages, or change a later memory. The
// runtime is still responsible for malloc/sbrk bookkeeping inside this memory.
export function installRuntimeMemoryCapture(wasm, { initialPages = null, expectedMaximumPages = 65536, onCapture = () => {} } = {}) {
  const NativeMemory = wasm.Memory;
  if (initialPages !== null && (!Number.isSafeInteger(initialPages) || initialPages < 1 || initialPages > 65536))
    throw new RangeError('Invalid initial page count.');
  let captured = null;
  const observation = { requestedInitialPages: initialPages, originalInitialPages: null,
    actualInitialPages: null, maximumPages: null, experimentApplied: false,
    unit: 'logical-wasm-pages', residentBytes: null };
  function CapturedMemory(descriptor) {
    if (!new.target) throw new TypeError('WebAssembly.Memory requires new.');
    let selected = descriptor;
    // NxInfinity.Mobile.csproj sets EmccMaximumHeapSize=4294967296. Ignore tiny
    // shared memories used by feature detection before the actual runtime starts.
    const candidate = !captured && descriptor?.shared === true && descriptor.maximum === expectedMaximumPages;
    if (candidate && initialPages !== null) {
      if (descriptor.address === 'i64' || descriptor.index === 'i64')
        throw new TypeError('The initial-memory experiment requires wasm32.');
      if (!Number.isSafeInteger(descriptor.initial) || !Number.isSafeInteger(descriptor.maximum))
        throw new TypeError('The initial-memory experiment requires numeric initial and maximum pages.');
      if (initialPages > descriptor.maximum)
        throw new RangeError('The initial-memory experiment exceeds the runtime maximum.');
      selected = { ...descriptor, initial: Math.max(descriptor.initial, initialPages) };
    }
    const memory = Reflect.construct(NativeMemory, [selected], new.target === CapturedMemory ? NativeMemory : new.target);
    if (candidate) {
      captured = memory;
      observation.originalInitialPages = Number(descriptor.initial);
      observation.actualInitialPages = memory.buffer.byteLength / wasmPage;
      observation.maximumPages = Number(descriptor.maximum);
      observation.experimentApplied = selected !== descriptor && selected.initial !== descriptor.initial;
      onCapture(memory);
    }
    return memory;
  }
  Object.setPrototypeOf(CapturedMemory, NativeMemory);
  CapturedMemory.prototype = NativeMemory.prototype;
  wasm.Memory = CapturedMemory;
  return {
    snapshot: () => ({ ...observation, linearBufferBytes: captured?.buffer.byteLength ?? null }),
    restore: () => { if (wasm.Memory === CapturedMemory) wasm.Memory = NativeMemory; },
  };
}

export function cpuCachePolicy(search = '', iOS = false) {
  const params = new URLSearchParams(search);
  const integer = (key, fallback, min, max) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
      throw new RangeError(`${key} must be an integer from ${min} to ${max}.`);
    return value;
  };
  return { maxEntries: integer('cpuCacheEntries', iOS ? 4096 : 12000, 0, 12000),
    maxWasmBytes: integer('cpuCacheMiB', iOS ? 32 : 48, 1, 128) * MiB,
    estimatedModuleOverheadBytes: 0 };
}
