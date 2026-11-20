// Browser pager worker — production pager side of the fault bridge (see pager-protocol.js). It owns one
// OPFS sync access handle (the swap file) and services page faults published by the C# CPU worker over a
// shared mailbox: park on Atomics.wait(Request), serve the read/write from OPFS through the scratch, then
// Atomics.notify(Done). Storage latency is isolated here, so the stalled CPU worker only pays the transfer
// plus the wake. Not yet wired into Mochi's memory path; started only by the (future) paging experiment.
//
// Message: { buffer: SharedArrayBuffer, pageSize, fileName } — buffer is the PagerMailbox arena.
import { mailboxViews, servePagerRequest, CONTROL, OP_READ_IN } from './pager-protocol.js';

let running = false;

onmessage = async (event) => {
  const { buffer, pageSize, fileName } = event.data || {};
  if (running || !buffer) return;
  running = true;

  const { ctrl, scratch } = mailboxViews(buffer, pageSize);
  const root = await navigator.storage.getDirectory();
  const file = await root.getFileHandle(fileName, { create: true });

  // Retry the handle: iOS throws InvalidStateError while a prior handle is still releasing its lock.
  let handle = null;
  for (let attempt = 0; attempt < 20 && !handle; attempt++) {
    try { handle = await file.createSyncAccessHandle(); }
    catch (error) { if (error?.name !== 'InvalidStateError' || attempt === 19) throw error; await new Promise(r => setTimeout(r, 150)); }
  }

  // The pager's OPFS-backed storage. Reads/writes may be short; the C# store retries until whole.
  const storage = {
    readPage(pageId, offset, dest) { return handle.read(dest, { at: pageId * pageSize + offset }); },
    writePage(pageId, offset, src) { const n = handle.write(src, { at: pageId * pageSize + offset }); handle.flush(); return n; },
  };

  postMessage({ ready: true });

  let served = ctrl[CONTROL.Request];
  for (;;) {
    // Park until a new request sequence appears. Atomics.wait returns on notify or value change.
    while (Atomics.load(ctrl, CONTROL.Request) === served) {
      Atomics.wait(ctrl, CONTROL.Request, served);
    }
    served = Atomics.load(ctrl, CONTROL.Request);
    if (served < 0) break; // negative request == stop

    servePagerRequest(ctrl, scratch, storage);
    Atomics.notify(ctrl, CONTROL.Done);
  }
  handle.close();
  postMessage({ stopped: true });
};
void OP_READ_IN;
