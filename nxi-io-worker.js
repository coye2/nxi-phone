// All destinations belong to StorageMailbox, never to a temporary managed array.
const STATE = 0, OP = 4, HANDLE = 8, LENGTH = 12, DEST = 16, STATUS = 20, OFFSET = 24, RESULT = 32, NAMELEN = 40, READY = 44, NAME = 48;
const REQUEST = 1, DONE = 2, FAILED = 3, CAPACITY = 1024 * 1024;
let memory, mbox, i32, view;
const handles = new Map(), files = new Map();
let nextHandle = 1;
const scratch = new Uint8Array(CAPACITY);
function refresh() {
  if (!i32 || i32.buffer !== memory.buffer) { i32 = new Int32Array(memory.buffer); view = new DataView(memory.buffer); }
}
async function waitForRequest() {
  for (;;) {
    refresh();
    const value = Atomics.load(i32, mbox >>> 2);
    if (value === REQUEST) return;
    if (value === FAILED) throw new Error('Storage channel failed');
    // Blocking wait with a timeout: the core only flips the state (no notify), and WebKit
    // (iOS Safari) doesn't reliably wake Atomics.waitAsync on its timeout, which left
    // requests unanswered for 30 s. Nothing else runs on this worker between requests.
    Atomics.wait(i32, mbox >>> 2, value, 5);
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
    entry = { access: await file.createSyncAccessHandle(), refs: 0, name };
    created = true;
  }
  let size;
  try {
    size = entry.access.getSize();
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid file size');
  } catch (error) {
    if (created) entry.access.close();
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
}
function close() {
  const id = i32[(mbox + HANDLE) >>> 2], entry = handles.get(id);
  if (!entry) throw new Error('Unknown storage handle');
  handles.delete(id);
  if (--entry.refs === 0) { try { entry.access.close(); } finally { files.delete(entry.name); } }
}
async function processRequest() {
  refresh();
  try {
    const op = i32[(mbox + OP) >>> 2];
    if (op === 1) await open(); else if (op === 2) read(); else if (op === 3) close();
    else throw new Error('Unknown storage operation');
    refresh(); i32[(mbox + STATUS) >>> 2] = 0;
  } catch (error) {
    console.warn('NXI storage request failed:', error.message);
    refresh(); i32[(mbox + STATUS) >>> 2] = 1;
    view.setBigInt64(mbox + RESULT, 0n, true);
  }
  Atomics.store(i32, mbox >>> 2, DONE);
  Atomics.notify(i32, mbox >>> 2);
}
async function serve() { for (;;) { await waitForRequest(); await processRequest(); } }
self.onmessage = ({ data }) => {
  if (memory) return;
  memory = data.memory; mbox = data.mailbox >>> 0; refresh();
  if (mbox % 16 || mbox + 256 + CAPACITY > memory.buffer.byteLength) throw new Error('Invalid storage mailbox');
  Atomics.store(i32, (mbox + READY) >>> 2, 1);
  self.postMessage({ type: 'ready' });
  serve().catch(error => { refresh(); Atomics.store(i32, mbox >>> 2, FAILED); self.postMessage({ type: 'error', message: error.message }); });
};
