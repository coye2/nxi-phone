// NXI Mobile CPU worker: executes WASM translated from guest ARM64 by Kenji's
// ARMeilleure front end. Imports the runtime's shared memory; talks to its guest
// host thread only through the mailbox (see ARMeilleure WasmAbi).
const STATE = 0, KIND = 4, HELPER = 8, MODLEN = 12, PC = 16, CTX = 24, MODPTR = 32, GEN = 40, MODHOT = 44, BLOCK_PC = 200;
const RUN = 1, BUSY = 2, REQUEST = 3, REPLY = 4;
const KIND_EXIT = 1, KIND_TRANSLATE = 2, KIND_CALL = 3, KIND_FAULT = 4, KIND_TRANSLATE_HOT = 5;
// Entries run this many times before their whole region is re-translated (tier 1).
const HOT_THRESHOLD = 256;

let memory, mbox, i32, view, mboxGlobal, generation = -1, blockPc = 0n, activeEntry = null;
const cache = new Map();
// Bounds apply to retained exports in THIS worker, not the managed translation cache
// or WebKit's process footprint. Source byte length cannot measure compiled-code memory.
// The host may supply an explicitly labelled per-module overhead estimate for comparison.
let cachePolicy = { maxEntries: 12000, maxWasmBytes: 48 * 1024 * 1024, estimatedModuleOverheadBytes: 0 };
let cacheWasmBytes = 0, clockHand = cache.keys();
const cacheTotals = { hits: 0, misses: 0, evictedEntries: 0, generationClears: 0,
  bypassedEntries: 0, compilations: 0, compiledWasmBytes: 0, peakEntries: 0, peakWasmBytes: 0 };
function configureCache(policy = {}) {
  const bounded = (value, fallback, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fallback;
  cachePolicy = {
    maxEntries: bounded(policy?.maxEntries, 12000, 65536),
    maxWasmBytes: bounded(policy?.maxWasmBytes, 48 * 1024 * 1024, 256 * 1024 * 1024),
    estimatedModuleOverheadBytes: bounded(policy?.estimatedModuleOverheadBytes, 0, 1024 * 1024),
  };
}
function releaseEntry(pc, entry) {
  cache.delete(pc);
  cacheWasmBytes -= entry.wasmBytes;
  entry.retained = false;
  // A helper can invalidate this generation while its caller is still on the wasm
  // stack. Keep that one export rooted until execute() unwinds, including on faults.
  if (entry !== activeEntry) entry.fn = null;
}
function clearCache(gen) {
  for (const [pc, entry] of cache) releaseEntry(pc, entry);
  clockHand = cache.keys();
  generation = gen;
  stats.clears++;
  cacheTotals.generationClears++;
}
function canRetain(wasmBytes) {
  return cachePolicy.maxEntries > 0 && wasmBytes <= cachePolicy.maxWasmBytes;
}
function makeRoom(wasmBytes) {
  // Oversize modules execute once without flushing useful cached blocks.
  if (!canRetain(wasmBytes)) return;
  while (cache.size && (cache.size >= cachePolicy.maxEntries || cacheWasmBytes + wasmBytes > cachePolicy.maxWasmBytes)) {
    let next = clockHand.next();
    if (next.done) { clockHand = cache.keys(); next = clockHand.next(); }
    const pc = next.value, entry = cache.get(pc);
    if (entry.referenced) { entry.referenced = false; continue; }
    releaseEntry(pc, entry);
    stats.evictions++;
    cacheTotals.evictedEntries++;
  }
}
function remember(pc, e) {
  if (!canRetain(e.wasmBytes)) { cacheTotals.bypassedEntries++; return; }
  e.retained = true;
  e.referenced = true;
  cache.set(pc, e);
  cacheWasmBytes += e.wasmBytes;
  cacheTotals.peakEntries = Math.max(cacheTotals.peakEntries, cache.size);
  cacheTotals.peakWasmBytes = Math.max(cacheTotals.peakWasmBytes, cacheWasmBytes);
}
function cacheSnapshot() {
  const inFlightUncached = activeEntry && !activeEntry.retained;
  const retainedModules = cache.size + (inFlightUncached ? 1 : 0);
  return {
    policy: { ...cachePolicy }, generation, cachedModules: cache.size, cachedWasmBytes: cacheWasmBytes,
    inFlightUncachedModules: inFlightUncached ? 1 : 0,
    retainedModules, retainedWasmBytes: cacheWasmBytes + (inFlightUncached ? activeEntry.wasmBytes : 0),
    estimatedRetainedModuleOverheadBytes: cachePolicy.estimatedModuleOverheadBytes ? retainedModules * cachePolicy.estimatedModuleOverheadBytes : null,
    physicalFootprintBytes: null, totals: { ...cacheTotals },
  };
}
// Perf counters, printed every 5 s while busy (NXI-CPU-STATS).
const stats = { evictions: 0, hot: 0, compiles: 0, compileMs: 0, translateWaitMs: 0, rpcs: 0, rpcMs: 0, blocks: 0, clears: 0, last: performance.now() };
let lastCompletionReport = -Infinity;
function report(force = false, reason = 'interval') {
  const now = performance.now();
  // A mailbox can serve many short Execute calls. Keep the first completion,
  // then sample at most once a second; fault and startup reports stay immediate.
  if (reason === 'exit') {
    if (now - lastCompletionReport < 1000) return;
    lastCompletionReport = now;
  }
  if (!force && now - stats.last < 5000) return;
  console.log(`NXI-CPU-STATS blocks=${stats.blocks} compiles=${stats.compiles} hot=${stats.hot} compileMs=${stats.compileMs | 0} translateWaitMs=${stats.translateWaitMs | 0} rpcs=${stats.rpcs} rpcMs=${stats.rpcMs | 0} clears=${stats.clears} evictions=${stats.evictions} cache=${cache.size} cacheWasmBytes=${cacheWasmBytes} cacheLimit=${cachePolicy.maxEntries} cacheWasmLimit=${cachePolicy.maxWasmBytes}`);
  if (typeof self.postMessage === 'function') self.postMessage({ type: 'cpu-cache', mailbox: mbox, reason, atMs: now, ...cacheSnapshot() });
  Object.assign(stats, { evictions: 0, hot: 0, compiles: 0, compileMs: 0, translateWaitMs: 0, rpcs: 0, rpcMs: 0, blocks: 0, clears: 0, last: now });
}

function refresh() {
  if (!i32 || i32.buffer !== memory.buffer) {
    i32 = new Int32Array(memory.buffer);
    view = new DataView(memory.buffer);
  }
}

function waitFor(expected) {
  const index = mbox >>> 2;
  let spins = 0;
  for (;;) {
    const value = Atomics.load(i32, index);
    if (value === expected) return;
    if (++spins > 2000) Atomics.wait(i32, index, value, 0.05);
  }
}

function request(kind) {
  refresh();
  i32[(mbox + KIND) >>> 2] = kind;
  Atomics.store(i32, mbox >>> 2, REQUEST);
  waitFor(REPLY);
  refresh();
  Atomics.store(i32, mbox >>> 2, BUSY);
  const gen = i32[(mbox + GEN) >>> 2];
  if (gen !== generation) clearCache(gen);
}

function rpc(id) {
  const t = performance.now();
  refresh();
  // Block entry of the dispatch loop. Newer translations also store the
  // instruction address at mailbox+192 before this call.
  view.setBigUint64(mbox + BLOCK_PC, blockPc, true);
  i32[(mbox + HELPER) >>> 2] = id;
  request(KIND_CALL);
  stats.rpcs++; stats.rpcMs += performance.now() - t;
}

const imports = () => ({ core: { rpc }, nxi: { mbox: mboxGlobal }, env: { memory } });

function compile(pc, kind) {
  view.setBigUint64(mbox + PC, pc, true);
  const t0 = performance.now();
  request(kind);
  const t1 = performance.now();
  const ptr = view.getUint32(mbox + MODPTR, true);
  const len = i32[(mbox + MODLEN) >>> 2];
  // Release cold exports before allocating the next module. Actual reclamation is
  // controlled by the engine's GC and is not promised by these accounting counters.
  makeRoom(len);
  const bytes = new Uint8Array(memory.buffer, ptr, len).slice();
  const fn = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports()).exports.run;
  stats.compiles++; stats.translateWaitMs += t1 - t0; stats.compileMs += performance.now() - t1;
  cacheTotals.compilations++; cacheTotals.compiledWasmBytes += len;
  return { fn, wasmBytes: len, n: i32[(mbox + MODHOT) >>> 2] ? -1 : 0, retained: false, referenced: false };
}

