// Reports stay on the device until the user chooses to share the downloaded file.

// Breadcrumbs: the last steps of this run and of the run before it. If iOS kills the page (Safari
// "A problem repeatedly occurred"), nothing else survives, so the next report shows where it died.
// Earlier runs are kept too (newest first), so an export after reopening still shows the attempt.
const TRAIL = 'nxi-phase-trail', PREVIOUS = 'nxi-previous-run', EARLIER = 'nxi-earlier-runs';
const started = Date.now();
let previousRun = null, earlierRuns = [], trail = [];
try {
  const last = JSON.parse(localStorage.getItem(TRAIL) || '[]');
  earlierRuns = JSON.parse(localStorage.getItem(EARLIER) || '[]');
  if (!Array.isArray(earlierRuns)) earlierRuns = [];
  if (Array.isArray(last) && last.length) {
    const older = JSON.parse(localStorage.getItem(PREVIOUS) || 'null');
    if (Array.isArray(older) && older.length) { earlierRuns.unshift(older); earlierRuns.length = Math.min(earlierRuns.length, 5); localStorage.setItem(EARLIER, JSON.stringify(earlierRuns)); }
    localStorage.setItem(PREVIOUS, JSON.stringify(last));
  }
  previousRun = JSON.parse(localStorage.getItem(PREVIOUS) || 'null');
} catch { /* storage blocked: breadcrumbs are best effort */ }
export function phase(name) {
  const entry = { step: String(name).slice(0, 120), at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10 };
  // Progress lines ("· 4%", "1:05") update in place instead of pushing everything else out.
  const shape = text => text.replace(/\d+/g, '#');
  const last = trail[trail.length - 1];
  if (last && shape(last.step) === shape(entry.step)) {
    if (last.step === entry.step) return;
    trail[trail.length - 1] = { ...entry, firstAt: last.firstAt ?? last.at };
  } else trail.push(entry);
  if (trail.length > 40) trail.splice(0, trail.length - 40);
  try { localStorage.setItem(TRAIL, JSON.stringify(trail)); } catch {}
}
phase('page loaded');

// Keep at most one native status call pending while the loader is busy.
// Loader transitions get their own breadcrumb so long titles cannot hide them.
export function createPlayStatusObserver(api, record = phase) {
  let pending = false, disposed = false, status = '', lastStage = '';
  return {
    get status() { return status; },
    poll() {
      if (pending || disposed) return;
      pending = true;
      Promise.resolve().then(() => api.Status()).then(json => {
        if (disposed) return;
        const value = JSON.parse(json);
        status = String(value.Status ?? '').slice(0, 120);
        const stage = typeof value.loaderStage === 'string' ? value.loaderStage.slice(0, 110) : '';
        if (stage && stage !== lastStage) { lastStage = stage; record('loader: ' + stage); }
      }).catch(() => {}).finally(() => { pending = false; });
    },
    dispose() { disposed = true; },
  };
}

export function createStartupDiagnostics(now = () => performance.now()) {
  const started = now();
  let phase = 'shell', status = 'starting';
  let finished = null;
  const phases = [{ phase, elapsedMs: 0 }];
  return {
    phase(value) {
      phase = value;
      phases.push({ phase, elapsedMs: Math.max(0, Math.round(now() - started)) });
    },
    finish(failed = false) { status = failed ? 'failed' : 'ready'; finished = now(); },
    snapshot() {
      return { status, phase, elapsedMs: Math.max(0, Math.round((finished ?? now()) - started)),
        phases: phases.map(entry => ({ ...entry })) };
    },
  };
}

// Keep a stalled native export or metadata request from blocking the download.
async function bounded(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Diagnostic observation timed out')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function collectDiagnostics(api, startup = null, { timeoutMs = 3000 } = {}) {
  const startupSnapshot = startup?.snapshot() ?? null;
  const results = await Promise.allSettled([
    bounded(() => api.Status(), timeoutMs),
    bounded(() => api.Diagnostics(), timeoutMs),
  ]);
  const report = {
    format: 'nxi-mobile-diagnostics', version: 1, capturedAt: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent, secureContext: globalThis.isSecureContext,
      isolated: globalThis.crossOriginIsolated, webgpu: !!navigator.gpu,
      sharedMemory: typeof SharedArrayBuffer !== 'undefined',
      deviceStorage: !!navigator.storage?.getDirectory, webLocks: !!navigator.locks?.request,
      standalone: globalThis.matchMedia?.('(display-mode: standalone)').matches ?? false },
    device: { memoryGB: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null,
      screen: globalThis.screen ? [screen.width, screen.height, globalThis.devicePixelRatio] : null },
    thisRun: trail.slice(), previousRun, earlierRuns,
    startup: startupSnapshot,
    session: null, core: null, errors: [],
    qualification: { retailGameVerified: false, physicalPhoneVerified: false },
  };
  if (results[0].status === 'fulfilled') {
    try { report.session = JSON.parse(results[0].value); }
    catch { report.errors.push('Session status was not readable.'); }
  } else report.errors.push('Session status was unavailable.');
  if (results[1].status === 'fulfilled') report.core = results[1].value;
  else report.errors.push('Core diagnostics were unavailable.');
  await Promise.all(['precache.json', 'build-info.json'].map(async file => {
    const controller = new AbortController();
    try {
      const value = await bounded(async () => {
        const response = await fetch(new URL('./' + file, import.meta.url), { cache: 'no-store', signal: controller.signal });
        if (response.ok && !response.redirected) return response.json();
      }, timeoutMs);
      if (file === 'precache.json') report.offlineBuild = value?.version ?? null;
      else if (value) report.build = value;
    } catch { /* Metadata is optional, including when offline or starting. */ }
    finally { controller.abort(); }
  }));
  return report;
}

export async function exportDiagnostics(api, startup) {
  const report = await collectDiagnostics(api, startup);
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nx-infinity-mobile-diagnostics-' + report.capturedAt.replace(/[:.]/g, '-') + '.json';
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
}
