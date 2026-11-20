// Browser pager protocol — the JS counterpart of the C# fault bridge (Ryujinx.Memory.BrowserPaging).
// The CPU worker (C# in wasm) and this pager worker share one SharedArrayBuffer laid out exactly like
// PagerMailbox: eight 32-bit control words, then a page-sized scratch region. The CPU side publishes a
// request and parks on Atomics.wait(Done); the pager side services it from OPFS and Atomics.notify(Done).
// This file holds the pure protocol (no Worker, no OPFS, no Atomics.wait) so it can be unit-tested; the
// worker shell in pager-worker.js adds the blocking wait and the real storage. Keep both layouts in sync
// with PagerMailbox.cs. This module is not yet wired into Mochi's memory path.

export const CONTROL = { Request: 0, Op: 1, PageId: 2, Offset: 3, Length: 4, Count: 5, Status: 6, Done: 7 };
export const CONTROL_WORDS = 8;
export const CONTROL_BYTES = CONTROL_WORDS * 4;
export const OP_READ_IN = 1;   // storage -> scratch (page fault page-in)
export const OP_WRITE_OUT = 2; // scratch -> storage (dirty eviction)

// Views over a shared mailbox buffer: { ctrl: Int32Array(8), scratch: Uint8Array(pageSize) }.
export function mailboxViews(buffer, pageSize) {
  return { ctrl: new Int32Array(buffer, 0, CONTROL_WORDS), scratch: new Uint8Array(buffer, CONTROL_BYTES, pageSize) };
}

export function mailboxByteLength(pageSize) {
  return CONTROL_BYTES + pageSize;
}

// Service exactly one already-published request: run the read or write against `storage` through the
// shared scratch, publish the transferred count and status, then set Done to the request sequence.
// The caller (worker) is responsible for Atomics.notify(Done) afterwards. storage is
// { readPage(pageId, offset, dest) -> count, writePage(pageId, offset, src) -> count }; a thrown error
// or a non-positive/over-long count becomes a failure status, matching the C# BrowserPagerServer.
export function servePagerRequest(ctrl, scratch, storage) {
  const request = ctrl[CONTROL.Request];
  const op = ctrl[CONTROL.Op];
  const pageId = ctrl[CONTROL.PageId];
  const offset = ctrl[CONTROL.Offset];
  const length = ctrl[CONTROL.Length];

  let count = 0, status = 0;
  try {
    if (length < 0 || length > scratch.length || offset < 0) throw new RangeError('bad request bounds');
    const view = scratch.subarray(0, length);
    count = op === OP_READ_IN ? storage.readPage(pageId, offset, view) : storage.writePage(pageId, offset, view);
    if (!Number.isInteger(count) || count < 0 || count > length) throw new RangeError('bad transfer count');
  } catch {
    status = -1;
    count = 0;
  }

  ctrl[CONTROL.Count] = count;
  ctrl[CONTROL.Status] = status;
  ctrl[CONTROL.Done] = request;
  return { request, op, status, count };
}
