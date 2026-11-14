// Worker half of the paging latency probe (?pagerprobe, see pager-probe.js).
// role "pager": owns an OPFS sync access handle and serves page-in / write-back requests.
// role "cpu": plays a guest CPU thread: a fixed pool of resident slots with CLOCK replacement,
// blocking on Atomics.wait for every miss, like a guest load stalled in the MMU slow path.
// Mailbox (Int32Array over a SharedArrayBuffer):
//   0 state (0 idle, 1 request, 2 done, 3 error)  1 op (0 no I/O, 1 read, 2 write back + read)
//   2 slot  3 new page  4 old page  5 page bytes  6 request generation  7 completed generation
// Timing (Float64Array): 0 last read ms, 1 last write ms.
const FILE = 'mochi-pager-probe.bin';
const expected = (page, word) => ((page * 2654435761) ^ (word * 40503) ^ 0x5a17) | 0;

function fillPage(view32, page, wordsPerPage, firstWord) {
  // Pattern for one page: first and last word carry the page identity.
  view32[firstWord] = expected(page, 0);
  view32[firstWord + wordsPerPage - 1] = expected(page, wordsPerPage - 1);
}

async function pager({ mailbox, timing, pool, backingBytes, pageBytes }) {
  const mb = new Int32Array(mailbox), times = new Float64Array(timing), poolBytes = new Uint8Array(pool);
  const root = await navigator.storage.getDirectory();
  const file = await root.getFileHandle(FILE, { create: true });
  const handle = await file.createSyncAccessHandle();
  const info = { initMs: 0, rewritten: false, sharedReads: null, sharedWrites: null };
  const words = pageBytes / 4;
  // (Re)write the backing file when its size or page pattern doesn't match this run.
  const probe = new Int32Array(1);
  const okAt = page => { handle.read(probe, { at: page * pageBytes }); return probe[0] === expected(page, 0); };
  if (handle.getSize() !== backingBytes || !okAt(0) || !okAt(backingBytes / pageBytes - 1)) {
    const t = performance.now(), chunk = 1 << 20, buf = new Int32Array(chunk / 4);
    handle.truncate(0);
    for (let at = 0; at < backingBytes; at += chunk) {
      buf.fill(0);
      for (let p = 0; p < chunk / pageBytes; p++) fillPage(buf, at / pageBytes + p, words, p * words);
      handle.write(buf, { at });
    }
    handle.flush();
    info.initMs = performance.now() - t; info.rewritten = true;
  }
  const scratch = new Uint8Array(pageBytes);
  const read = (slot, page) => {
    const dest = poolBytes.subarray(slot * pageBytes, (slot + 1) * pageBytes);
    if (info.sharedReads !== false) {
      try { const n = handle.read(dest, { at: page * pageBytes }); info.sharedReads = true; return n; }
      catch { info.sharedReads = false; }
    }
    const n = handle.read(scratch, { at: page * pageBytes });
    dest.set(scratch); return n;
  };
  const write = (slot, page) => {
    const src = poolBytes.subarray(slot * pageBytes, (slot + 1) * pageBytes);
    if (info.sharedWrites !== false) {
      try { const n = handle.write(src, { at: page * pageBytes }); info.sharedWrites = true; return n; }
      catch { info.sharedWrites = false; }
    }
    scratch.set(src); return handle.write(scratch, { at: page * pageBytes });
  };
  postMessage({ ready: true, info });
  for (;;) {
    Atomics.wait(mb, 0, 0);
    if (Atomics.load(mb, 0) === 9) break; // stop
    if (Atomics.load(mb, 0) !== 1) continue;
    try {
      const op = mb[1], slot = mb[2];
      times[0] = 0; times[1] = 0;
      if (op === 2) { const t = performance.now(); if (write(slot, mb[4]) !== pageBytes) throw Error('short write'); times[1] = performance.now() - t; }
      if (op >= 1) { const t = performance.now(); if (read(slot, mb[3]) !== pageBytes) throw Error('short read'); times[0] = performance.now() - t; }
      mb[7] = mb[6];
      Atomics.store(mb, 0, 2);
    } catch (error) {
      postMessage({ error: String(error && error.message || error) });
      Atomics.store(mb, 0, 3);
    }
    Atomics.notify(mb, 0);
  }
  handle.close();
  postMessage({ stopped: true, info });
}

