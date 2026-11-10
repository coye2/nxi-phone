import { restoreDeviceState, saveDeviceState } from './device-state.js';
import { registerOffline, waitForOfflineActivation } from './offline.js';
import { initializeMobileShell, reportMobileStatus, startMobile } from './mobile.js';
import { GpuPresentation } from './gpu-presentation.js';
import { startInput } from './input.js';
import { importToLibrary, restoreLibrary } from './library.js';
import { restoreJitCache, keepJitCache } from './jit-cache.js';
import { restoreSetup, saveKeys, saveFirmware, restoreFirmware } from './setup.js';
import { startAudio } from './audio.js';
import { startSessionView } from './session-view.js';
import { exportDiagnostics, phase, noteAppReload, recordBoundary, drainBoundary, formatPlaySample, createStartupDiagnostics, createPlayStatusObserver } from './diagnostics.js';
import { configureRuntimeDelivery } from './runtime-delivery.js';
import { readCpuMailboxDiagnostics, MAX_CPU_MAILBOX_SAMPLES } from './cpu-mailbox-diagnostics.js';

globalThis.nxiRecordBoundary = recordBoundary;

const message = document.getElementById('message');
initializeMobileShell();
// Safari answers every on-device storage call this way in Private Browsing.
const explain = text => /unknown transient reason/i.test(text)
  ? 'This browser blocked on-device storage, so NXI can\'t keep games here. Private Browsing does this: open NXI in a normal tab or from your Home Screen. (' + text + ')'
  : text;
const tell = text => { text = explain(text); phase(text); message.textContent = text; reportMobileStatus(text); console.log('NXI-UI ' + text); };
let activeApi = null;
const startup = createStartupDiagnostics();
const diagnostics = document.getElementById('export-diagnostics');
const gameDiagnostics = document.getElementById('game-diagnostics');
diagnostics.disabled = gameDiagnostics.disabled = false;
diagnostics.onclick = gameDiagnostics.onclick = async () => {
  diagnostics.disabled = gameDiagnostics.disabled = true;
  try { await exportDiagnostics(activeApi, startup); }
  catch (error) {
    const failure = 'Diagnostics could not be exported: ' + error.message;
    document.getElementById('setup-message').textContent = failure;
    document.getElementById('game-diagnostics-message').textContent = failure;
  }
  finally { diagnostics.disabled = gameDiagnostics.disabled = false; }
};
// Setup and diagnostics must remain reachable when the runtime cannot start.
const setupDialog = document.getElementById('setup-dialog');
for (const id of ['setup', 'mobile-setup']) {
  const control = document.getElementById(id);
  control.disabled = false; control.onclick = () => setupDialog.showModal();
}
for (const id of ['choose-keys', 'choose-firmware', 'choose-firmware-folder', 'classic-mode']) document.getElementById(id).disabled = true;
const NativeMemory = WebAssembly.Memory;
const CapturedMemory = function (descriptor) {
  const memory = new NativeMemory(descriptor);
  if (descriptor?.shared && !globalThis.nxiWasmMemory) globalThis.nxiWasmMemory = memory;
  return memory;
};
CapturedMemory.prototype = NativeMemory.prototype;
WebAssembly.Memory = CapturedMemory;
const cpuWorkers = [];
const cpuMailboxRecords = [];
let playAttempt = 0, playPending = false;
globalThis.nxiReadCpuMailboxes = () => ({
  ...readCpuMailboxDiagnostics(globalThis.nxiWasmMemory, cpuMailboxRecords, {totalWorkersCreated:cpuWorkers.length}),
  capturePlayAttempt:playAttempt, nativePlayPromisePending:playPending
});
globalThis.nxiSpawnCpuWorker = mailbox => {
  const worker = new Worker(new URL('./nxi-cpu-worker.js', import.meta.url), { name: 'NXI CPU' });
  cpuWorkers.push(worker);
  cpuMailboxRecords.push({address:mailbox,workerId:cpuWorkers.length,birthPlayAttempt:playAttempt});
  if(cpuMailboxRecords.length>MAX_CPU_MAILBOX_SAMPLES)cpuMailboxRecords.shift();
  worker.onerror = e => tell('CPU worker failed: ' + e.message);
  worker.postMessage({ memory: globalThis.nxiWasmMemory, mailbox });
};
let ioWorker, storageReady;
globalThis.nxiWorkerCounters = () => ({ cpuWorkersCreated: cpuWorkers.length, storageWorkerCreated: ioWorker ? 1 : 0 });
globalThis.nxiStartIoWorker = mailbox => {
  storageReady = new Promise((resolve, reject) => {
    const fail = message => {
      Atomics.store(new Int32Array(globalThis.nxiWasmMemory.buffer), mailbox >>> 2, 3);
      ioWorker?.terminate(); reject(new Error(message)); tell(message);
      ioWorker = null;
    };
    ioWorker = new Worker(new URL('./nxi-io-worker.js', import.meta.url), { name: 'NXI storage' });
    const timer = setTimeout(() => fail('Local storage did not start. Reload NXI to retry.'), 10000);
    ioWorker.onerror = e => { clearTimeout(timer); fail('Storage worker failed: ' + e.message); };
    ioWorker.onmessage = ({ data }) => {
      if (data.type === 'ready') { clearTimeout(timer); resolve(); }
      if (data.type === 'error') { clearTimeout(timer); fail('Storage worker failed: ' + data.message); }
    };
    ioWorker.postMessage({ memory: globalThis.nxiWasmMemory, mailbox });
  });
  storageReady.catch(() => {});
};
globalThis.nxiSetFullScreen = on => {
  const task = on ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.();
  task?.catch(() => {});
};

