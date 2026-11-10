// A scenario model, never a stress allocator or a browser memory-limit detector.
export const MiB = 1024 * 1024;
export const memorySources = [
  { title: 'WebAssembly.Memory: linear memory is an addressable buffer', url: 'https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory' },
  { title: 'Browser memory measurements: scope and limitations', url: 'https://web.dev/articles/monitor-total-page-memory-usage' },
  { title: 'WebKit worker/reload memory report (not a universal coefficient)', url: 'https://bugs.webkit.org/show_bug.cgi?id=299731' },
];
// Bounds protect arithmetic and exports; they do not restrict the emulator itself.
export const memoryFields = [
  ['budgetMiB', 'Planning budget (MiB)', 2048, 128, 65536, 64],
  ['guestMiB', 'Guest RAM allocation (MiB)', 1024, 64, 8192, 64],
  ['guestTouched', 'Guest pages touched (%)', 65, 0, 100, 5],
  ['runtimeMiB', 'Managed/native data excluding guest RAM and stacks (MiB)', 160, 0, 8192, 16],
  ['workers', 'Runtime workers', 29, 0, 256, 1],
  ['stackMiB', 'Touched stack per worker, inside linear memory (MiB)', .5, 0, 16, .25],
  ['functions', 'Native functions per instance', 176000, 0, 2000000, 1000],
  ['tableEntries', 'Function table entries per instance', 160000, 0, 2000000, 1000],
  ['functionBytes', 'Instance bytes per function (assumption)', 40, 0, 512, 1],
  ['tableBytes', 'Instance bytes per table entry (assumption)', 50, 0, 512, 1],
  ['workerMiB', 'Other browser overhead per worker (MiB)', 2, 0, 64, 1],
  ['nativeCodeMiB', 'Shared compiled native code (MiB)', 180, 0, 8192, 16],
  ['translatedBlocks', 'Cached translated guest blocks', 12000, 0, 1000000, 1000],
  ['blockKiB', 'Compiled bytes per guest block (KiB)', 7, 0, 256, 1],
  ['gpuMiB', 'GPU textures and buffers (MiB)', 192, 0, 8192, 16],
  ['resolutionScale', 'Render resolution scale (scenario)', 1, .5, 4, .25],
  ['scaledGpuPercent', 'GPU resources that scale with resolution (%)', 50, 0, 100, 5],
  ['stagingMiB', 'GPU upload/readback staging (MiB)', 32, 0, 2048, 4],
  ['audioMiB', 'Audio/input shared rings, inside linear memory (MiB)', 4, 0, 128, 1],
  ['uiMiB', 'JavaScript, images and launcher UI (MiB)', 48, 0, 4096, 8],
  ['importMiB', 'Import chunk size (MiB)', 32, 0, 4096, 8],
  ['importCopies', 'Simultaneous import copies', 2, 0, 8, 1],
  ['compileMiB', 'Temporary compilation buffers (MiB)', 96, 0, 4096, 16],
  ['retainedPercent', 'Guest/graphics memory retained after Stop (%)', 80, 0, 100, 5],
  ['reloads', 'Prior reloads to model', 0, 0, 20, 1],
  ['reloadRetention', 'Assumed worker overhead retained per reload (%)', 0, 0, 100, 5],
  ['uncertainty', 'Estimate uncertainty (±%)', 30, 0, 100, 5],
  ['guestCpuMs', 'CPU work per frame (ms)', 10, 0, 1000, 1],
  ['translationMs', 'Translation work per frame (ms)', 2, 0, 1000, 1],
  ['gpuMs', 'GPU work per frame (ms)', 12, 0, 1000, 1],
  ['syncMs', 'Synchronization/presentation per frame (ms)', 2, 0, 1000, 1],
  ['targetFps', 'Target frames per second', 60, 1, 240, 1],
];
export const defaultMemoryInputs = Object.fromEntries(memoryFields.map(([key, , value]) => [key, value]));
export function normalizeMemoryInputs(raw = {}) {
  return Object.fromEntries(memoryFields.map(([key, , fallback, min, max, step]) => {
    const n = raw[key];
    const value = typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    return [key, step === 1 && !key.endsWith('Ms') ? Math.round(value) : value];
  }));
}
export function simulateMemory(raw = {}) {
  const input = normalizeMemoryInputs(raw), p = input, uncertainty = p.uncertainty / 100;
  const perInstance = (p.functions * p.functionBytes + p.tableEntries * p.tableBytes) / MiB;
  const workerMetadata = (p.workers + 1) * perInstance + p.workers * p.workerMiB;
  const guestTouched = p.guestMiB * p.guestTouched / 100;
  const stack = p.workers * p.stackMiB;
  const translated = p.translatedBlocks * p.blockKiB / 1024;
  const reload = workerMetadata * p.reloadRetention / 100 * p.reloads;
  const retained = p.retainedPercent / 100;
  const scaledGpu = p.gpuMiB * (1 - p.scaledGpuPercent / 100 + p.scaledGpuPercent / 100 * p.resolutionScale ** 2);
  const phase = (id, label, guest, gpu, cache, transient, workers = workerMetadata) => {
    const categories = [
      { id: 'guest', label: 'Touched guest RAM', mib: guest, space: 'linear' },
      { id: 'runtime', label: 'Managed/native runtime', mib: p.runtimeMiB, space: 'linear' },
      { id: 'stacks', label: 'Worker stacks', mib: stack, space: 'linear' },
      { id: 'audio', label: 'Audio and input rings', mib: p.audioMiB, space: 'linear' },
      { id: 'instances', label: 'Worker/instance metadata', mib: workers, space: 'external' },
      { id: 'code', label: 'Shared compiled native code', mib: p.nativeCodeMiB, space: 'external' },
      { id: 'translation', label: 'Translated guest code', mib: cache, space: 'external' },
      { id: 'gpu', label: 'GPU resources and staging', mib: gpu, space: 'gpu' },
      { id: 'ui', label: 'JavaScript and UI', mib: p.uiMiB, space: 'external' },
      { id: 'temporary', label: 'Temporary copies/compilation', mib: transient, space: 'transient' },
      { id: 'reload', label: 'Assumed reload retention', mib: reload, space: 'external' },
    ];
    const totalMiB = categories.reduce((sum, c) => sum + c.mib, 0);
    return { id, label, categories, totalMiB, lowMiB: Math.max(0, totalMiB * (1 - uncertainty)), highMiB: totalMiB * (1 + uncertainty), headroomMiB: p.budgetMiB - totalMiB,
      estimatedLinearResidentMiB: categories.filter(c => c.space === 'linear').reduce((sum, c) => sum + c.mib, 0) };
  };
  const phases = [
    phase('startup', 'Startup', 0, 0, 0, p.compileMiB),
    phase('import', 'Firmware / game import', 0, 0, 0, p.importMiB * p.importCopies),
    phase('play', 'Gameplay', guestTouched, scaledGpu + p.stagingMiB, translated, p.compileMiB),
    phase('stop', 'After Stop', guestTouched * retained, (scaledGpu + p.stagingMiB) * retained, translated * retained, 0),
    phase('reload', 'Reload startup', 0, 0, 0, p.compileMiB),
  ];
  const peak = phases.reduce((a, b) => a.totalMiB >= b.totalMiB ? a : b);
  const cpuMs = p.guestCpuMs + p.translationMs, frameMs = Math.max(cpuMs, p.gpuMs) + p.syncMs;
  return { version: 1, inputs: input, phases, peakPhase: peak.id, peakMiB: peak.totalMiB,
    linearAddressCapacityMiB: p.guestMiB + p.runtimeMiB + stack + p.audioMiB,
    perWorkerInstanceMiB: perInstance,
    frame: { cpuMs, gpuMs: p.gpuMs, frameMs, targetMs: 1000 / p.targetFps, estimatedFps: Math.min(p.targetFps, frameMs > 0 ? 1000 / frameMs : p.targetFps), bottleneck: cpuMs >= p.gpuMs ? 'CPU / translation' : 'GPU' },
    sources: memorySources,
    assumptions: [
      'All category sizes are scenario estimates, not measurements. Defaults are planning examples based on the Mochi November 9 worker investigation and must be calibrated per device/build.',
      'Shared guest RAM, stacks and audio rings are counted once, inside linear memory. Compiled code is shared once; function/table metadata is modeled per instance including the main instance.',
      'Linear address capacity is separate from estimated resident memory and is never added to resident totals. OPFS/disk usage is excluded.',
      'GPU memory may be accounted differently by the OS, especially on unified-memory phones. Browser measurements are displayed separately and never added to the model.',
      'Stop does not shrink WebAssembly memory. Retention is a scenario input, not a promise of reclamation. Reload retention defaults to zero; nonzero values model a reported WebKit risk, not a known leak in this session.',
      'A planning budget is not the browser termination threshold. Uncertainty bounds are sensitivity ranges, not statistical confidence intervals.',
      'Frame cost assumes overlapping CPU and GPU work plus serial synchronization. Input costs must come from a workload measurement; predicted FPS is not a game benchmark.',
      'Only the selected fraction of GPU resources scales with the square of rendering resolution. Frame timings are independent inputs; resolution does not automatically predict a speedup.',
    ] };
}

