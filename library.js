// Immutable OPFS game objects + small commit records. Interrupted writes have no
// commit record and are never restored. No game data is uploaded or read all at once.
const DATA = 'nxi-games', INDEX = 'nxi-game-index', LEGACY = 'nxi-library';
const EXTENSIONS = /\.(nro|nso|nsp|xci)$/i;
async function directory(name) {
  if (!navigator.storage?.getDirectory) throw new Error('This browser does not support local game storage.');
  return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
}
async function writeJson(dir, name, value) {
  const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try { await writer.write(JSON.stringify(value)); await writer.close(); }
  catch (error) { try { await writer.abort(); } catch {} throw error; }
}
function valid(record) {
  return record?.version === 1 && /^[a-f0-9]{32}\.(nro|nso|nsp|xci)$/.test(record.id) &&
    typeof record.name === 'string' && record.name.length <= 256 && EXTENSIONS.test(record.name) &&
    !/[\/\\\x00-\x1f\x7f]/.test(record.name) && Number.isSafeInteger(record.size) && record.size > 0 &&
    Number.isSafeInteger(record.modified) && record.modified >= 0;
}
function importFailure(error, phase, signal, cancellable) {
  // Only our cancellation signal identifies a user-requested cancellation.
  // File providers and browser storage can also reject with AbortError.
  if (cancellable && signal?.aborted)
    return Object.assign(new Error('Game import cancelled.', { cause: error }), { name: 'AbortError', code: 'import_cancelled', phase });
  if (error?.importFailure) return error;
  if (phase === 'checking-game' && error?.name !== 'AbortError') return error;
  const message = error?.name === 'QuotaExceededError'
    ? 'Not enough device storage for this game. Free space and try again.'
    : phase === 'reading-file'
      ? 'NXI could not read the selected file. Make sure it is fully downloaded and available on this device, then choose it again.'
      : phase === 'checking-game'
        ? 'The game file was copied, but checking it was interrupted. Keep NXI open and try importing it again.'
        : 'NXI could not save the game to device storage. Check free space and browser storage access, keep NXI open, then try again.';
  return Object.assign(new Error(message, { cause: error }), { code: phase === 'reading-file' ? 'import_read_failed' : phase === 'checking-game' ? 'import_check_failed' : 'import_storage_failed', phase, importFailure: true });
}
// Copy in import-worker.js (sync access handle, 8 MB chunks). Resolves false where the browser
// has no sync access handles, so the caller falls back to the page-side writable stream.
function copyInWorker(file, id, signal, onProgress, setPhase) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL('./import-worker.js', import.meta.url), { name: 'NXI import' }); }
    catch { resolve(false); return; }
    const finish = (fn, value) => { signal?.removeEventListener('abort', abort); worker.terminate(); fn(value); };
    const abort = () => { worker.postMessage('cancel'); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => finish(reject, new Error(event.message || 'The import worker failed.'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data.done, file.size);
      else if (data.type === 'unsupported') finish(resolve, false);
      else if (data.type === 'done') finish(resolve, true);
      else if (data.type === 'error') {
        setPhase(data.phase);
        if (data.changed) finish(reject, changedFile());
        else finish(reject, Object.assign(new Error(data.message), { name: data.name }));
      }
    };
    worker.postMessage({ file, id, dir: DATA });
  });
}
function changedFile() {
  return Object.assign(new Error('The selected file changed during import. Choose it again.'), { code: 'import_file_changed', importFailure: true });
}
export async function importToLibrary(file, api, { signal, onProgress = () => {}, onPhase = () => {} } = {}) {
  if (!EXTENSIONS.test(file.name) || /[\/\\\x00-\x1f\x7f]/.test(file.name) || file.name.length > 256)
    throw new Error('Choose an NRO, NSO, NSP or XCI file.');
  if (!Number.isSafeInteger(file.size) || file.size < 20) throw new Error('The selected file is empty or truncated.');
  signal?.throwIfAborted();
  if (!navigator.storage?.getDirectory) throw new Error('This browser does not support local game storage.');
  const ext = file.name.match(EXTENSIONS)[0].toLowerCase();
  const id = crypto.randomUUID().replaceAll('-', '') + ext;
  const record = { version: 1, id, name: file.name, size: file.size, modified: Math.max(0, Math.trunc(file.lastModified || Date.now())) };
  let data, index, writer, reader, registered = false, cancellable = true, phase = 'opening-storage';
  const cancelRead = () => { const pending = reader?.cancel(); pending?.catch(() => {}); };
  try {
    const estimate = await navigator.storage.estimate?.();
    if (estimate?.quota && file.size > estimate.quota - (estimate.usage || 0))
      throw Object.assign(new Error('Not enough device storage for this game. Free space and try again.'), { importFailure: true, code: 'import_storage_full' });
    data = await directory(DATA); index = await directory(INDEX);
    onPhase('copying');
    phase = 'writing-file';
    const copied = typeof Worker === 'function' && await copyInWorker(file, id, signal, onProgress, next => { phase = next; });
    if (!copied) {
      writer = await (await data.getFileHandle(id, { create: true })).createWritable();
      phase = 'reading-file';
      reader = file.stream().getReader();
      signal?.addEventListener('abort', cancelRead, { once: true });
      let done = 0;
      for (;;) {
        signal?.throwIfAborted();
        phase = 'reading-file';
        const part = await reader.read();
        if (part.done) break;
        if (done + part.value.byteLength > file.size) throw changedFile();
        phase = 'writing-file';
        await writer.write(part.value); done += part.value.byteLength; onProgress(done, file.size);
      }
      if (done !== file.size) throw changedFile();
    }
    signal?.throwIfAborted();
    // Cancellation ends at this boundary: finish the durable record and native
    // registration together instead of presenting a cancelled committed import.
    cancellable = false; signal?.removeEventListener('abort', cancelRead);
    phase = 'closing-file'; onPhase('finalizing');
    if (writer) { await writer.close(); writer = null; }
    phase = 'saving-record';
    await writeJson(index, id + '.json', record);
    phase = 'checking-game'; onPhase('checking');
    const result = JSON.parse(await api.ImportStoredContent(id, record.name, record.size, record.modified));
    registered = true;
    // Persistence permission is a best-effort request after the durable import.
    try { const persistence = navigator.storage.persist?.(); persistence?.catch(() => {}); } catch {}
    return { ...record, ...result };
  } catch (error) {
    if (registered) await api.ForgetStoredContent(id).catch(() => {});
    try { await writer?.abort(); } catch {}
    try { await index?.removeEntry(id + '.json'); } catch {}
    try { await data?.removeEntry(id); } catch {}
    throw importFailure(error, phase, signal, cancellable);
  } finally {
    signal?.removeEventListener('abort', cancelRead);
    try { await reader?.cancel(); } catch {}
    try { reader?.releaseLock(); } catch {}
  }
}
export async function restoreLibrary(api, onProgress = () => {}) {
  const report = { restored: 0, skipped: 0, warnings: [] };
  const data = await directory(DATA), index = await directory(INDEX);
  for await (const [name, handle] of index.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    try {
      const meta = await handle.getFile();
      if (meta.size > 4096) throw new Error('Invalid saved game record');
      const record = JSON.parse(await meta.text());
      if (!valid(record) || name !== record.id + '.json') throw new Error('Invalid saved game record');
      const file = await (await data.getFileHandle(record.id)).getFile();
      if (file.size !== record.size) throw new Error('Stored game size changed');
      const result = JSON.parse(await api.ImportStoredContent(record.id, record.name, record.size, record.modified));
      report.restored++; if (result.warning) report.warnings.push(result.warning);
      onProgress(report.restored);
    } catch (error) { report.skipped++; console.warn('NXI restore skipped a saved game:', error.message); }
  }
  // One-time migration of the earlier homebrew store, streamed from the old Blob.
  const legacy = await directory(LEGACY);
  for await (const [name, handle] of legacy.entries()) {
    if (handle.kind !== 'file' || !/\.(nro|nso)$/i.test(name)) continue;
    try { await importToLibrary(await handle.getFile(), api); await legacy.removeEntry(name); report.restored++; }
    catch (error) { report.skipped++; console.warn('NXI legacy migration failed:', error.message); }
  }
  return report;
}
