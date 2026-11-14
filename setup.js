import { collectFirmware, writeFirmwareZip, zipEntries } from './firmware-package.js';
// User-supplied setup files stay in this origin's private storage.
import { canonicalKeyFileName, MAX_KEY_FILE_BYTES, prepareKeyFile } from './key-file.js';
const DIR = 'nxi-setup';
const KEYS_LOCK = 'nxi-setup-keys';
async function directory() { return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true }); }
const sameBytes = (left, right) => left === null || right === null ? left === right :
  left.length === right.length && left.every((byte, index) => byte === right[index]);
async function savedKeyBytes(dir, name) {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    if (file.size > MAX_KEY_FILE_BYTES) throw new Error();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size || bytes.length > MAX_KEY_FILE_BYTES) throw new Error();
    return bytes;
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw new Error('The previously saved key file could not be read safely. It has been kept. Reload Mochi and try again.');
  }
}
class SavedKeysChangedError extends Error {
  constructor() {
    super('Keys loaded for this session, but another Mochi window changed the saved key file. Its saved file was kept. Try the import again.');
  }
}
async function assertSavedKeysUnchanged(dir, name, before) {
  if (!sameBytes(before, await savedKeyBytes(dir, name))) throw new SavedKeysChangedError();
}
function mergeCompatibleKeys(previous, incoming) {
  const entries = new Map();
  for (const [bytes, retained] of [[previous?.bytes, true], [incoming.bytes, false]]) {
    if (!bytes) continue;
    for (const line of new TextDecoder().decode(bytes).trimEnd().split('\n')) {
      const key = line.slice(0, line.indexOf(' = '));
      // Keep the position of each LAST occurrence. Earlier aliases must remain
      // before the incoming entries that overwrite the same native destination.
      // Do not sort names or remove _dev: its meaning depends on the key type.
      entries.delete(key); entries.set(key, { line, retained });
    }
  }
  return {
    bytes: new TextEncoder().encode([...entries.values()].map(entry => entry.line).join('\n') + '\n'),
    retainedEntries: [...entries.values()].filter(entry => entry.retained).length,
  };
}
export async function saveKeys(file, api, { compatibleOnly = false } = {}) {
  const name = canonicalKeyFileName(file.name);
  if (file.size < 16 || file.size > MAX_KEY_FILE_BYTES)
    throw new Error('Choose a non-empty key file up to 1 MiB.');
  let source;
  try { source = new Uint8Array(await file.arrayBuffer()); }
  catch { throw new Error('The selected key file could not be read. Choose it again from Files.'); }
  // Strict review happens before any storage access or native import. Recovery
  // is a distinct caller choice; an exception never silently triggers it.
  const incoming = prepareKeyFile(file.name, source, { compatibleOnly });
  if (!navigator.locks?.request) throw new Error('Key-file saving is unavailable in this browser. Use a supported browser and try again.');
  return navigator.locks.request(KEYS_LOCK, { mode: 'exclusive' }, async () => {
    let dir;
    try { dir = await directory(); }
    catch { throw new Error('Saved key files could not be accessed. Reload Mochi and try again.'); }
    // Read the latest prior file under the lock, only after an explicit action.
    const previousBytes = await savedKeyBytes(dir, name);
    let prepared = incoming, retainedEntries = 0;
    if (compatibleOnly) {
      let previous;
      if (previousBytes !== null) {
        try { previous = prepareKeyFile(name, previousBytes); }
        catch { throw new Error('The previously saved key file could not be validated. It has been kept; compatible entries were not imported.'); }
      }
      const merged = mergeCompatibleKeys(previous, incoming);
      retainedEntries = merged.retainedEntries;
      // The exact final bytes must satisfy the strict parser too. Neither a
      // saved-file problem nor a merge may bypass native format requirements.
      prepared = prepareKeyFile(name, merged.bytes);
    }
    try { await api.ImportKeys(name, prepared.bytes); }
    catch {
      // Native parser exceptions may contain private values. An unsuccessful
      // import must neither persist the file nor claim its keys were loaded.
      throw new Error('Mochi could not load this key file. Stop any running game, then try again. Your saved keys were not replaced.');
    }
    let writer, handle;
    try {
      // Older NXI windows may not take this lock. Detect their writes after the
      // native await and again just before committing the atomic OPFS writer.
      await assertSavedKeysUnchanged(dir, name, previousBytes);
      handle = await dir.getFileHandle(name, { create: true });
      writer = await handle.createWritable();
      await writer.write(prepared.bytes);
      // create:true exposes an empty file before its first writer commits.
      // Expect that own placeholder, while still detecting other saved bytes.
      await assertSavedKeysUnchanged(dir, name, previousBytes ?? new Uint8Array());
      await writer.close();
    } catch (error) {
      try { await writer?.abort(); } catch {}
      if (previousBytes === null && handle) {
        // A failed first save must not leave a truncated setup file behind.
        // Never remove a non-empty file another window committed meanwhile.
        try { if (sameBytes(await savedKeyBytes(dir, name), new Uint8Array())) await dir.removeEntry(name); } catch {}
      }
      if (error instanceof SavedKeysChangedError) throw error;
      throw new Error('Keys loaded for this session, but could not be saved. Your previous saved keys were kept. Free some device storage and try again.');
    }
    // Return only safe counts and format metadata, never bytes or raw records.
    const { bytes, hasRsaKeyPair, ...details } = prepared;
    if (!compatibleOnly) return details;
    return { ...details, encoding: incoming.encoding, normalized: !sameBytes(source, prepared.bytes),
      compatibleEntries: incoming.compatibleEntries, incompatibleEntries: incoming.incompatibleEntries,
      retainedEntries, issues: incoming.issues };
  });
}
export async function restoreSetup(api) {
  const report = { restored: [], failed: [] };
  let dir;
  try { dir = await directory(); }
  catch { throw new Error('Saved setup files could not be accessed. Reload Mochi, then open Setup and import your key files again if needed.'); }
  // Do not report native exception text: a parser or storage error may contain
  // private key material. A bad optional file must not prevent the others loading.
  const fail = (name, code, reason) => report.failed.push({
    name, code, message: `Saved ${name} ${reason}. Open Setup and import ${name} again.`
  });
  for (const name of ['prod.keys', 'title.keys', 'console.keys']) {
    let file;
    try {
      file = await (await dir.getFileHandle(name)).getFile();
    } catch (error) {
      if (error?.name !== 'NotFoundError') fail(name, 'read_failed', 'could not be read');
      continue;
    }
    if (file.size < 16 || file.size > 1024 * 1024) {
      fail(name, 'invalid_size', file.size > 1024 * 1024 ? 'exceeds the 1 MiB limit' : 'is empty or truncated');
      continue;
    }
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch { fail(name, 'read_failed', 'could not be read'); continue; }
    try { await (api.RestoreKeys ?? api.ImportKeys)(name, prepareKeyFile(name, bytes).bytes); report.restored.push(name); }
    catch { fail(name, 'import_failed', 'could not be loaded'); }
  }
  return report;
}