function cpu({ mailbox, timing, pool, backingBytes, pageBytes, requests, dirtyEvery, pattern, controlRequests }) {
  const mb = new Int32Array(mailbox), times = new Float64Array(timing), pool32 = new Int32Array(pool);
  const slots = pool.byteLength / pageBytes, pages = backingBytes / pageBytes, words = pageBytes / 4;
  const slotPage = new Int32Array(slots).fill(-1), pageSlot = new Int32Array(pages).fill(-1);
  const ref = new Uint8Array(slots), dirty = new Uint8Array(slots);
  const out = { hit: [], cleanFault: [], dirtyFault: [], noIO: [], pagerRead: [], pagerWrite: [], errors: 0, mismatches: 0 };
  let hand = 0, generation = 0, seq = 0, rng = 0x9e3779b9;
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const roundTrip = (op, slot, newPage, oldPage) => {
    mb[1] = op; mb[2] = slot; mb[3] = newPage; mb[4] = oldPage; mb[5] = pageBytes; mb[6] = ++generation;
    Atomics.store(mb, 0, 1);
    Atomics.notify(mb, 0);
    while (Atomics.load(mb, 0) === 1) Atomics.wait(mb, 0, 1);
    const state = Atomics.load(mb, 0);
    Atomics.store(mb, 0, 0);
    if (state !== 2 || mb[7] !== generation) { out.errors++; return false; }
    return true;
  };
  // Control: wake-up cost with no storage at all.
  for (let i = 0; i < controlRequests; i++) {
    const t = performance.now(); roundTrip(0, 0, 0, 0); out.noIO.push(performance.now() - t);
  }
  for (let i = 0; i < requests; i++) {
    const page = pattern === 'sequential' ? i % pages : Math.floor(random() * pages);
    const makeDirty = dirtyEvery > 0 && (++seq % dirtyEvery) === 0;
    const t = performance.now();
    let slot = pageSlot[page], kind = 'hit';
    if (slot < 0) {
      for (;;) { if (slotPage[hand] < 0 || !ref[hand]) break; ref[hand] = 0; hand = (hand + 1) % slots; }
      slot = hand; hand = (hand + 1) % slots;
      const old = slotPage[slot], writeBack = old >= 0 && dirty[slot];
      kind = writeBack ? 'dirtyFault' : 'cleanFault';
      if (!roundTrip(writeBack ? 2 : 1, slot, page, old)) continue;
      if (old >= 0) pageSlot[old] = -1;
      slotPage[slot] = page; pageSlot[page] = slot; dirty[slot] = 0;
    }
    // The resumed guest load: check the page identity.
    if (pool32[slot * words] !== expected(page, 0) || pool32[slot * words + words - 1] !== expected(page, words - 1)) out.mismatches++;
    if (makeDirty) { pool32[slot * words + 1] = 0; dirty[slot] = 1; } // word 1 is zero in the pattern
    ref[slot] = 1;
    out[kind].push(performance.now() - t);
    if (kind !== 'hit') { out.pagerRead.push(times[0]); if (kind === 'dirtyFault') out.pagerWrite.push(times[1]); }
  }
  postMessage({ done: true, out });
}

onmessage = event => {
  const { role } = event.data;
  if (role === 'pager') pager(event.data).catch(error => postMessage({ error: 'pager: ' + (error && error.message || error) }));
  else if (role === 'cpu') { try { cpu(event.data); } catch (error) { postMessage({ error: 'cpu: ' + (error && error.message || error) }); } }
};
