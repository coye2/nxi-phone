// Keeps the CPU translation cache in OPFS so games start faster on later launches.
// Restored before the first game runs; saved every minute while playing and when hidden.
const FILE = 'nxi-jit-cache.bin';

// Compatibility with earlier native packages: decode directly into the result
// with a bounded temporary string, never an iterable list of every character.
export function decodeLegacyCache(encoded) {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(encoded.length / 4 * 3 - padding);
  const chunk = 64 * 1024; // Multiple of four, so base64 groups stay intact.
  let offset = 0;
  for (let start = 0; start < encoded.length; start += chunk) {
    const part = atob(encoded.slice(start, start + chunk));
    for (let i = 0; i < part.length; i++) bytes[offset++] = part.charCodeAt(i);
  }
  return bytes;
}

async function handle(create) {
  const root = await navigator.storage?.getDirectory?.();
  return root ? root.getFileHandle(FILE, { create }) : null;
}

export async function restoreJitCache(api) {
  try {
    const h = await handle(false).catch(() => null); if (!h) return 0;
    const bytes = new Uint8Array(await (await h.getFile()).arrayBuffer());
    if (!bytes.length || !(await api.JitCacheImport(bytes))) return 0;
    return bytes.length;
  } catch (e) { console.warn('NXI jit cache restore failed: ' + (e.message || e)); return 0; }
}

export function keepJitCache(api) {
  let saving = false, lastCount = 0;
  let stage = 'idle', startedAt = null, savedBytes = 0;
  const save = async () => {
    if (saving) return; saving = true;
    startedAt = Date.now(); stage = 'count';
    try {
      const count = await api.JitCacheCount();
      if (count === lastCount) { stage = 'unchanged'; return; }
      stage = 'native-export';
      let bytes;
      if (typeof api.JitCacheExportBytes === 'function') {
        bytes = await api.JitCacheExportBytes();
      } else {
        const encoded = await api.JitCacheExport();
        stage = 'decode';
        bytes = decodeLegacyCache(encoded);
      }
      if (!(bytes instanceof Uint8Array)) throw new Error('Invalid CPU cache export.');
      stage = 'storage-open';
      const h = await handle(true); if (!h) { stage = 'storage-unavailable'; return; }
      stage = 'storage-write';
      const w = await h.createWritable(); await w.write(bytes); await w.close();
      lastCount = count; savedBytes = bytes.length; stage = 'saved';
    } catch (e) { stage = 'failed'; console.warn('NXI jit cache save failed: ' + (e.message || e)); }
    finally { saving = false; }
  };
  save.snapshot = () => ({ scope: 'page-local', stage, pending: saving,
    pendingMs: saving ? Math.max(0, Date.now() - startedAt) : null,
    savedEntries: lastCount, savedBytes });
  setInterval(save, 60000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);
  return save;
}