// Tier 0 is one guest block; after HOT_THRESHOLD runs the entry is re-translated as a region.
function lookup(pc) {
  let e = cache.get(pc);
  if (!e) {
    cacheTotals.misses++;
    e = compile(pc, KIND_TRANSLATE);
    // A translate request can bump the generation (cache cleared), so insert after it.
    // The host may answer with an existing region (MODHOT): it is already tier 1.
    remember(pc, e);
    return e;
  }
  cacheTotals.hits++;
  if (e.n >= 0 && ++e.n >= HOT_THRESHOLD) {
    releaseEntry(pc, e);
    e = compile(pc, KIND_TRANSLATE_HOT);
    stats.hot++;
    e.n = -1;
    remember(pc, e);
    return e;
  }
  e.referenced = true;
  return e;
}

function execute(pc, ctx) {
  const entry = lookup(pc);
  activeEntry = entry;
  try { return entry.fn(ctx); }
  finally {
    activeEntry = null;
    if (!entry.retained) entry.fn = null;
  }
}

function serve() {
  for (;;) {
    refresh();
    waitFor(RUN);
    Atomics.store(i32, mbox >>> 2, BUSY);
    const gen = i32[(mbox + GEN) >>> 2];
    if (gen !== generation) clearCache(gen);
    const ctx = view.getBigInt64(mbox + CTX, true);
    let pc = view.getBigUint64(mbox + PC, true);
    try {
      while (pc !== 0n) {
        blockPc = pc;
        pc = BigInt.asUintN(64, execute(pc, ctx));
        stats.blocks++;
        if ((stats.blocks & 1023) === 0) report();
        refresh();
      }
      i32[(mbox + KIND) >>> 2] = KIND_EXIT;
    } catch (error) {
      console.error(`NXI CPU worker fault near 0x${pc.toString(16)}: ${error && error.stack || error}`);
      refresh();
      view.setBigUint64(mbox + PC, pc, true);
      i32[(mbox + KIND) >>> 2] = KIND_FAULT;
    }
    report(true, i32[(mbox + KIND) >>> 2] === KIND_FAULT ? 'fault' : 'exit');
    Atomics.store(i32, mbox >>> 2, REQUEST);
    // The host acknowledges completion with IDLE, then may immediately reuse
    // this mailbox for RUN. Wait for RUN at the top of the loop: requiring us
    // to observe the transient IDLE can strand both threads on the next run.
  }
}

self.onmessage = ({ data }) => {
  memory = data.memory;
  mbox = data.mailbox >>> 0;
  configureCache(data.cachePolicy);
  mboxGlobal = new WebAssembly.Global({ value: 'i32', mutable: false }, mbox);
  refresh();
  report(true, 'ready');
  serve();
};

