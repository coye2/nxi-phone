// Staging replaces BUILD with a content-derived version. Never mix running builds.
const BUILD = 'beb86aa7cde84380';
const PREFIX = 'nxi-browser-launcher-';
const CACHE = PREFIX + BUILD;
const scope = new URL('./', self.location.href);
function installFailure(code, message, url) {
  let asset = null;
  if (url) {
    const path = new URL(url, scope);
    if (path.origin === scope.origin && path.pathname.startsWith(scope.pathname)) {
      const relative = path.pathname.slice(scope.pathname.length);
      if (relative && relative.length <= 512 && !/[\x00-\x1f\x7f]/.test(relative)) asset = relative;
    }
  }
  return Object.assign(Error(message), { nxiOfflineFailure: true, code, asset });
}
function storageFailure(error, url) {
  if (error?.nxiOfflineFailure) return error;
  return error?.name === 'QuotaExceededError'
    ? installFailure('storage-full', 'Not enough device storage to prepare NXI offline. Free some space and reload.', url)
    : installFailure('storage-unavailable', 'NXI could not save an app file for offline use. Check browser storage access and reload.', url);
}
async function reportInstallFailure(error) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const detail = { type: 'nxi-offline-install-error', build: BUILD, code: error.code, asset: error.asset, message: error.message };
    for (const client of clients) {
      const url = new URL(client.url);
      if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
        try { client.postMessage(detail); } catch {}
      }
    }
  } catch { /* Reporting must not replace the original installation failure. */ }
}
function assetUrl(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.split('/').some(p => p === '..')) throw installFailure('invalid-manifest', 'Invalid offline asset path.');
  const url = new URL(path, scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || url.search || url.hash) throw installFailure('invalid-manifest', 'Invalid offline asset URL.');
  return url;
}
async function responseFor(url) {
  const requested = new URL(url);
  // Static hosts canonicalize /launcher/index.html to /launcher/. Request that
  // URL directly, then verify and cache its bytes under the manifest's index key.
  const fetchUrl = requested.href === new URL('index.html', scope).href ? scope : requested;
  let response;
  try { response = await fetch(fetchUrl, { cache: 'reload' }); }
  catch { throw installFailure('network-failed', 'An app file could not be downloaded. Check your connection and reload.', requested); }
  const finalUrl = response.url ? new URL(response.url) : fetchUrl;
  if (response.redirected || response.type === 'opaque' || finalUrl.origin !== scope.origin || !finalUrl.pathname.startsWith(scope.pathname))
    throw installFailure('unexpected-redirect', 'Offline asset unavailable: an app file was redirected instead of downloaded. Open NXI online and sign in again if prompted.', requested);
  if (!response.ok) throw installFailure('asset-unavailable', 'Offline asset unavailable (HTTP ' + response.status + '). Reload NXI online to retry.', requested);
  return response;
}
async function verifiedResponse(response, asset) {
  let bytes;
  try { bytes = await response.arrayBuffer(); }
  catch { throw installFailure('network-failed', 'An app file download was interrupted. Check your connection and reload.', asset.url); }
  if (bytes.byteLength !== asset.size) throw installFailure('asset-size-mismatch', 'Offline asset size changed. Reload NXI online to get a consistent build.', asset.url);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw installFailure('asset-hash-mismatch', 'Offline asset changed during download. Reload NXI online to get a consistent build.', asset.url);
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}
self.addEventListener('install', event => event.waitUntil((async () => {
  let existed = false;
  try {
    existed = await caches.has(CACHE);
    const manifestResponse = await responseFor(new URL('precache.json', scope));
    let manifest;
    try { manifest = await manifestResponse.json(); }
    catch { throw installFailure('invalid-manifest', 'The offline app list is invalid. Open NXI online and reload.', new URL('precache.json', scope)); }
    if (!manifest || manifest.version !== BUILD || !Array.isArray(manifest.files) || manifest.files.length > 10000 ||
        !['index.html','main.js', 'jit-cache.js','_framework/dotnet.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'].every(f => manifest.files.includes(f))) throw installFailure('build-mismatch', 'Offline manifest does not match this build. Close NXI tabs and reopen online to retry.');
    const assets = [...new Set(manifest.files)].map(file => {
      const url = assetUrl(file), expected = manifest.assets?.[file];
      if (!expected || !Number.isSafeInteger(expected.size) || expected.size < 0 ||
          typeof expected.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw installFailure('invalid-manifest', 'Offline manifest has no valid asset integrity.', url);
      return { url, size: expected.size, sha256: expected.sha256 };
    });
    const cache = await caches.open(CACHE);
    const download = async batch => {
      // Settle every write before cleanup after a failed download.
      const results = await Promise.allSettled(batch.map(async asset => {
        try {
          const cached = await cache.match(asset.url);
          if (cached) {
            try { await verifiedResponse(cached, asset); return; } catch { /* Retry an incomplete cache entry from the network. */ }
          }
          await cache.put(asset.url, await verifiedResponse(await responseFor(asset.url), asset));
        } catch (error) { throw storageFailure(error, asset.url); }
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    };
    // Hash small assets in bounded groups. Large WASM files run one at a time
    // so their verification buffers do not pile up on memory-limited phones.
    let batch = [], bytes = 0;
    for (const asset of assets) {
      if (batch.length && (batch.length >= 6 || bytes + asset.size > 8 * 1024 * 1024)) {
        await download(batch); batch = []; bytes = 0;
      }
      batch.push(asset); bytes += asset.size;
    }
    if (batch.length) await download(batch);
    // No skipWaiting: an update must not replace a playing tab's runtime/worker.
  } catch (error) {
    const failure = storageFailure(error);
    await reportInstallFailure(failure);
    if (!existed) try { await caches.delete(CACHE); } catch {}
    throw failure;
  }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let response = await cache.match(request, { ignoreSearch: true });
    if (!response && request.mode === 'navigate') response = await cache.match(new URL('index.html', scope));
    // Cached app assets stay pinned to this build, even while an update downloads.
    response ??= await fetch(request);
    if (response.type === 'opaque' || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  })());
});
