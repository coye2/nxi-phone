// Auto-test: leave Mochi open on a charger and it plays one game on every new live build,
// then sends the result (status samples + diagnostics) over Wi-Fi to the owner's own PC
// (runner\mochi-results.ps1, HTTPS with a certificate the owner installs on the phone).
// Games, keys and firmware are never sent. If iOS kills the page mid-test, the next load
// sends the trail Mochi kept from the dead run instead. Off unless configured.
import { collectDiagnostics } from './diagnostics.js';

const CONFIG = 'mochi-autotest', RUNNING = 'mochi-autotest-running', DONE = 'mochi-autotest-done';
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, ms) => Promise.race([promise, sleep(ms).then(() => { throw Error('timed out'); })]);

export function autotestLabel() {
  const config = read(CONFIG);
  return config ? `Auto-test: ${config.game} (tap to stop)` : 'Set up auto-test';
}

// Asks for the game, the PC's results address and its pairing code. Tapping again turns it off.
export function configureAutotest() {
  if (read(CONFIG)) { write(CONFIG, null); write(RUNNING, null); return false; }
  const game = (prompt('Auto-test: which game? (part of its name, e.g. Sports)') || '').trim();
  if (!game) return false;
  const url = (prompt('Results address shown in the PC window (https://…:8443):') || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(url)) { alert('That is not an https:// address.'); return false; }
  const secret = (prompt('Pairing code shown in the PC window:') || '').trim();
  if (!/^[A-Za-z0-9]{8,64}$/.test(secret)) { alert('That pairing code does not look right.'); return false; }
  write(CONFIG, { game, url, secret, seconds: 150 });
  write(DONE, null);
  return true;
}

async function upload(config, name, body) {
  const response = await fetch(`${config.url}/upload/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mochi-Secret': config.secret },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw Error('results upload failed: HTTP ' + response.status);
}

async function report(config, phase, body) {
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + String(body.sha || 'unknown').slice(0, 9) + '-' + body.kind + '.json';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await upload(config, name, body); phase('auto-test: uploaded ' + name); return; }
    catch (error) { phase('auto-test: ' + error.message); await sleep(15000 * attempt); }
  }
}

async function runningSha() {
  // The service worker answers from the cached package, so this is the build serving this page.
  try { return (await (await fetch('./build-info.json')).json()).sourceCommit || ''; } catch { return ''; }
}

async function keepAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch {}
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {});
  });
}

// Every few minutes, ask the service worker for a newer build. When one has finished installing,
// let it take over (only while idle) and reload into it.
function watchForNewBuild(phase) {
  navigator.serviceWorker?.addEventListener('controllerchange', () => location.reload());
  setInterval(async () => {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (!registration) return;
      await registration.update();
      if (registration.waiting) {
        phase('auto-test: new build ready, switching');
        registration.waiting.postMessage({ type: 'nxi-activate-waiting' });
      }
    } catch {}
  }, 180000);
}

export async function runAutotest({ api, phase, startup }) {
  const config = read(CONFIG);
  if (!config || !api) return;
  keepAwake();
  const sha = await runningSha();
  const previous = read(RUNNING);
  if (previous) {
    // The last test never finished: iOS (or something else) killed the page during it.
    write(RUNNING, null);
    write(DONE, previous.sha);
    const diagnostics = await bounded(collectDiagnostics(api, startup), 60000).catch(error => ({ error: String(error) }));
    await report(config, phase, { kind: 'killed', ...previous, reloadedAt: new Date().toISOString(), diagnostics });
  }
  if (sha && read(DONE) !== sha) {
    const started = Date.now();
    write(RUNNING, { sha, game: config.game, startedAt: new Date(started).toISOString() });
    phase('auto-test: playing ' + config.game + ' on ' + sha.slice(0, 9));
    const body = { kind: 'finished', sha, game: config.game, samples: [], playError: null };
    try {
      const library = JSON.parse(await bounded(api.Library(), 30000));
      const wanted = config.game.toLowerCase();
      const entry = library.find(item => String(item.DisplayName || '').toLowerCase().includes(wanted));
      if (!entry) throw Error('game not in this library: ' + config.game);
      body.entry = entry.DisplayName;
      api.Play(entry.EntryId).catch(error => { body.playError = String(error?.message || error); });
      while (Date.now() - started < config.seconds * 1000) {
        await sleep(3000);
        let status = null;
        try { status = JSON.parse(await bounded(api.Status(), 5000)); } catch {}
        body.samples.push({
          t: Math.round((Date.now() - started) / 100) / 10,
          status: status?.Status ?? null, state: status?.state ?? null, frames: status?.frames ?? null,
          error: status?.ErrorMessage ?? null,
          linearMiB: Math.round((globalThis.nxiWasmMemory?.buffer.byteLength || 0) / 1048576),
        });
        if (status?.ErrorCode || body.playError) break;
      }
      body.maxFrames = Math.max(0, ...body.samples.map(sample => sample.frames || 0));
    } catch (error) { body.error = String(error?.message || error); }
    body.diagnostics = await bounded(collectDiagnostics(api, startup), 60000).catch(error => ({ error: String(error) }));
    write(RUNNING, null);
    write(DONE, sha);
    await report(config, phase, body);
    try { await bounded(api.Stop(), 30000); } catch {}
  }
  phase('auto-test: waiting for the next build');
  watchForNewBuild(phase);
}
