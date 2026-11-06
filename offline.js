const workerFailures = new WeakMap();
const registrationFailures = new WeakMap();
const failureCodes = new Set(['network-failed', 'unexpected-redirect', 'asset-unavailable', 'asset-size-mismatch', 'asset-hash-mismatch', 'build-mismatch', 'invalid-manifest', 'storage-full', 'storage-unavailable']);
function failureText(detail) {
  return detail.asset ? detail.message + ' File: ' + detail.asset : detail.message;
}
function activationFailure(worker, registration, fallback = 'The NXI offline worker could not install. Reload to retry.') {
  const detail = workerFailures.get(worker) || registrationFailures.get(registration);
  return Object.assign(new Error(detail ? failureText(detail) : fallback), {
    code: detail?.code || 'offline-install-failed', asset: detail?.asset || null, build: detail?.build || null
  });
}

export async function registerOffline(report) {
  const workerUrl = new URL('./sw.js', import.meta.url);
  let registration, latestFailure;
  const onFailure = event => {
    const detail = event.data;
    if (event.source?.scriptURL !== workerUrl.href || detail?.type !== 'nxi-offline-install-error' ||
        !failureCodes.has(detail.code) || typeof detail.message !== 'string' || detail.message.length > 512 ||
        typeof detail.build !== 'string' || detail.build.length > 128 ||
        (detail.asset !== null && (typeof detail.asset !== 'string' || detail.asset.length > 512 || /[\\?#\x00-\x1f\x7f]/.test(detail.asset) || detail.asset.split('/').includes('..')))) return;
    workerFailures.set(event.source, detail);
    latestFailure = detail;
    if (registration) registrationFailures.set(registration, detail);
    report((registration?.active ? 'The update could not be installed; your current build is still available. ' : '') + failureText(detail));
  };
  // A fast installation failure can arrive before register() has resolved.
  navigator.serviceWorker.addEventListener('message', onFailure);
  try { registration = await navigator.serviceWorker.register(workerUrl, { scope: './', updateViaCache: 'none' }); }
  catch (error) { navigator.serviceWorker.removeEventListener('message', onFailure); throw error; }
  if (latestFailure) registrationFailures.set(registration, latestFailure);
  const observe = worker => {
    if (!worker) return;
    const changed = () => {
      if (worker.state === 'installing') report('Preparing this app for offline use… Keep it open until this finishes.');
      if (worker.state === 'installed') report(registration.active
        ? 'Update downloaded. Stop your game, close all NXI tabs, then reopen to use it.'
        : 'Offline download complete. Finishing installation…');
      if (worker.state === 'activated') report('This app is available offline on this device.');
      if (worker.state === 'redundant') report((registration.active ? 'The update could not be installed; your current build is still available. ' : '') + activationFailure(worker, registration).message);
    };
    worker.addEventListener('statechange', changed); changed();
  };
  if (registration.waiting) observe(registration.waiting);
  else if (registration.installing) observe(registration.installing);
  else if (registration.active) report(latestFailure
    ? 'The update could not be installed; your current build is still available. ' + failureText(latestFailure)
    : 'This app is available offline on this device.');
  registration.addEventListener('updatefound', () => observe(registration.installing));
  return registration;
}

// An installed update waits for the old application's tabs to close. Waiting
// for that update here would deadlock startup in the very tab keeping it alive.
// The existing active worker can already supply the isolation headers we need.
export function waitForOfflineActivation(registration) {
  const active = registration.active;
  const worker = active && active.state !== 'redundant'
    ? active : registration.installing || registration.waiting;
  if (!worker) return Promise.reject(activationFailure(null, registration, 'The NXI offline worker is unavailable. Reload to retry.'));
  return new Promise((resolve, reject) => {
    const changed = () => {
      if (worker.state !== 'activated' && worker.state !== 'redundant') return;
      worker.removeEventListener('statechange', changed);
      if (worker.state === 'activated') resolve();
      else reject(activationFailure(worker, registration));
    };
    worker.addEventListener('statechange', changed);
    changed();
  });
}
