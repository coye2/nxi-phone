// Probe configuration and lifecycle. This module never loads the .NET runtime.
export const MIB = 1024 * 1024;
export const WASM_PAGE_BYTES = 65536;

export function parseMemoryProbeConfig(search = '') {
  const query = new URLSearchParams(search);
  const choice = (name, fallback, allowed) => {
    const value = query.get(name) ?? fallback;
    if (!allowed.includes(value)) throw new Error(`${name} must be ${allowed.join(', ')}`);
    return value;
  };
  const integer = (name, fallback, min, max) => {
    const raw = query.get(name);
    const value = raw === null ? fallback : Number(raw);
    if (raw === '' || !Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${name} must be an integer from ${min} to ${max}`);
    return value;
  };
  const mode = choice('memcase', 'initial', ['initial', 'grow', 'reuse', 'workers', 'compile']);
  const config = {
    mode,
    shared: choice('memshared', '1', ['0', '1']) === '1',
    targetMiB: integer('memmib', 64, 1, 3072),
    maximumMiB: integer('memmax', 4096, 1, 4096),
    startMiB: integer('memstart', 16, 0, 3072),
    growStepMiB: integer('memstep', 64, 1, 1024),
    touch: choice('memtouch', 'none', ['none', 'read', 'sparse', 'full']),
    rounds: integer('memrounds', 3, 1, 16),
    workers: integer('memworkers', 4, 0, 32),
    module: choice('memmodule', mode === 'compile' ? 'native' : 'empty', ['empty', 'native']),
    baselineMs: integer('membaseline', 1000, 0, 30000),
    settleMs: integer('memsettle', 1000, 0, 10000),
    holdMs: integer('memhold', 5000, 0, 30000),
    timeoutMs: integer('memtimeout', 120000, 1000, 180000),
  };
  if (config.targetMiB > config.maximumMiB) throw new Error('memmib must not exceed memmax');
  if (mode === 'grow' && config.startMiB > config.targetMiB) throw new Error('memstart must not exceed memmib');
  if (mode === 'workers' && !config.shared) throw new Error('The worker comparison uses one shared memory; use memshared=1');
  if ((mode === 'workers' || mode === 'compile') && config.touch !== 'none') throw new Error('Worker and compile controls require memtouch=none');
  if (mode === 'compile' && config.module !== 'native') throw new Error('The compile case requires memmodule=native');
  if (mode === 'reuse' && query.has('memtouch') && config.touch !== 'full') throw new Error('The reuse case rewrites the whole pool; use memtouch=full');
  if (mode === 'reuse') config.touch = 'full';
  return Object.freeze(config);
}

function abortError(signal) { return signal.reason instanceof Error ? signal.reason : new Error('Memory probe aborted'); }

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(abortError(signal));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal)); return; }
    const finish = () => { signal.removeEventListener('abort', aborted); resolve(); };
    const timer = setTimeout(finish, ms);
    const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(abortError(signal)); };
    signal.addEventListener('abort', aborted, { once: true });
  });
}

// All Worker objects belong to this controller, so timeout/error/abort tears down every one.
export async function runMemoryProbe(config, { workerFactory, compileNativeModule, onEvent = () => {}, signal: outerSignal } = {}) {
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort(outerSignal.reason);
  outerSignal?.addEventListener('abort', abort, { once: true });
  if (outerSignal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new Error(`Memory probe timed out after ${config.timeoutMs} ms`)), config.timeoutMs);
  const workers = [];
  let nativeModule = null;
  let sharedMemory = null;
  let nativeLoadOrCompilationPending = false;
  let finished = false;
  const started = performance.now();
  const emit = (phase, data = {}) => !finished && onEvent({
    phase, epochMs: Date.now(), elapsedMs: Math.round(performance.now() - started),
    logicalLinearBytes: null, measuredPhysFootprintBytes: null, ...data,
  });
  const request = (action, payload = {}) => {
    if (signal.aborted) return Promise.reject(abortError(signal));
    const worker = workerFactory();
    workers.push(worker);
    return new Promise((resolve, reject) => {
      const cleanup = () => { worker.onmessage = worker.onerror = worker.onmessageerror = null; signal.removeEventListener('abort', aborted); };
      const fail = error => { cleanup(); reject(error); };
      const aborted = () => fail(abortError(signal));
      signal.addEventListener('abort', aborted, { once: true });
      worker.onerror = event => fail(new Error(event.message || 'Memory probe worker error'));
      worker.onmessageerror = () => fail(new Error('Memory probe worker could not deserialize a message'));
      worker.onmessage = ({ data }) => {
        if (data.type === 'event') emit(data.phase, data.details);
        else if (data.type === 'error') fail(new Error(data.message));
        else if (data.type === 'ready' || data.type === 'complete') { cleanup(); resolve(data); }
      };
      try { worker.postMessage({ action, config, ...payload }); } catch (error) { fail(error); }
    });
  };
  try {
    emit('baseline.begin', { controllerWorkers: 0, additionalWorkers: 0 });
    await wait(config.baselineMs, signal);
    if (config.mode === 'compile' || (config.mode === 'workers' && config.module === 'native')) {
      nativeLoadOrCompilationPending = true;
      const compilation = Promise.resolve().then(() => compileNativeModule(emit, signal)).then(
        module => { nativeLoadOrCompilationPending = false; return module; },
        error => { nativeLoadOrCompilationPending = false; throw error; },
      );
      nativeModule = await abortable(compilation, signal);
    }
    if (config.mode === 'compile') {
      emit('compile.hold', { compiledModules: 1, instantiatedModules: 0 });
      await wait(config.holdMs, signal);
    } else if (config.mode === 'workers') {
      emit('allocation-worker.begin');
      const ready = await request('allocate');
      sharedMemory = ready.memory;
      emit('workers.baseline', { logicalLinearBytes: sharedMemory.buffer.byteLength, controllerWorkers: 1, additionalWorkers: 0, instantiatedModules: 0 });
      await wait(config.settleMs, signal);
      for (let index = 0; index < config.workers; index++) {
        emit('worker.begin', { additionalWorkers: index + 1 });
        await request('instance', { module: nativeModule, memory: sharedMemory });
        emit('worker.ready', {
          logicalLinearBytes: sharedMemory.buffer.byteLength, controllerWorkers: 1,
          additionalWorkers: index + 1, compiledModules: nativeModule ? 1 : 0,
          instantiatedModules: nativeModule ? index + 1 : 0,
        });
        await wait(config.settleMs, signal);
      }
      emit('workers.hold', { logicalLinearBytes: sharedMemory.buffer.byteLength });
      await wait(config.holdMs, signal);
    } else {
      emit('allocation-worker.begin');
      await request('experiment');
    }
    emit('experiment.complete');
  } finally {
    clearTimeout(timeout);
    outerSignal?.removeEventListener('abort', abort);
    for (const worker of workers) worker.terminate();
    const terminatedWorkers = workers.length;
    workers.length = 0;
    nativeModule = sharedMemory = null;
    emit('teardown', { terminatedWorkers, nativeLoadOrCompilationPending, physicalReleaseVerified: false });
    finished = true;
  }
}
