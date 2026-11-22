// All destinations belong to StorageMailbox, never to a temporary managed array.
const STATE = 0, OP = 4, HANDLE = 8, LENGTH = 12, DEST = 16, STATUS = 20, OFFSET = 24, RESULT = 32, NAMELEN = 40, READY = 44, NAME = 48;
const REQUEST = 1, DONE = 2, FAILED = 3, CAPACITY = 1024 * 1024;
let memory, mbox, i32, view;
let telemetry;
const counts = { requests: 0, completed: 0, reads: 0, bytes: 0, retries: 0 };
// Optional page-owned diagnostics; never use native mailbox padding or file names.
function observe(stage, op = 0, error = 0) {
  if (!telemetry) return;
  Atomics.add(telemetry, 0, 1);
  telemetry[1] = stage; telemetry[2] = op;
  telemetry[3] = counts.requests; telemetry[4] = counts.completed;
  telemetry[5] = counts.reads; telemetry[6] = counts.bytes >>> 0;
  telemetry[7] = Math.floor(counts.bytes / 4294967296);
  telemetry[8] = handles.size; telemetry[9] = counts.retries; telemetry[10] = error;
  Atomics.add(telemetry, 0, 1);
}
const handles = new Map(), files = new Map();
let nextHandle = 1;
const scratch = new Uint8Array(CAPACITY);
async function openAccess(file) {
  // WebKit may retain the previous access handle's lock briefly after close.
  // Retry delays total at most 2.85 s; the native mailbox retains its 10 s
  // deadline. Never retry permission, quota or missing-file errors.
  for (let attempt = 0; ; attempt++) {
    try { return await file.createSyncAccessHandle(); }
    catch (error) {
      if (error?.name !== 'InvalidStateError' || attempt === 19) throw error;
      counts.retries++; observe(1, 1);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}
function refresh() {
  if (!i32 || i32.buffer !== memory.buffer) { i32 = new Int32Array(memory.buffer); view = new DataView(memory.buffer); }
}
async function waitForRequest() {
  let waits = 0;
  for (;;) {
    refresh();
    const value = Atomics.load(i32, mbox >>> 2);
    if (value === REQUEST) return;
    if (value === FAILED) throw new Error('Storage channel failed');
    // Keep short waits during an active read burst. After 100 ms without work,
    // yield a task and poll at 25 ms: the old infinite blocking loop never let
    // the worker event loop run while idle and woke 200 times/second on the shelf.
    // Do not use waitAsync: its timeout was unreliable on WebKit. Native code
    // does not notify, so every idle wait must still have a bounded timeout.
    if (waits++ < 20) Atomics.wait(i32, mbox >>> 2, value, 5);
    else await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function open() {
  const length = i32[(mbox + NAMELEN) >>> 2];
  if (length < 1 || length > 200) throw new Error('Invalid name length');
  const name = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(memory.buffer, mbox + NAME, length).slice());
  if (name === '.' || name === '..' || /[/\\\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid file name');
  let entry = files.get(name);
  let created = false;
  if (!entry) {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('nxi-games');
    const file = await dir.getFileHandle(name);
    entry = { access: await openAccess(file), refs: 0, name };
    created = true;
  }
  let size;
  try {
    size = entry.access.getSize();
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid file size');
  } catch (error) {
    if (created) await entry.access.close();
    throw error;
  }
  if (created) files.set(name, entry);
  const id = nextHandle++;
  entry.refs++; handles.set(id, entry);
  refresh();
  i32[(mbox + HANDLE) >>> 2] = id;
  view.setBigInt64(mbox + RESULT, BigInt(size), true);
}
function read() {
  const entry = handles.get(i32[(mbox + HANDLE) >>> 2]);
  const length = i32[(mbox + LENGTH) >>> 2], dest = i32[(mbox + DEST) >>> 2] >>> 0;
  const at = Number(view.getBigInt64(mbox + OFFSET, true));
  if (!entry || length < 0 || length > CAPACITY || dest !== mbox + 256 ||
      dest + length > memory.buffer.byteLength || !Number.isSafeInteger(at) || at < 0)
    throw new Error('Invalid storage read');
  const n = entry.access.read(scratch.subarray(0, length), { at });
  if (!Number.isInteger(n) || n < 0 || n > length) throw new Error('Invalid storage result');
  refresh();
  new Uint8Array(memory.buffer, dest, n).set(scratch.subarray(0, n));
  view.setBigInt64(mbox + RESULT, BigInt(n), true);
  counts.reads++; counts.bytes += n;
}
async function close() {
  const id = i32[(mbox + HANDLE) >>> 2], entry = handles.get(id);
  if (!entry) throw new Error('Unknown storage handle');
  handles.delete(id);
  if (--entry.refs === 0) { try { await entry.access.close(); } finally { files.delete(entry.name); } }
}
async function processRequest() {
  refresh();
  const op = i32[(mbox + OP) >>> 2];
  counts.requests++; observe(op >= 1 && op <= 3 ? op : 4, op);
  let failed = false;
  try {
    if (op === 1) await open(); else if (op === 2) read(); else if (op === 3) await close();
    else throw new Error('Unknown storage operation');
    refresh(); i32[(mbox + STATUS) >>> 2] = 0;
  } catch (error) {
    failed = true;
    console.warn('NXI storage request failed:', error.message);
    refresh(); i32[(mbox + STATUS) >>> 2] = 1;
    view.setBigInt64(mbox + RESULT, 0n, true);
  }
  counts.completed++; observe(failed ? 4 : 0, op, failed ? 1 : 0);
  Atomics.store(i32, mbox >>> 2, DONE);
  Atomics.notify(i32, mbox >>> 2);
}
async function serve() { for (;;) { await waitForRequest(); await processRequest(); } }
self.onmessage = ({ data }) => {
  if (memory) return;
  memory = data.memory; mbox = data.mailbox >>> 0; refresh();
  if (typeof SharedArrayBuffer !== 'undefined' && data.diagnostics instanceof SharedArrayBuffer && data.diagnostics.byteLength === 64)
    telemetry = new Int32Array(data.diagnostics);
  if (mbox % 16 || mbox + 256 + CAPACITY > memory.buffer.byteLength) throw new Error('Invalid storage mailbox');
  Atomics.store(i32, (mbox + READY) >>> 2, 1);
  self.postMessage({ type: 'ready' });
  serve().catch(error => { refresh(); Atomics.store(i32, mbox >>> 2, FAILED); self.postMessage({ type: 'error', message: error.message }); });
};
