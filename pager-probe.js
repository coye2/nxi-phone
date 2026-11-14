// Paging latency probe (open Mochi with ?pagerprobe). First go/no-go gate for "fake RAM":
// guest pages kept in a small fixed pool, the rest in an OPFS file, a stalled CPU thread
// woken by a pager worker over shared memory. Measures, on the real phone:
//   noIO        CPU -> pager -> CPU wake-up with no storage (scheduling floor)
//   cleanFault  miss: read one page from OPFS into a pool slot, resume, verify
//   dirtyFault  miss that first writes the evicted dirty page back
//   hit         resident access (bookkeeping only)
//   pagerRead / pagerWrite  storage service time inside the pager
// Results go to the PC receiver set up for auto-test (same address and pairing code), and are
// shown on screen. The backing file holds only a synthetic pattern; no game data is involved.
// The file is written just before reading, so reads are likely served warm (not cold NAND).

const CONFIGS = [16, 64, 256].flatMap(pageKiB => [4, 0].map(dirtyEvery => (
  { pageKiB, dirtyEvery, poolMiB: 32, backingMiB: 256, requests: 10000, controlRequests: 2000, pattern: 'random' })));

function summary(values) {
  if (!values.length) return { n: 0 };
  const s = Float64Array.from(values).sort(), at = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  const r = x => Math.round(x * 1000) / 1000;
  return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(at(0.5)), p90: r(at(0.9)), p99: r(at(0.99)), max: r(s[s.length - 1]) };
}

function once(worker, test) {
  return new Promise((resolve, reject) => {
    const listener = event => {
      if (event.data.error) { worker.removeEventListener('message', listener); reject(Error(event.data.error)); }
      else if (test(event.data)) { worker.removeEventListener('message', listener); resolve(event.data); }
    };
    worker.addEventListener('message', listener);
    worker.addEventListener('error', event => reject(Error('worker: ' + (event.message || 'failed to start'))), { once: true });
  });
}

async function runOne(config, tell) {
  const pageBytes = config.pageKiB * 1024, backingBytes = config.backingMiB * 1048576;
  const pool = new SharedArrayBuffer(config.poolMiB * 1048576);
  const mailbox = new SharedArrayBuffer(64), timing = new SharedArrayBuffer(16);
  const url = new URL('./pager-probe-worker.js', import.meta.url);
  const pager = new Worker(url), cpu = new Worker(url);
  try {
    const started = performance.now();
    const ready = once(pager, d => d.ready);
    pager.postMessage({ role: 'pager', mailbox, timing, pool, backingBytes, pageBytes });
    const { info } = await ready;
    const done = once(cpu, d => d.done);
    cpu.postMessage({ role: 'cpu', mailbox, timing, pool, backingBytes, pageBytes, ...config });
    const { out } = await done;
    const mb = new Int32Array(mailbox);
    const stopped = once(pager, d => d.stopped);
    Atomics.store(mb, 0, 9); Atomics.notify(mb, 0);
    const final = await Promise.race([stopped, new Promise(r => setTimeout(() => r(null), 3000))]);
    const result = {
      config, totalMs: Math.round(performance.now() - started), backingInitMs: Math.round(info.initMs), backingRewritten: info.rewritten,
      sharedBufferReads: final?.info.sharedReads ?? null, sharedBufferWrites: final?.info.sharedWrites ?? null,
      errors: out.errors, mismatches: out.mismatches,
      noIO: summary(out.noIO), hit: summary(out.hit), cleanFault: summary(out.cleanFault), dirtyFault: summary(out.dirtyFault),
      pagerRead: summary(out.pagerRead), pagerWrite: summary(out.pagerWrite),
    };
    tell(`${config.pageKiB} KiB, dirty 1/${config.dirtyEvery || '∞'}: clean p50 ${result.cleanFault.p50} ms p99 ${result.cleanFault.p99}; dirty p50 ${result.dirtyFault.p50 ?? '-'}; wake p50 ${result.noIO.p50}`);
    return result;
  } finally { pager.terminate(); cpu.terminate(); }
}

async function upload(body) {
  let config = null;
  try { config = JSON.parse(localStorage.getItem('mochi-autotest') || 'null'); } catch {}
  if (!config?.url || !config?.secret) return 'not sent (auto-test is not set up on this device)';
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + String(body.sha || 'unknown').slice(0, 9) + '-pagerprobe.json';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${config.url}/upload/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mochi-Secret': config.secret }, body: JSON.stringify(body) });
      if (response.ok) return 'sent to the PC as ' + name;
      throw Error('HTTP ' + response.status);
    } catch (error) { if (attempt === 3) return 'upload failed: ' + error.message; await new Promise(r => setTimeout(r, 5000 * attempt)); }
  }
}