try {
  startup.phase('offline-installation');
  // The offline worker also supplies isolation on hosts without COOP/COEP headers.
  let registration, offlineError;
  const offlineStatus = text => {
    document.getElementById('offline-message').textContent = text;
    if (!activeApi) tell(text);
  };
  if (isSecureContext && 'serviceWorker' in navigator) {
    try { registration = await registerOffline(offlineStatus); }
    catch (error) { offlineError = error; offlineStatus('Offline installation unavailable: ' + error.message); }
  } else offlineStatus(isSecureContext
    ? 'Offline installation is not supported by this browser.'
    : 'Offline installation requires HTTPS. Open NXI from its secure site address.');
  if (!crossOriginIsolated && !registration && offlineError) throw offlineError;
  if (!crossOriginIsolated && registration) {
    // Use this registration's active build even when a newer update is waiting.
    startup.phase('isolation');
    await waitForOfflineActivation(registration);
    if (!sessionStorage.getItem('nxi-launcher-isolation-reload')) {
      sessionStorage.setItem('nxi-launcher-isolation-reload', '1');
      noteAppReload('isolation');
      location.reload();
      await new Promise(() => {});
    }
  }
  if (!crossOriginIsolated) throw new Error(isSecureContext
    ? 'NXI needs cross-origin isolation for its CPU threads. Reload after the site has installed.'
    : 'Open NXI using its HTTPS address. This browser cannot start CPU threads on an insecure page.');
  sessionStorage.removeItem('nxi-launcher-isolation-reload');
  if (new URLSearchParams(location.search).has('memtest')) {
    // Phone memory probe instead of NXI; see memtest.js.
    const { runMemoryTest } = await import('./memtest.js');
    try { await runMemoryTest(tell); } catch (error) { tell('memtest failed: ' + error.message); }
    await new Promise(() => {});
  }
  tell('Starting NX Infinity…');
  // Starting can take a minute on a phone; show it is still working.
  const startedAt = Date.now();
  const startTicker = setInterval(() => {
    if (message.textContent.startsWith('Starting NX Infinity'))
      tell(`Starting NX Infinity… ${Math.round((Date.now() - startedAt) / 1000)} s (phones can take a minute)`);
  }, 5000);
  // Launcher UI drawing: software on iPhone/iPad (the WebGL path crashed a real iPhone at startup),
  // Avalonia's default elsewhere. ?render=gl or ?render=software overrides it for testing.
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const uiRender = new URLSearchParams(location.search).get('render') ?? (iOS ? 'software' : 'gl');
  phase('loading runtime (ui ' + uiRender + ')');
  // Startup watchdog: on WebKit the .NET runtime very occasionally never finishes starting (a
  // completion between its threads is lost). If a startup step stalls, reload; at most twice.
  const STALLS = 'nxi-startup-stalls';
  let stallTimer = 0;
  const watchStartup = step => {
    clearTimeout(stallTimer);
    if (!step) { try { sessionStorage.removeItem(STALLS); } catch {} return; }
    stallTimer = setTimeout(() => {
      let stalls = 0; try { stalls = +(sessionStorage.getItem(STALLS) ?? 0); } catch {}
      if (stalls >= 2) { tell('NX Infinity is taking unusually long to start. Close it fully and open it again.'); return; }
      try { sessionStorage.setItem(STALLS, String(stalls + 1)); } catch {}
      noteAppReload('startup-stall'); phase('startup stalled at ' + step + ', reloading'); location.reload();
    }, 25000);
  };
  watchStartup('loading runtime');
  startup.phase('runtime-module');
  const { dotnet } = await import('./_framework/dotnet.js');
  startup.phase('runtime-delivery');
  const runtimeBuilder = await configureRuntimeDelivery(dotnet);
  const dumpShaders = new URLSearchParams(location.search).has('dumpShaders');
  // Fewer, larger minor GCs. Each GC has to stop ~50 threads, and the multithreaded WebAssembly
  // runtime sometimes never gets the finalizer thread to stop (the page freezes or aborts with
  // mono-threads.c:336). A bigger nursery makes that race much rarer.
  startup.phase('runtime-create');
  const runtime = await runtimeBuilder.withEnvironmentVariable('MONO_GC_PARAMS', 'nursery-size=32m').withEnvironmentVariable('NXI_RENDER', uiRender).withEnvironmentVariable('NXI_DUMP_SHADERS', dumpShaders ? '1' : '0').withConfig({ pthreadPoolInitialSize: 8, jsThreadBlockingMode: 'DangerousAllowBlockingWait' }).create();
  clearInterval(startTicker); phase('runtime created'); watchStartup('runtime created');
  startup.phase('runtime-exports');
  const api = (await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).NxInfinity.BrowserLauncher;
  activeApi = api;
  startup.phase('device-restore');
  let restoreWarning = null;
  try { await restoreDeviceState(api, tell); }
  catch (error) { restoreWarning = 'Saved data could not be restored: ' + error.message; }
  phase('runtime main starting');
  startup.phase('runtime-main');
  await runtime.runMain();
  phase('runtime main started'); watchStartup(null);
  let boundaryAddress = 0, boundarySequence = 0;
  const copyBoundary = () => { boundarySequence = drainBoundary(globalThis.nxiWasmMemory, boundaryAddress, boundarySequence); };
  globalThis.nxiDrainBoundary = copyBoundary;
  try { const slot = await api.BoundarySlot(); if (Number.isSafeInteger(slot) && slot > 0) boundaryAddress = slot; }
  catch { boundaryAddress = 0; }
  globalThis.nxi = { runtime, api, saveDeviceState: () => saveDeviceState(api, { force: true, report: tell }) };
  // Firmware is restored on first Play instead of at startup: unpacking it takes a few hundred MB,
  // and on an iPhone startup plus restore could go past the page memory limit. Safari then reloads
  // and the restore runs again ("A problem repeatedly occurred"). The marker catches that.
  const FIRMWARE_PENDING = 'nxi-firmware-restore-pending';
  let firmwareRestored = false, firmwareBlocked = false;
  async function ensureFirmware() {
    if (firmwareRestored || firmwareBlocked) return;
    firmwareRestored = true; phase('restoring firmware for Play');
    try { localStorage.setItem(FIRMWARE_PENDING, String(Date.now())); } catch {}
    try { const version = await restoreFirmware(api, tell); if (version) document.getElementById('setup-message').textContent = `Firmware ${version} restored from this device.`; }
    catch (error) { document.getElementById('setup-message').textContent = 'Saved firmware could not be restored. Open Setup and import the firmware again.'; }
    finally { try { localStorage.removeItem(FIRMWARE_PENDING); } catch {} phase('firmware restore finished'); }
  }
  // After Play, log threads and runtime memory every 250 ms (one breadcrumb, updated in place):
  // if the phone kills the page, the last values before it died are in the diagnostics.
  const pthreads = () => { try { return globalThis.getDotnetRuntime(0).Module.PThread; } catch { return null; } };
  let playWatch = 0, playObserver;
  const watchPlay = () => {
    clearInterval(playWatch); playObserver?.dispose(); const started = Date.now();
    const observer = playObserver = createPlayStatusObserver(api);
    const timer = playWatch = setInterval(() => {
      const P = pthreads(), seconds = (Date.now() - started) / 1000;
      copyBoundary();
      observer.poll();
      const health = observer.health;
      let linearBytes = 0;
      try { linearBytes = globalThis.nxiWasmMemory?.buffer?.byteLength ?? 0; } catch { linearBytes = 0; }
      phase(formatPlaySample({
        seconds, running: P?.runningWorkers?.length, idle: P?.unusedWorkers?.length, linearBytes,
        pendingMs: health.pendingMs, sampleAgeMs: health.sampleAgeMs, status: observer.status,
      }));
      // Native first-frame timeout starts after loading and lasts two minutes.
      // Keep the trail through that outcome, while bounding a hung native call.
      if (seconds > 180) stop();
    }, 250);
    const stop = () => { clearInterval(timer); observer.dispose(); copyBoundary(); };
    return stop;
  };
  const playApi = new Proxy(api, { get: (target, key) => key === 'Play' ? async id => {
    await ensureFirmware(); const attempt = ++playAttempt; playPending = true;
    phase('Play pressed'); const stopWatching = watchPlay();
    try { const r = await target.Play(id); phase('Play started'); return r; }
    catch (error) { phase('Play failed before the guest started', true); throw error; }
    finally { if(attempt===playAttempt)playPending=false; stopWatching(); }
  } : target[key] });
  globalThis.nxi.api = playApi;
  const mobile = startMobile(playApi);
  startInput(api, document.getElementById('game'));
  startAudio(api, globalThis.nxiWasmMemory);
  // CPU translations from earlier launches (must load before the first game translates code).
  // (restored after the GPU worker is up: a big cache keeps the main thread busy for a while)
  let jitRestore = Promise.resolve(0);
  globalThis.nxi.saveJitCache = keepJitCache(api);
  const button = document.getElementById('import'), picker = document.getElementById('file');
  startup.phase('storage');
  await api.PrepareStorage(); await storageReady;
  startup.phase('setup-restore');
  const setupWarnings = restoreWarning ? [restoreWarning] : [];
  try {
    const restoredSetup = await restoreSetup(api);
    setupWarnings.push(...restoredSetup.failed.map(item => item.message));
  } catch (error) { setupWarnings.push(error.message); }
  // A restore that never finished means the page was killed during it (iPhone memory).
  try {
    if (localStorage.getItem(FIRMWARE_PENDING)) {
      firmwareBlocked = true; localStorage.removeItem(FIRMWARE_PENDING);
      setupWarnings.push('NXI closed while restoring your firmware last time, most likely because the phone ran out of memory. It was not restored this time, so homebrew still works. Open Setup and import the firmware again to retry.');
    }
  } catch {}
  startup.phase('library-restore');
  const restored = await restoreLibrary(api, count => tell(`Restoring library · ${count} games`));
  // Restored metadata is visible before OPFS streams are registered. Refresh now
  // so the first tap uses Play rather than a stale "review this file" action.
  await mobile.refresh(true);
  if (setupWarnings.length) document.getElementById('setup-message').textContent = setupWarnings.join(' ');
  tell('Preparing graphics and game cache…');
  button.onclick = () => { clearKeyRecovery(); picker.click(); };
  const cancel = document.getElementById('cancel-import');
  const keys = document.getElementById('keys'), keyButton = document.getElementById('choose-keys');
  const firmware = document.getElementById('firmware'), firmwareButton = document.getElementById('choose-firmware');
  const recoveryDetails = document.getElementById('key-recovery-details');
  const recoveryButton = document.getElementById('import-compatible-keys');
  const recoveryCancel = document.getElementById('cancel-key-recovery');
  const recoveryIssues = document.getElementById('key-recovery-issues');
  const recoverySummary = document.getElementById('key-recovery-summary');
  const recoveryLines = document.getElementById('key-recovery-lines');
  const importControls = [button, keyButton, firmwareButton, document.getElementById('choose-firmware-folder')];
  let importing, pendingKeyFile = null, recoveryGeneration = 0;
  function clearKeyRecovery() {
    pendingKeyFile = null; recoveryGeneration++;
    recoveryDetails.hidden = true; recoveryDetails.textContent = '';
    recoveryButton.hidden = true; recoveryButton.disabled = true;
    recoveryCancel.hidden = true; recoveryCancel.disabled = true;
    recoveryIssues.hidden = true; recoveryIssues.open = false;
    recoverySummary.textContent = ''; recoveryLines.textContent = '';
  }
  function updateRecoveryControls() {
    recoveryButton.disabled = !pendingKeyFile || !!importing || button.disabled || !document.getElementById('game').hidden;
    recoveryCancel.disabled = !pendingKeyFile || !!importing;
  }
  function offerKeyRecovery(file, error) {
    // Only safe format metadata crosses into the DOM. The original File stays
    // in this closure until the user chooses recovery or dismisses the review.
    pendingKeyFile = file;
    const details = error.issues.slice(0, 100).map(issue =>
      `Line ${issue.line}${issue.key ? ` (${issue.key})` : ''}: ${issue.actualDigits} hex digits; expected ${issue.expectedDigits}.`);
    const remaining = error.issues.length - details.length;
    document.getElementById('setup-message').textContent =
      `${error.compatibleEntries} ${error.compatibleEntries === 1 ? 'entry can' : 'entries can'} be imported. ` +
      `${error.incompatibleEntries} incompatible ${error.incompatibleEntries === 1 ? 'entry' : 'entries'} will be skipped.`;
    recoveryDetails.textContent = 'Import updates matching saved entries and keeps the rest. Your file stays unchanged.';
    recoverySummary.textContent = `Review ${error.incompatibleEntries} incompatible ${error.incompatibleEntries === 1 ? 'entry' : 'entries'}`;
    recoveryLines.textContent = details.join('\n') + (remaining > 0 ? `\n${remaining} more incompatible entries.` : '');
    recoveryIssues.open = false; recoveryIssues.hidden = false;
    recoveryDetails.hidden = false; recoveryButton.hidden = false; recoveryCancel.hidden = false;
    updateRecoveryControls();
  }
  setupDialog.addEventListener('close', clearKeyRecovery);
  setupDialog.addEventListener('cancel', clearKeyRecovery);
  recoveryCancel.onclick = () => {
    if (!pendingKeyFile) return;
    clearKeyRecovery();
    document.getElementById('setup-message').textContent = 'No keys were imported. Your saved keys were not replaced.';
  };
  function beginImport(control, operation) {
    // File chooser events can arrive after a different chooser or game starts.
    // The Add gate also keeps setup imports behind GPU and CPU-cache startup.
    if (importing || button.disabled || control.disabled || !document.getElementById('game').hidden) return null;
    const disabled = importControls.map(control => control.disabled);
    clearKeyRecovery();
    importing = operation;
    for (const control of importControls) control.disabled = true;
    return () => {
      if (importing !== operation) return;
      importing = null;
      importControls.forEach((control, index) => { control.disabled = disabled[index]; });
      updateRecoveryControls();
    };
  }
  cancel.onclick = () => {
    if (!importing?.cancellable) return;
    importing.userCancelled = true; importing.cancellable = false;
    cancel.disabled = true; importing.controller.abort();
    tell('Cancelling import…');
  };
  picker.onchange = async () => {
    const file = picker.files[0];
    clearKeyRecovery();
    if (!file) return;
    const operation = { controller: new AbortController(), cancellable: true, userCancelled: false, committed: false };
    const release = beginImport(button, operation);
    if (!release) { picker.value = ''; return; }
    cancel.hidden = false; cancel.disabled = false;
    tell(`Preparing ${file.name} for import…`);
    try {
      const result = await importToLibrary(file, api, { signal: operation.controller.signal,
        onProgress: (done, total) => { if (!operation.userCancelled) tell(`Importing ${file.name} · ${Math.floor(done / total * 100)}%`); },
        onPhase: phase => {
          if (operation.userCancelled) return;
          operation.cancellable = phase === 'copying';
          cancel.hidden = !operation.cancellable; cancel.disabled = !operation.cancellable;
          tell(phase === 'copying' ? `Importing ${file.name} · 0%`
            : phase === 'checking' ? `Checking ${file.name}…` : `Saving ${file.name} on this device…`);
        } });
      operation.committed = true; operation.cancellable = false;
      cancel.hidden = true; cancel.disabled = true;
      // The game and its import record are already durable at this point. Show
      // it even if the subsequent native-device snapshot cannot be saved.
      await mobile.refresh(true);
      try {
        if (!await saveDeviceState(api, { force: true }))
          throw new Error('NXI is busy. Finish the current action, then retry saving.');
      } catch (error) {
        retrySave.hidden = false;
        document.getElementById('setup-message').textContent = 'The game was added, but NXI could not finish saving its changes. Keep NXI open and retry saving. ' + (error.message || String(error));
        tell('Game added. Open Setup to retry saving.');
        if (!setupDialog.open) setupDialog.showModal();
        return;
      }
      tell(result.warning || 'Added to your device. Select the game and press Play.');
    } catch (e) {
      tell(operation.committed ? 'The game was added, but its library view could not be refreshed. Reload NXI to reopen it.'
        : operation.userCancelled && operation.controller.signal.aborted ? 'Import cancelled. No game was added.'
        : e.message || String(e));
    } finally { picker.value = ''; cancel.hidden = true; cancel.disabled = false; release(); }
  };
  const setup = document.getElementById('setup');
  setup.disabled = false; setup.onclick = () => document.getElementById('setup-dialog').showModal();
  const retrySave = document.getElementById('retry-save');
  retrySave.onclick = async () => {
    retrySave.disabled = true;
    try {
      if (!await saveDeviceState(api, { force: true, report: tell }))
        throw new Error('Stop the game and finish the current action before saving.');
      retrySave.hidden = true;
      document.getElementById('setup-message').textContent = 'Progress saved on this device.';
    } catch (error) { document.getElementById('setup-message').textContent = error.message; }
    finally { retrySave.disabled = false; }
  };
  keyButton.onclick = () => { clearKeyRecovery(); keys.click(); };
  // Firmware can be a ZIP from any tool, loose .nca files, or a folder (where the browser can pick one).
  const firmwareFolder = document.getElementById('firmware-folder'), folderButton = document.getElementById('choose-firmware-folder');
  folderButton.hidden = !('webkitdirectory' in firmwareFolder) || /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  firmwareButton.onclick = () => { clearKeyRecovery(); firmware.click(); };
  folderButton.onclick = () => { clearKeyRecovery(); firmwareFolder.click(); };
  const importFirmware = async (input, control) => {
    const files = [...input.files]; clearKeyRecovery(); if (!files.length) return;
    phase(`firmware import: ${files.length} file(s), ${Math.round(files.reduce((n, f) => n + f.size, 0) / 1048576)} MB`);
    let lastTenth = -1;
    const release = beginImport(control, {});
    if (!release) { input.value = ''; return; }
    document.getElementById('setup-message').textContent = 'Importing firmware…';
    // The native install reads the package three times; show which pass and how far, with time.
    const started = Date.now(); let lastStep = '';
    const passes = { preparing: 'Preparing', checking: 'Checking', verifying: 'Verifying (decrypting every file)', installing: 'Installing' };
    const watch = setInterval(() => {
      let progress = ''; try { progress = api.FirmwareProgress?.() ?? ''; } catch {}
      if (!progress) return;
      const [stage, read, size] = progress.split('|'), percent = size > 0 ? Math.min(99, Math.floor(read / size * 100)) : 0;
      const step = `firmware: ${stage} ${Math.floor(percent / 25) * 25}%`;
      if (step !== lastStep) { lastStep = step; phase(step); }
      const seconds = Math.round((Date.now() - started) / 1000);
      document.getElementById('setup-message').textContent = `${passes[stage] ?? stage} firmware · ${percent}% · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} (phones can take a few minutes)`;
    }, 1000);
    try {
      const version = await saveFirmware(files, api, { onProgress: (done, total) => {
        const tenth = Math.floor(done / total * 10); if (tenth !== lastTenth) { lastTenth = tenth; phase(done === total ? 'firmware: verifying and installing' : `firmware: copying ${tenth * 10}%`); }
        document.getElementById('setup-message').textContent = done === total ? 'Verifying and installing firmware…' : `Copying firmware · ${Math.floor(done / total * 100)}%`;
      } });
      phase('firmware installed');
      firmwareRestored = true; firmwareBlocked = false;
      document.getElementById('setup-message').textContent = `Firmware ${version} installed and saved on this device.`;
    } catch (error) { phase('firmware failed: ' + error.message); document.getElementById('setup-message').textContent = error.message; }
    finally { clearInterval(watch); input.value = ''; release(); }
  };
  firmware.onchange = () => importFirmware(firmware, firmwareButton);
  firmwareFolder.onchange = () => importFirmware(firmwareFolder, folderButton);
  async function importKeySelection(file, compatibleOnly, release) {
    const generation = recoveryGeneration;
    document.getElementById('setup-message').textContent = compatibleOnly ? 'Importing compatible key entries…' : 'Importing keys…';
    let savedMessage;
    try {
      phase(`keys import: ${file.name}, ${file.size} bytes`);
      const result = await saveKeys(file, api, { compatibleOnly });
      phase('keys import: saved, re-checking games');
      savedMessage = compatibleOnly
        ? `${result.name}: compatible entries saved on this device; ${result.incompatibleEntries} incompatible ${result.incompatibleEntries === 1 ? 'entry' : 'entries'} skipped.` +
          (result.retainedEntries > 0 ? ` ${result.retainedEntries} previously saved ${result.retainedEntries === 1 ? 'entry' : 'entries'} kept.` : '')
        : `${result.name} saved on this device.`;
      await mobile.refresh(true);
      phase('keys import: done');
      document.getElementById('setup-message').textContent = savedMessage;
    } catch (error) {
      document.getElementById('setup-message').textContent = savedMessage
        ? `${savedMessage} The library could not refresh. Reload NXI to update it.`
        : error.message || String(error);
      if (!savedMessage && !compatibleOnly && generation === recoveryGeneration && setupDialog.open &&
          /^(prod|console)\.keys$/i.test(file.name) && error.code === 'key_entries_incompatible' && error.canImportCompatible === true &&
          Number.isSafeInteger(error.compatibleEntries) && error.compatibleEntries > 0 &&
          Number.isSafeInteger(error.incompatibleEntries) && error.incompatibleEntries > 0 && Array.isArray(error.issues))
        offerKeyRecovery(file, error);
    } finally { keys.value = ''; release(); }
  }
  keys.onchange = async () => {
    const file = keys.files[0]; clearKeyRecovery(); if (!file) return;
    const release = beginImport(keyButton, {});
    if (!release) { keys.value = ''; return; }
    await importKeySelection(file, false, release);
  };
  recoveryButton.onclick = async () => {
    const file = pendingKeyFile;
    if (!file || !setupDialog.open) { clearKeyRecovery(); return; }
    const release = beginImport(recoveryButton, {});
    if (!release) return;
    await importKeySelection(file, true, release);
  };
  let canvas = document.getElementById('screen'); const game = document.getElementById('game');
  new MutationObserver(() => { if (!game.hidden) clearKeyRecovery(); })
    .observe(game, { attributes: true, attributeFilter: ['hidden'] });
  // WebGPU first: the GPU worker owns the canvas and draws frames itself. If the browser has
  // no WebGPU, fall back to copying frames into a 2D canvas here.
  startup.phase('graphics');
  const ringAddress = (await api.GpuRingAddress()) >>> 0;
  const gpu = new GpuPresentation({ canvas, memory: globalThis.nxiWasmMemory, address: ringAddress, timeoutMs: 30000,
    workerUrl: new URL('./nxi-gpu-worker.js', import.meta.url), readback: new URLSearchParams(location.search).get('gpu') === 'readback' });
  globalThis.nxiReadGpuMemory = () => gpu.memorySnapshot();
  globalThis.nxiReadGpuRing = () => gpu.ringSnapshot();
  if (navigator.gpu && canvas.transferControlToOffscreen && new URLSearchParams(location.search).get('gpu') !== '0')
    await gpu.start();
  jitRestore = restoreJitCache(api).then(n => { if (n) console.log('NXI jit cache restored: ' + (n / 1048576).toFixed(1) + ' MB'); return n; })
    .catch(() => { console.warn('NXI saved CPU cache was unavailable; translations will rebuild.'); return 0; });
  globalThis.nxi.jitRestore = jitRestore;
  const frameAddress = (await api.FrameAddress()) >>> 0;
  let lastSeq = 0, lastPresented = 0, frameImage = null;
  function draw() {
    if (gpu.poll()) {
      const presented = Atomics.load(new Int32Array(runtime.Module.HEAPU8.buffer, ringAddress, 16), 6);
      if (presented !== lastPresented) lastPresented = presented;
      requestAnimationFrame(draw); return;
    }
    canvas = gpu.canvas;
    const ctx = gpu.context2d;
    const heap = runtime.Module.HEAPU8.buffer, head = new Int32Array(heap, frameAddress, 4);
    const seq = Atomics.load(head, 0), w = Atomics.load(head, 1), h = Atomics.load(head, 2);
    if (seq !== lastSeq && w > 0 && h > 0 && w <= 1920 && h <= 1080) {
      // One reused image per frame size: a new one (and a canvas resize, which reallocates
      // its backing store) every frame made memory swing by gigabytes on phones.
      if (frameImage?.width !== w || frameImage?.height !== h) frameImage = new ImageData(w, h);
      frameImage.data.set(new Uint8Array(heap, frameAddress + 16, w * h * 4));
      if (seq === Atomics.load(head, 0)) {
        lastSeq = seq;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.putImageData(frameImage, 0, 0);
      }
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  // Session state owns this screen. Delayed frames cannot reopen it after Stop,
  // and Stop stays accessible while a title is loading its first frame.
  const sessionView = startSessionView(api, game, tell);
  setInterval(() => saveDeviceState(api).catch(error => { document.getElementById('setup-message').textContent = 'Progress has not been saved: ' + error.message; }), 30000);
  document.getElementById('stop').onclick = async event => {
    event.currentTarget.disabled = true;
    sessionView.stopping(true);
    let gameStopped = false;
    try {
      await api.Stop(); cpuWorkers.splice(0).forEach(worker => worker.terminate());
      gameStopped = true;
      if (!await saveDeviceState(api, { force: true, report: tell }))
        throw new Error('Device data is still busy. Keep NXI open and try saving again.');
    } catch (e) {
      tell(e.message || String(e));
      if (gameStopped) {
        retrySave.hidden = false;
        document.getElementById('setup-message').textContent = 'The game stopped, but its latest progress could not be saved. Keep NXI open. ' + (e.message || String(e));
        if (!setupDialog.open) setupDialog.showModal();
      }
    }
    finally { sessionView.stopping(false); await sessionView.refresh(); }
  };
  // Do not let the first tap create a CPU-only renderer while WebGPU is still
  // starting, or translate the game before its persistent CPU cache is restored.
  startup.phase('cpu-cache');
  await jitRestore;
  await api.MarkRuntimeReady();
  startup.finish();
  button.disabled = false;
  for (const id of ['choose-keys', 'choose-firmware', 'choose-firmware-folder', 'classic-mode']) document.getElementById(id).disabled = false;
  tell(setupWarnings.length ? 'Setup needs attention. Open Setup for details.' : `Ready · ${restored.restored} saved files${restored.skipped ? ` · ${restored.skipped} need attention` : ''}`);
} catch (e) {
  startup.finish(true);
  const failure = e.message || String(e);
  tell(failure);
  reportMobileStatus(failure, { error: true });
  console.error(e);
}
