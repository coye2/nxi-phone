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
const STAGE = /^[a-z][a-z0-9_.-]{0,63}$/;
const RELOAD_REASON = /^[a-z][a-z0-9-]{0,40}$/;
const APP_RELOAD = 'nxi-app-reload';
const NAV_TYPES = new Set(['navigate', 'reload', 'back_forward', 'prerender']);

export function phase(name, distinct = false) {
  const entry = { step: String(name).slice(0, 180), at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10 };
  // Progress lines ("· 4%", "1:05") update in place instead of pushing everything else out.
  // Launch boundaries stay distinct: their counters change, and collapsing them hides the last completed stage.
  const shape = text => text.replace(/\d+/g, '#');
  const last = trail[trail.length - 1];
  if (!distinct && last && shape(last.step) === shape(entry.step)) {
    if (last.step === entry.step) return;
    trail[trail.length - 1] = { ...entry, firstAt: last.firstAt ?? last.at };
  } else trail.push(entry);
  if (trail.length > 80) trail.splice(0, trail.length - 80);
  try { localStorage.setItem(TRAIL, JSON.stringify(trail)); } catch {}
}

// Navigation Timing classifies the load. It does not say which code requested it.
// https://www.w3.org/TR/navigation-timing-2/#dom-performancenavigationtiming-type
export function describeReopen(hadPreviousRun, markerReason, navigationType) {
  if (!hadPreviousRun) return null;
  const reason = typeof markerReason === 'string' && RELOAD_REASON.test(markerReason) ? markerReason : '';
  const nav = NAV_TYPES.has(navigationType) ? navigationType : 'unknown';
  return reason ? `reopen after app reload: ${reason}` : `reopen without app reload marker (${nav})`;
}

export function noteAppReload(reason) {
  const token = typeof reason === 'string' && RELOAD_REASON.test(reason) ? reason : 'unspecified';
  try { localStorage.setItem(APP_RELOAD, JSON.stringify({ reason: token, at: new Date().toISOString() })); } catch {}
  phase('app reload requested: ' + token, true);
}

function navigationType() {
  try {
    const type = performance.getEntriesByType('navigation')[0]?.type;
    return NAV_TYPES.has(type) ? type : 'unknown';
  } catch { return 'unknown'; }
}

function consumeAppReload() {
  try {
    const raw = localStorage.getItem(APP_RELOAD);
    localStorage.removeItem(APP_RELOAD);
    const reason = raw ? JSON.parse(raw)?.reason : '';
    return typeof reason === 'string' && RELOAD_REASON.test(reason) ? reason : '';
  } catch { return ''; }
}

// Written before the work for that stage. localStorage can survive a reload; it cannot
// survive a kill that happens inside this call. Counters are addressable sizes and
// worker counts, not resident memory or a jetsam limit.
export function recordBoundary(stage, managedBytes, poolThreads, queuedWork) {
  if (typeof stage !== 'string' || !STAGE.test(stage)) return false;
  const managed = Number.isFinite(managedBytes) && managedBytes >= 0 ? Math.round(managedBytes) : -1;
  const pool = Number.isSafeInteger(poolThreads) && poolThreads >= 0 && poolThreads <= 100000 ? poolThreads : -1;
  const queued = Number.isSafeInteger(queuedWork) && queuedWork >= 0 && queuedWork <= 1000000 ? queuedWork : -1;
  let running = -1, idle = -1, linear = -1;
  try {
    const threads = globalThis.getDotnetRuntime?.(0)?.Module?.PThread;
    if (threads) {
      running = threads.runningWorkers?.length ?? -1;
      idle = threads.unusedWorkers?.length ?? -1;
    }
  } catch { /* pthread metadata is optional */ }
  try { linear = globalThis.nxiWasmMemory?.buffer?.byteLength ?? -1; } catch { linear = -1; }
  phase(`boundary ${stage}: linear ${linear} managed ${managed} pool ${pool} queued ${queued} threads ${running}+${idle}`, true);
  return true;
}

// Layout matches BrowserLaunchSlot. The interval copies a finished (even) sequence
// without calling Status(), which stays queued behind Play.
export function drainBoundary(memory, address, lastSequence) {
  if (!memory || !Number.isSafeInteger(address) || address <= 0 || address % 4 !== 0 || !Number.isSafeInteger(lastSequence)) return lastSequence;
  let buffer;
  try { buffer = memory.buffer; } catch { return lastSequence; }
  if (address > buffer.byteLength - 88) return lastSequence;
  let start;
  try {
    const view = new DataView(buffer, address, 88);
    const sequence = new Int32Array(buffer, address, 1);
    start = Atomics.load(sequence, 0);
    if (start === lastSequence || start <= 0 || (start & 1) !== 0) return lastSequence;
    const length = view.getInt32(4, true);
    if (length < 1 || length > 64) return lastSequence;
    // Browser TextDecoder rejects SharedArrayBuffer-backed views (Node accepts
    // them). Copy the bounded stage bytes before decoding, then recheck sequence.
    const stage = new TextDecoder().decode(new Uint8Array(buffer, address + 8, length).slice());
    const managed = Number(view.getBigInt64(72, true));
    const pool = view.getInt32(80, true);
    const queued = view.getInt32(84, true);
    if (Atomics.load(sequence, 0) !== start) return lastSequence;
    recordBoundary(stage, managed, pool, queued);
  } catch { return lastSequence; }
  return start;
}