// Cold test: two phases across a phone restart, so the read hits flash, not the OS file cache.
//   phase A (no marker): write the backing file, persist storage, ask the user to force-quit
//                        and restart the phone, then reopen the same URL.
//   phase B (marker set): read every page once in shuffled order WITHOUT rewriting — cold reads.
const COLD_MARK = 'mochi-pager-cold';
export async function runPagerProbeCold(tell, pageKiB = 64) {
  const log = [];
  const say = text => { log.push(text); tell(log.slice(-8).join('\n')); };
  if (!crossOriginIsolated) throw Error('needs cross-origin isolation (reload once installed)');
  if (!navigator.storage?.getDirectory) throw Error('OPFS is not available in this browser');
  const pageBytes = pageKiB * 1024, backingBytes = 256 * 1048576;
  let mark = null; try { mark = JSON.parse(localStorage.getItem(COLD_MARK) || 'null'); } catch {}

  if (!mark || mark.pageKiB !== pageKiB) {
    say(`Cold test — phase 1 of 2: writing a ${backingBytes / 1048576} MiB file at ${pageKiB} KiB pages…`);
    try { await navigator.storage.persist?.(); } catch {}
    const pager = new Worker(new URL('./pager-probe-worker.js', import.meta.url));
    const mailbox = new SharedArrayBuffer(64), timing = new SharedArrayBuffer(16), pool = new SharedArrayBuffer(1048576);
    const prepared = once(pager, d => d.prepared);
    pager.postMessage({ role: 'pager', mode: 'prepare', mailbox, timing, pool, backingBytes, pageBytes });
    await prepared; pager.terminate();
    try { localStorage.setItem(COLD_MARK, JSON.stringify({ pageKiB, preparedAt: new Date().toISOString() })); } catch {}
    say('Phase 1 done. Now FULLY close Mochi (swipe it away), restart the phone, then reopen this same link to run phase 2.');
    return { phase: 'prepared', pageKiB };
  }

  say(`Cold test — phase 2 of 2: reading every page once from cold storage (${pageKiB} KiB pages)…`);
  const pool = new SharedArrayBuffer(32 * 1048576);
  const mailbox = new SharedArrayBuffer(64), timing = new SharedArrayBuffer(16);
  const pager = new Worker(new URL('./pager-probe-worker.js', import.meta.url)), cpu = new Worker(new URL('./pager-probe-worker.js', import.meta.url));
  let result;
  try {
    const ready = once(pager, d => d.ready);
    pager.postMessage({ role: 'pager', mode: 'serveNoInit', mailbox, timing, pool, backingBytes, pageBytes });
    const { info } = await ready;
    const done = once(cpu, d => d.done);
    cpu.postMessage({ role: 'cpu', mailbox, timing, pool, backingBytes, pageBytes, requests: 0, controlRequests: 0, dirtyEvery: 0, pattern: 'shuffleOnce' });
    const { out } = await done;
    result = { coldClean: summary(out.cleanFault), pagerRead: summary(out.pagerRead), errors: out.errors, mismatches: out.mismatches,
      sharedBufferReads: info.sharedReads };
    say(`Cold ${pageKiB} KiB: p50 ${result.coldClean.p50} ms, p90 ${result.coldClean.p90}, p99 ${result.coldClean.p99}, max ${result.coldClean.max} (${result.coldClean.n} reads)`);
  } finally { pager.terminate(); cpu.terminate(); }
  try { const root = await navigator.storage.getDirectory(); await root.removeEntry('mochi-pager-probe.bin'); } catch {}
  try { localStorage.removeItem(COLD_MARK); } catch {}

  let sha = ''; try { sha = (await (await fetch('./build-info.json')).json()).sourceCommit || ''; } catch {}
  const body = { kind: 'pagerprobe-cold', sha, at: new Date().toISOString(), userAgent: navigator.userAgent,
    standalone: matchMedia('(display-mode: standalone)').matches, cores: navigator.hardwareConcurrency || null,
    notes: 'Backing file prepared before a phone restart; phase 2 reads each page once. Cold-cache attempt, not a guaranteed NAND read.',
    pageKiB, result };
  say('Done. ' + await upload(body));
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;font-size:12px;max-height:60vh;overflow:auto;user-select:text';
  pre.textContent = JSON.stringify(body, null, 1);
  document.body.append(pre);
  return body;
}

export async function runPagerProbe(tell) {
  const log = [];
  const say = text => { log.push(text); tell(log.slice(-8).join('\n')); };
  if (!crossOriginIsolated) throw Error('needs cross-origin isolation (reload once the site is installed)');
  if (!navigator.storage?.getDirectory) throw Error('OPFS is not available in this browser');
  let sha = '';
  try { sha = (await (await fetch('./build-info.json')).json()).sourceCommit || ''; } catch {}
  const body = {
    kind: 'pagerprobe', sha, at: new Date().toISOString(), userAgent: navigator.userAgent,
    standalone: matchMedia('(display-mode: standalone)').matches, cores: navigator.hardwareConcurrency || null,
    notes: 'Backing file written just before reads: warm-cache results, not cold storage.', runs: [],
  };
  say('Paging probe: ' + CONFIGS.length + ' runs, keep this page open…');
  for (const config of CONFIGS) {
    say(`running ${config.pageKiB} KiB pages, dirty every ${config.dirtyEvery || 'never'}…`);
    try { body.runs.push(await runOne(config, say)); }
    catch (error) { body.runs.push({ config, error: error.message }); say('run failed: ' + error.message); }
  }
  try { const root = await navigator.storage.getDirectory(); await root.removeEntry('mochi-pager-probe.bin'); } catch {}
  say('Done. ' + await upload(body));
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;font-size:11px;max-height:60vh;overflow:auto;user-select:text';
  pre.textContent = JSON.stringify(body, null, 1);
  document.body.append(pre);
  return body;
}