export function observeMemory() {
  let runtime; try { runtime = globalThis.getDotnetRuntime?.(0); } catch {}
  const module = runtime?.Module ?? globalThis.nxi?.runtime?.Module;
  const memory = globalThis.nxiWasmMemory?.buffer ?? module?.HEAPU8?.buffer;
  const threads = module?.PThread;
  return { at: new Date().toISOString(), linearBufferBytes: memory?.byteLength ?? null,
    additionalWorkers: globalThis.nxiWorkerCounters?.() ?? null,
    runtimeWorkersRunning: threads?.runningWorkers?.length ?? null, runtimeWorkersIdle: threads?.unusedWorkers?.length ?? null,
    residentBytes: null, gpuResidentBytes: null,
    jsHeapBytes: globalThis.performance?.memory?.usedJSHeapSize ?? null,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    note: 'Linear buffer length is addressable allocation, not physical RAM usage. JS heap excludes native Wasm/GPU/worker overhead. Null means unavailable, never zero.' };
}

export async function collectMemoryObservation() {
  const observation = observeMemory();
  try { observation.gpuResources = await globalThis.nxiReadGpuMemory?.() ?? null; } catch { observation.gpuResources = null; }
  return observation;
}

export async function measurePageMemory(performanceApi = globalThis.performance, timeoutMs = 5000) {
  if (typeof performanceApi?.measureUserAgentSpecificMemory !== 'function') return { available: false, reason: 'This browser does not expose total page memory measurement.' };
  let timer;
  try {
    const result = await Promise.race([performanceApi.measureUserAgentSpecificMemory(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Measurement timed out. No value was assumed.')), timeoutMs); })]);
    return { available: true, bytes: result.bytes, at: new Date().toISOString(), note: 'Browser-specific page estimate; it is not process RSS or a device memory-limit measurement.' };
  } catch (error) { return { available: false, reason: error.message }; }
  finally { clearTimeout(timer); }
}
