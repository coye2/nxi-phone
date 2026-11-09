// Copies one picked game file into OPFS in big chunks with a sync access handle. On iPhones the
// page-side writable stream was slow (a few MB/s) and Safari killed the page part way through a
// multi-GB XCI. Memory stays at one chunk. Messages: {file, id} -> progress/done/error; 'cancel'.
const CHUNK = 8 * 1024 * 1024;
let cancelled = false;
self.onmessage = async ({ data }) => {
  if (data === 'cancel') { cancelled = true; return; }
  const { file, id, dir } = data;
  let handle;
  try {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle(dir, { create: true });
    const entry = await folder.getFileHandle(id, { create: true });
    if (typeof entry.createSyncAccessHandle !== 'function') { self.postMessage({ type: 'unsupported' }); return; }
    handle = await entry.createSyncAccessHandle();
    handle.truncate(0);
    let done = 0, reported = 0;
    while (done < file.size) {
      if (cancelled) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      let chunk;
      try { chunk = new Uint8Array(await file.slice(done, Math.min(file.size, done + CHUNK)).arrayBuffer()); }
      catch (error) { throw Object.assign(error, { readFailed: true }); }
      if (!chunk.length) throw Object.assign(new Error('The selected file changed during import. Choose it again.'), { changed: true });
      let written = 0;
      while (written < chunk.length) {
        const n = handle.write(chunk.subarray(written), { at: done + written });
        if (!(n > 0)) throw new Error('Device storage stopped accepting data.');
        written += n;
      }
      done += chunk.length;
      if (Date.now() - reported > 250 || done === file.size) { reported = Date.now(); self.postMessage({ type: 'progress', done }); }
    }
    handle.flush();
    if (handle.getSize() !== file.size) throw Object.assign(new Error('The selected file changed during import. Choose it again.'), { changed: true });
    handle.close(); handle = null;
    self.postMessage({ type: 'done', size: done });
  } catch (error) {
    // Release the file before answering, so the page can delete the partial copy.
    try { handle?.close(); } catch {}
    self.postMessage({ type: 'error', phase: error.readFailed ? 'reading-file' : 'writing-file', name: error.name, message: error.message, changed: !!error.changed });
  }
};