const FIRMWARE = 'firmware.json';
const validFirmwareVersion = value => typeof value === 'string' && value.length > 0 && value.length <= 64 && !/[\u0000-\u001f]/.test(value);
const validFirmware = value => value?.version === 1 && /^[a-f0-9]{32}\.zip$/.test(value.id) && Number.isSafeInteger(value.size) && value.size > 0
  && (value.firmwareVersion === undefined || validFirmwareVersion(value.firmwareVersion));
async function readFirmware(dir) {
  try {
    const file = await (await dir.getFileHandle(FIRMWARE)).getFile();
    if (file.size > 4096) throw new Error('Invalid saved firmware record');
    const record = JSON.parse(await file.text());
    if (!validFirmware(record)) throw new Error('Invalid saved firmware record');
    return record;
  } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}
// Every input is normalized to an uncompressed ZIP. Native firmware reads can then seek
// directly into the immutable OPFS package instead of restoring an extracted tree to RAM.
export async function saveFirmware(input, api, { signal, onProgress = () => {} } = {}) {
  signal?.throwIfAborted();
  const plan = await collectFirmware(Array.isArray(input) ? input : [input]);
  const needed = plan.total + plan.ncas.length * 192 + 22;
  const estimate = await navigator.storage.estimate?.();
  if (estimate?.quota && needed > estimate.quota - (estimate.usage || 0)) throw new Error('Not enough device storage for this firmware package.');
  signal?.throwIfAborted();
  const dir = await directory(), root = await navigator.storage.getDirectory();
  const data = await root.getDirectoryHandle('nxi-games', { create: true });
  const previous = await readFirmware(dir);
  const id = crypto.randomUUID().replaceAll('-', '') + '.zip';
  let writer, installed = false, size = 0;
  try {
    writer = await (await data.getFileHandle(id, { create: true })).createWritable();
    size = await writeFirmwareZip(plan, chunk => writer.write(chunk), { signal, onProgress });
    await writer.close(); writer = null;
    const firmwareVersion = await api.InstallStoredFirmware(id); installed = true;
    const record = { version: 1, id, size, firmwareVersion };
    const commit = await (await dir.getFileHandle(FIRMWARE, { create: true })).createWritable();
    try { await commit.write(JSON.stringify(record)); await commit.close(); }
    catch (error) { try { await commit.abort(); } catch {} throw error; }
    if (previous && previous.id !== id) try { await data.removeEntry(previous.id); } catch {}
    navigator.storage.persist?.().catch(() => {});
    return firmwareVersion;
  } catch (error) {
    try { await writer?.abort(); } catch {}
    // The active read-only catalog owns this package after installation. If metadata commit
    // fails, keep it for this session; the previous saved record and package still survive.
    if (!installed) try { await data.removeEntry(id); } catch {}
    if (installed) throw new Error('Firmware is installed for this session, but was not saved. The previous saved setup is preserved. ' + error.message);
    throw error;
  }
}
export async function restoreFirmware(api, report = () => {}) {
  const dir = await directory(), record = await readFirmware(dir);
  if (!record) return null;
  report('Restoring firmware from this device…');
  const data = await (await navigator.storage.getDirectory()).getDirectoryHandle('nxi-games');
  const file = await (await data.getFileHandle(record.id)).getFile();
  if (file.size !== record.size) throw new Error('The saved firmware package changed. Import firmware again.');
  // Older callers could save arbitrary compressed ZIPs. Migrate once, entirely on-device,
  // through the normal verified import + atomic metadata commit. Never delete the old file
  // until the replacement record is durable; interrupted migration is retryable.
  const entries = await zipEntries(file);
  if (entries.some(entry => entry.zip64 || entry.method !== 0 || entry.compressed !== entry.length ||
      (entry.flags & ~0x808) !== 0 || !/^[0-9a-f]{32}(\.cnmt)?\.nca$/.test(entry.name))) {
    report('Preparing saved firmware for direct storage reads…');
    return saveFirmware([file], api);
  }
  // Import already checked and verified this package. Restore installs it and the
  // native side checks the installed version against the saved record. A record
  // from before that version was stored still takes the full check.
  if (validFirmwareVersion(record.firmwareVersion) && api.RestoreStoredFirmware)
    return api.RestoreStoredFirmware(record.id, record.firmwareVersion);
  return api.InstallStoredFirmware(record.id);
}
