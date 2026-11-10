// NXI Mobile CPU worker: executes WASM translated from guest ARM64 by Kenji's
// ARMeilleure front end. Imports the runtime's shared memory; talks to its guest
// host thread only through the mailbox (see ARMeilleure WasmAbi).
const STATE = 0, KIND = 4, HELPER = 8, MODLEN = 12, PC = 16, CTX = 24, MODPTR = 32, GEN = 40, MODHOT = 44;
const RUN = 1, BUSY = 2, REQUEST = 3, REPLY = 4;
const KIND_EXIT = 1, KIND_TRANSLATE = 2, KIND_CALL = 3, KIND_FAULT = 4, KIND_TRANSLATE_HOT = 5;
// Entries run this many times before their whole region is re-translated (tier 1).
const HOT_THRESHOLD = 256;

let memory, mbox, i32, view, mboxGlobal, generation = -1;
const cache = new Map();
// Each translated block is its own WebAssembly module, and WebKit (iOS) keeps about 7 KB per
// module; games run tens of thousands of blocks once (boot, loading) and never again. Keep the
// most recently used ones: every hit stamps the entry, and when the cache is full the least
// recently used half goes. Dropped entries come back from the host's translation cache.
const CACHE_LIMIT = 12000;
let tick = 0;
function remember(pc, e) {
  e.t = ++tick;
  cache.set(pc, e);
  if (cache.size <= CACHE_LIMIT) return;
  const stamps = new Float64Array(cache.size);
  let i = 0;
  for (const entry of cache.values()) stamps[i++] = entry.t;
  stamps.sort();
  const cut = stamps[cache.size >> 1];
  for (const [key, entry] of cache) if (entry.t <= cut && key !== pc) cache.delete(key);
  stats.evictions++;
}
// Perf counters, printed every 5 s while busy (NXI-CPU-STATS).
const stats = { evictions: 0, hot: 0, compiles: 0, compileMs: 0, translateWaitMs: 0, rpcs: 0, rpcMs: 0, blocks: 0, clears: 0, last: performance.now() };
function report() {
  const now = performance.now();
  if (now - stats.last < 5000) return;
  console.log(`NXI-CPU-STATS blocks=${stats.blocks} compiles=${stats.compiles} hot=${stats.hot} compileMs=${stats.compileMs | 0} translateWaitMs=${stats.translateWaitMs | 0} rpcs=${stats.rpcs} rpcMs=${stats.rpcMs | 0} clears=${stats.clears} evictions=${stats.evictions} cache=${cache.size}`);
  Object.assign(stats, { evictions: 0, hot: 0, compiles: 0, compileMs: 0, translateWaitMs: 0, rpcs: 0, rpcMs: 0, blocks: 0, clears: 0, last: now });
}

function refresh() {
  if (!i32 || i32.buffer !== memory.buffer) {
    i32 = new Int32Array(memory.buffer);
    view = new DataView(memory.buffer);
  }
}

function waitFor(expected) {
  const index = mbox >> 2;
  let spins = 0;
  for (;;) {
    const value = Atomics.load(i32, index);
    if (value === expected) return;
    if (++spins > 2000) Atomics.wait(i32, index, value, 0.05);
  }
}

function request(kind) {
  refresh();
  i32[(mbox + KIND) >> 2] = kind;
  Atomics.store(i32, mbox >> 2, REQUEST);
  waitFor(REPLY);
  refresh();
  Atomics.store(i32, mbox >> 2, BUSY);
  const gen = i32[(mbox + GEN) >> 2];
  if (gen !== generation) { cache.clear(); generation = gen; stats.clears++; }
}

function rpc(id) {
  const t = performance.now();
  refresh();
  i32[(mbox + HELPER) >> 2] = id;
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
  const len = i32[(mbox + MODLEN) >> 2];
  const bytes = new Uint8Array(memory.buffer, ptr, len).slice();
  const fn = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports()).exports.run;
  stats.compiles++; stats.translateWaitMs += t1 - t0; stats.compileMs += performance.now() - t1;
  return fn;
}

// Tier 0 is one guest block; after HOT_THRESHOLD runs the entry is re-translated as a region.
function lookup(pc) {
  let e = cache.get(pc);
  if (!e) {
    const fn = compile(pc, KIND_TRANSLATE);
    // A translate request can bump the generation (cache cleared), so insert after it.
    // The host may answer with an existing region (MODHOT): it is already tier 1.
    e = { fn, n: i32[(mbox + MODHOT) >> 2] ? -1 : 0 };
    remember(pc, e);
    return fn;
  }
  if (e.n >= 0 && ++e.n >= HOT_THRESHOLD) {
    e.n = -1;
    const fn = compile(pc, KIND_TRANSLATE_HOT);
    stats.hot++;
    e = { fn, n: -1 };
    remember(pc, e);
    return fn;
  }
  e.t = ++tick;
  return e.fn;
}

function serve() {
  for (;;) {
    refresh();
    waitFor(RUN);
    Atomics.store(i32, mbox >> 2, BUSY);
    const gen = i32[(mbox + GEN) >> 2];
    if (gen !== generation) { cache.clear(); generation = gen; }
    const ctx = view.getBigInt64(mbox + CTX, true);
    let pc = view.getBigUint64(mbox + PC, true);
    try {
      while (pc !== 0n) {
        pc = BigInt.asUintN(64, lookup(pc)(ctx));
        stats.blocks++;
        if ((stats.blocks & 1023) === 0) report();
        refresh();
      }
      i32[(mbox + KIND) >> 2] = KIND_EXIT;
    } catch (error) {
      console.error(`NXI CPU worker fault near 0x${pc.toString(16)}: ${error && error.stack || error}`);
      refresh();
      view.setBigUint64(mbox + PC, pc, true);
      i32[(mbox + KIND) >> 2] = KIND_FAULT;
    }
    Atomics.store(i32, mbox >> 2, REQUEST);
    // The host acknowledges completion with IDLE, then may immediately reuse
    // this mailbox for RUN. Wait for RUN at the top of the loop: requiring us
    // to observe the transient IDLE can strand both threads on the next run.
  }
}

self.onmessage = ({ data }) => {
  memory = data.memory;
  mbox = data.mailbox;
  mboxGlobal = new WebAssembly.Global({ value: 'i32', mutable: false }, mbox);
  refresh();
  serve();
};