export function formatPlaySample({ seconds, running, idle, linearBytes, pendingMs, sampleAgeMs, status }) {
  const pending = pendingMs === null || pendingMs === undefined ? 'none' : String(Math.max(0, Math.round(pendingMs)));
  const sample = sampleAgeMs === null || sampleAgeMs === undefined ? 'none' : String(Math.max(0, Math.round(sampleAgeMs)));
  const linear = Number.isFinite(linearBytes) && linearBytes >= 0 ? Math.round(linearBytes / 1048576) : 0;
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  return `playing ${safeSeconds.toFixed(1)} s: threads ${running ?? '?'} (+${idle ?? '?'} idle), linear buffer ${linear} MiB, status pending ${pending} ms, sample ${sample} ms, ${String(status ?? '').slice(0, 120)}`;
}

phase('page loaded');
const reopen = describeReopen(Array.isArray(previousRun) && previousRun.length > 0, consumeAppReload(), navigationType());
if (reopen) phase(reopen, true);
try {
  addEventListener('pagehide', () => { try { globalThis.nxiDrainBoundary?.(); } catch {} phase('pagehide', true); });
  addEventListener('freeze', () => phase('page freeze', true));
} catch { /* not a document */ }

// Keep at most one native status call pending while the loader is busy.
// Loader transitions get their own breadcrumb so long titles cannot hide them.
export function createPlayStatusObserver(api, record = phase, now = () => performance.now()) {
  let pending = false, disposed = false, status = '', lastStage = '';
  let pendingAt = null, sampledAt = null, lastOperation = '', lastHealth = -1;
  let lastSequence = 0;
  return {
    get status() { return status; },
    get health() { return { pendingMs: pendingAt === null ? null : Math.max(0, Math.round(now() - pendingAt)), sampleAgeMs: sampledAt === null ? null : Math.max(0, Math.round(now() - sampledAt)) }; },
    poll() {
      if (disposed) return;
      if (pending) {
        const bucket = Math.floor((now() - pendingAt) / 2000);
        if (bucket > 0 && bucket !== lastHealth) { lastHealth = bucket; record('status observation pending ' + bucket * 2 + ' s'); }
        return;
      }
      pending = true; pendingAt = now(); lastHealth = -1;
      Promise.resolve().then(() => api.Status()).then(json => {
        if (disposed) return;
        const value = JSON.parse(json);
        sampledAt = now();
        for (const entry of (Array.isArray(value.prerequisiteTrace) ? value.prerequisiteTrace.slice(-48) : [])) {
          if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= lastSequence || !Number.isSafeInteger(entry.launchGeneration) || entry.launchGeneration !== value.launchGeneration || typeof entry.completed !== 'boolean' || typeof entry.stage !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(entry.stage)) continue;
          lastSequence = entry.sequence;
          record(`prerequisite: ${entry.stage} ${entry.completed ? 'complete' : 'begin'}`);
        }
        const operation = typeof value.operationStage === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(value.operationStage) ? value.operationStage : '';
        if (operation && operation !== lastOperation) { lastOperation = operation; record('operation: ' + operation); }
        status = String(value.Status ?? '').slice(0, 120);
        const stage = typeof value.loaderStage === 'string' ? value.loaderStage.slice(0, 110) : '';
        if (stage && stage !== lastStage) { lastStage = stage; record('loader: ' + stage); }
      }).catch(() => {}).finally(() => { pending = false; pendingAt = null; });
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
    bounded(() => api?.ExecutionDiagnostics?.() ?? null, timeoutMs),
    bounded(() => globalThis.nxiReadGpuMemory?.() ?? null, timeoutMs),
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
    session: null, core: null, execution: null, cpuMailboxes: null, gpuRing: null, gpuWorker: null,
    errors: [], offlineBuild: null, availableOfflineBuild: null,
    qualification: { retailGameVerified: false, physicalPhoneVerified: false },
  };
  if (results[0].status === 'fulfilled') {
    try { report.session = JSON.parse(results[0].value); }
    catch { report.errors.push('Session status was not readable.'); }
  } else report.errors.push('Session status was unavailable.');
  if (results[1].status === 'fulfilled') report.core = results[1].value;
  else report.errors.push('Core diagnostics were unavailable.');
  if (results[2].status === 'fulfilled') {
    if (results[2].value !== null) {
      try {report.execution = JSON.parse(results[2].value);}
      catch {report.errors.push('Execution diagnostics were not readable.');}
    }
  } else report.errors.push('Execution diagnostics were unavailable.');
  try {report.gpuRing = globalThis.nxiReadGpuRing?.() ?? null;} catch {}
  try {report.cpuMailboxes = globalThis.nxiReadCpuMailboxes?.() ?? null;} catch {}
  if(results[3].status === 'fulfilled')report.gpuWorker=results[3].value;
  else report.errors.push('GPU worker diagnostics were unavailable.');
  await Promise.all(['precache.json', 'build-info.json'].map(async file => {
    const controller = new AbortController();
    try {
      const value = await bounded(async () => {
        const response = await fetch(new URL('./' + file, import.meta.url), { cache: 'no-store', signal: controller.signal });
        if (response.ok && !response.redirected) {
          if (file === 'build-info.json') {
            const pinnedBuild = response.headers?.get('X-NXI-Asset-Build');
            if (typeof pinnedBuild === 'string' && /^[a-f0-9]{16}$/.test(pinnedBuild)) report.offlineBuild = pinnedBuild;
          }
          return response.json();
        }
      }, timeoutMs);
      if (file === 'precache.json') report.availableOfflineBuild = value?.version ?? null;
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
