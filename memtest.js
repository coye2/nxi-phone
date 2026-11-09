// Phone memory probe (?memtest). Does what starting NXI does, one step at a time, and writes a
// breadcrumb before each step. If the browser kills the page, Export diagnostics shows the last
// step that started. Nothing here touches saved data.
import { configureRuntimeDelivery } from './runtime-delivery.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function stubImports(module, memory) {
  const imports = {};
  for (const item of WebAssembly.Module.imports(module)) {
    const scope = imports[item.module] ??= {};
    if (item.kind === 'memory') scope[item.name] = memory;
    else if (item.kind === 'function') scope[item.name] = () => 0;
    else if (item.kind === 'table') scope[item.name] = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
    else scope[item.name] = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
  }
  return imports;
}

const workerSource = `
onmessage = async ({ data: { module, memory } }) => {
  const imports = {};
  for (const item of WebAssembly.Module.imports(module)) {
    const scope = imports[item.module] ??= {};
    if (item.kind === 'memory') scope[item.name] = memory;
    else if (item.kind === 'function') scope[item.name] = () => 0;
    else if (item.kind === 'table') scope[item.name] = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
    else scope[item.name] = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
  }
  try { self.instance = await WebAssembly.instantiate(module, imports); postMessage('ok'); }
  catch (error) { postMessage('failed: ' + error.message); }
};`;

export async function runMemoryTest(step) {
  step('memtest: reading native runtime info');
  const descriptor = await (await fetch(new URL('./runtime-delivery.json', import.meta.url), { cache: 'no-cache' })).json();
  const [name] = Object.keys(descriptor.resources ?? {});
  if (!name) throw new Error('This build has no compressed native runtime.');
  let loader;
  await configureRuntimeDelivery({ withResourceLoader(fn) { loader = fn; return this; } });

  step(`memtest: 1 compiling ${Math.round(descriptor.resources[name].size / 1048576)} MB native runtime`);
  const module = await WebAssembly.compileStreaming(loader('dotnetwasm', name));
  await pause(1500);

  step('memtest: 2 compiled, creating shared memory (4 GB max)');
  const memory = new WebAssembly.Memory({ initial: 873, maximum: 65536, shared: true });
  await pause(500);

  step('memtest: 3 instantiating on the page');
  await WebAssembly.instantiate(module, stubImports(module, memory));
  await pause(1500);

  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const workers = [];
  for (const count of [4, 12, 24]) {
    step(`memtest: 4 starting threads (${count})`);
    while (workers.length < count) {
      const worker = new Worker(url);
      workers.push(new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data === 'ok' ? resolve() : reject(new Error(data));
        worker.onerror = event => reject(new Error(event.message));
      }));
      worker.postMessage({ module, memory });
    }
    await Promise.all(workers);
    await pause(1500);
  }

  for (const mb of [256, 512, 768, 1024, 1536]) {
    step(`memtest: 5 runtime heap ${mb} MB`);
    const pages = mb * 16 - memory.buffer.byteLength / 65536;
    if (pages > 0) memory.grow(pages);
    // Touch every page, like a real heap would.
    const bytes = new Uint8Array(memory.buffer);
    for (let i = 0; i < bytes.length; i += 4096) bytes[i] = 1;
    await pause(1500);
  }
  step('memtest: done, everything survived');
}
