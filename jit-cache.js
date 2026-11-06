// Keeps the CPU translation cache in OPFS so games start faster on later launches.
// Restored before the first game runs; saved every minute while playing and when hidden.
const FILE = 'nxi-jit-cache.bin';

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
  const save = async () => {
    if (saving) return; saving = true;
    try {
      const count = await api.JitCacheCount();
      if (count === lastCount) return;
      const bytes = Uint8Array.from(atob(await api.JitCacheExport()), c => c.charCodeAt(0));
      const h = await handle(true); if (!h) return;
      const w = await h.createWritable(); await w.write(bytes); await w.close();
      lastCount = count;
    } catch (e) { console.warn('NXI jit cache save failed: ' + (e.message || e)); }
    finally { saving = false; }
  };
  setInterval(save, 60000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);
  return save;
}
