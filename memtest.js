// Isolated probe: main.js enters here before loading the managed runtime.
import { configureRuntimeDelivery } from './runtime-delivery.js';
import { parseMemoryProbeConfig, runMemoryProbe } from './memory-probe.js';

async function compileNativeModule(emit, signal) {
  const fetchForProbe = (url, options) => fetch(url, { ...options, signal });
  const response = await fetchForProbe(new URL('./runtime-delivery.json', import.meta.url), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Runtime descriptor: HTTP ${response.status}`);
  const descriptor = await response.json();
  const entry = Object.entries(descriptor.resources ?? {}).find(([name]) => name.endsWith('.wasm'));
  if (!entry) throw new Error('This build has no compressed native runtime.');
  const [name, resource] = entry;
  let loader;
  await configureRuntimeDelivery({ withResourceLoader(fn) { loader = fn; return this; } }, fetchForProbe);
  emit('compile.begin', { nativeResource: name, nativeBytes: resource.size });
  const module = await WebAssembly.compileStreaming(loader('dotnetwasm', name));
  emit('compile.end', { nativeResource: name });
  return module;
}

export async function runMemoryTest(step, search = globalThis.location?.search ?? '') {
  const config = parseMemoryProbeConfig(search);
  // A bounded scalar-only record is inspectable without retaining memory buffers or instances.
  const report = globalThis.__mochiMemoryProbe = {
    schema: 1, status: 'running', startedAt: new Date().toISOString(), config,
    environment: {
      userAgent: globalThis.navigator?.userAgent ?? null,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      standalone: globalThis.navigator?.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true,
    },
    measuredPhysFootprintBytes: null,
    physicalMeasurementSource: 'external-device-capture-required',
    events: [],
  };
  const onEvent = event => {
    report.events.push(event);
    if (report.events.length > 256) report.events.shift();
    step(`memtest: ${event.phase} ${JSON.stringify(event)}`);
  };
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Memory probe stopped'));
  globalThis.stopMochiMemoryProbe = stop;
  globalThis.addEventListener?.('pagehide', stop, { once: true });
  try {
    await runMemoryProbe(config, {
      workerFactory: () => new Worker(new URL('./memory-probe-worker.js', import.meta.url), { type: 'module' }),
      compileNativeModule, onEvent, signal: controller.signal,
    });
    report.status = 'complete';
    step('memtest: complete; workers released. Physical footprint requires the paired device capture.');
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message ?? error);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    globalThis.removeEventListener?.('pagehide', stop);
    delete globalThis.stopMochiMemoryProbe;
  }
}
