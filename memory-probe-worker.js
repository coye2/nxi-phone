import { MIB, WASM_PAGE_BYTES } from './memory-probe.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let retainedMemory;
let retainedInstance;

// Native stub instantiation measures instance/table cost only; it does not run managed startup.
export function stubProbeImports(module, memory) {
  const imports = {};
  for (const item of WebAssembly.Module.imports(module)) {
    const scope = imports[item.module] ??= {};
    if (item.kind === 'memory') scope[item.name] = memory;
    else if (item.kind === 'function') scope[item.name] = () => 0;
    else if (item.kind === 'table') scope[item.name] = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
    else if (item.kind === 'global') scope[item.name] = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
    else throw new Error(`Unsupported native import kind: ${item.kind}`);
  }
  return imports;
}

// Full writes use deterministic pseudorandom words: zero or repeated-byte fills would confound
// compression with page reuse. This is an access experiment, not a compression benchmark.
export async function touchProbeMemory(memory, mode, round, progress = () => {}) {
  const words = new Uint32Array(memory.buffer);
  const wordsPerChunk = 256 * 1024; // 1 MiB per task, no auxiliary large buffer.
  let checksum = 0;
  let bytesWritten = 0;
  let accesses = 0;
  let state = (0x9e3779b9 ^ (round + 1)) >>> 0;
  for (let start = 0; start < words.length; start += wordsPerChunk) {
    const end = Math.min(words.length, start + wordsPerChunk);
    const stride = mode === 'full' ? 1 : 1024;
    for (let index = start; index < end; index += stride) {
      if (mode === 'read') checksum = (checksum + words[index]) >>> 0;
      else {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        words[index] = state >>> 0;
        bytesWritten += 4;
        checksum = (checksum ^ words[index]) >>> 0;
      }
      accesses++;
    }
    if ((start / wordsPerChunk) % 64 === 0) progress({ progressedBytes: end * 4, round });
    await pause(0);
  }
  return { checksum, bytesWritten, accesses, logicalLinearBytes: words.byteLength };
}

// Also exported so tests execute the actual allocation/growth/access path in worker_threads.
export async function handleProbeCommand({ action, config, module, memory }, send) {
  const emit = (phase, details = {}) => send({ type: 'event', phase, details });
  try {
    if (action === 'instance') {
      retainedMemory = memory;
      if (module) retainedInstance = await WebAssembly.instantiate(module, stubProbeImports(module, memory));
      send({ type: 'ready' });
      return;
    }
    const initialMiB = config.mode === 'grow' ? config.startMiB : config.targetMiB;
    emit('allocate.begin', { initialMiB, maximumMiB: config.maximumMiB, shared: config.shared, appBytesWritten: 0 });
    retainedMemory = new WebAssembly.Memory({
      initial: initialMiB * MIB / WASM_PAGE_BYTES,
      maximum: config.maximumMiB * MIB / WASM_PAGE_BYTES,
      shared: config.shared,
    });
    emit('allocate.end', { logicalLinearBytes: retainedMemory.buffer.byteLength, appBytesWritten: 0 });
    if (action === 'allocate') { send({ type: 'ready', memory: retainedMemory }); return; }
    if (action !== 'experiment') throw new Error(`Unknown memory probe action: ${action}`);
    await pause(config.settleMs);
    if (config.mode === 'grow') {
      while (retainedMemory.buffer.byteLength < config.targetMiB * MIB) {
        const growBytes = Math.min(config.growStepMiB * MIB, config.targetMiB * MIB - retainedMemory.buffer.byteLength);
        emit('grow.begin', { logicalLinearBytes: retainedMemory.buffer.byteLength, growBytes, appBytesWritten: 0 });
        const started = performance.now();
        retainedMemory.grow(growBytes / WASM_PAGE_BYTES);
        emit('grow.end', { logicalLinearBytes: retainedMemory.buffer.byteLength, growMs: performance.now() - started, appBytesWritten: 0 });
        await pause(config.settleMs);
      }
    }
    if (config.touch !== 'none') {
      const rounds = config.mode === 'reuse' ? config.rounds : 1;
      for (let round = 0; round < rounds; round++) {
        emit('touch.begin', { round, touch: config.touch, logicalLinearBytes: retainedMemory.buffer.byteLength });
        const started = performance.now();
        const stats = await touchProbeMemory(retainedMemory, config.touch, round, details => emit('touch.progress', details));
        emit('touch.end', { round, touch: config.touch, touchMs: performance.now() - started, ...stats });
        await pause(config.settleMs);
      }
    }
    emit('memory.hold', { logicalLinearBytes: retainedMemory.buffer.byteLength, holdMs: config.holdMs });
    await pause(config.holdMs);
    send({ type: 'complete' });
  } catch (error) {
    send({ type: 'error', message: String(error.message ?? error) });
  }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = ({ data }) => { void handleProbeCommand(data, message => self.postMessage(message)); };
}
