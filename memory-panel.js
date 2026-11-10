import { memoryFields, defaultMemoryInputs, normalizeMemoryInputs, simulateMemory, collectMemoryObservation, measurePageMemory, MiB } from './memory-model.js';
import { downloadJson } from './theme-preferences.js';

export function mountMemoryPanel(parent) {
  const panel = document.createElement('details'); panel.className = 'memory-panel settings-panel';
  panel.innerHTML = `<summary>RAM &amp; emulator overhead simulator</summary>
    <p>Explore memory and frame costs without allocating simulated RAM. Estimates are adjustable scenarios, not a phone benchmark or a guarantee that a game will run.</p>
    <div class="row"><button data-observe>Read current counters</button><button data-measure>Measure page memory</button><button data-export>Export report</button><button data-reset>Reset scenario</button></div>
    <p data-observation aria-live="polite">No measurement yet. The simulator works even while the engine is loading.</p>
    <p data-build>Build profile: loading…</p>
    <div class="memory-results" data-results aria-live="polite"></div>
    <details><summary>Scenario inputs</summary><p>MiB = 1,048,576 bytes. Worker stacks and guest RAM already belong to linear memory; they are counted once.</p><div data-inputs class="settings-list"></div></details>
    <details><summary>Assumptions and research</summary><ul data-assumptions></ul><ul data-sources></ul></details>`;
  parent.append(panel);
  let input, hadSavedScenario = false; try { const stored = localStorage.getItem('nxi-memory-scenario-v1'); hadSavedScenario = !!stored; input = normalizeMemoryInputs(JSON.parse(stored ?? '{}')); } catch { input = { ...defaultMemoryInputs }; }
  let observation = null, measurement = null, build = null, profile = null, model;
  const fields = panel.querySelector('[data-inputs]');
  for (const [key, label, , min, max, step] of memoryFields) {
    const row = document.createElement('label'); row.className = 'setting-row';
    const span = document.createElement('span'); span.textContent = label;
    const control = document.createElement('input'); control.type = 'number'; control.min = min; control.max = max; control.step = step; control.value = input[key]; control.dataset.memoryInput = key;
    row.append(span, control); fields.append(row);
    control.onchange = () => { if (!control.checkValidity() || control.value === '') { control.reportValidity(); return; } input[key] = Number(control.value); render(); };
  }
  function render() {
    model = simulateMemory(input); input = model.inputs;
    try { localStorage.setItem('nxi-memory-scenario-v1', JSON.stringify(input)); } catch {}
    const format = value => Math.round(value).toLocaleString();
    const current = model.phases.find(p => p.id === 'play');
    panel.querySelector('[data-results]').innerHTML = `<p><strong>Estimated peak: ${format(model.peakMiB)} MiB</strong> · budget ${format(input.budgetMiB)} MiB</p>
      <div class="memory-table"><table><caption>Estimated resident memory by phase</caption><thead><tr><th>Phase</th><th>Estimate</th><th>Range (MiB)</th><th>Budget left</th></tr></thead><tbody>${model.phases.map(p => `<tr><th>${p.label}</th><td>${format(p.totalMiB)}</td><td>${format(p.lowMiB)}–${format(p.highMiB)}</td><td>${format(p.headroomMiB)}</td></tr>`).join('')}</tbody></table></div>
      <p>Modeled linear allocation: ${format(model.linearAddressCapacityMiB)} MiB. This is separate from physical residency.</p>
      <details><summary>Gameplay breakdown</summary>${current.categories.map(c => `<div class="memory-category"><span>${c.label}</span><strong>${format(c.mib)} MiB</strong><meter min="0" max="${Math.max(1, current.totalMiB)}" value="${c.mib}" aria-label="${c.label}"></meter></div>`).join('')}</details>
      <p>Frame scenario: ${model.frame.frameMs.toFixed(1)} ms / frame, ${model.frame.estimatedFps.toFixed(1)} FPS at most. Largest modeled cost: ${model.frame.bottleneck}. Target budget: ${model.frame.targetMs.toFixed(1)} ms. These are calculated from your inputs, not measured gameplay.</p>`;
    panel.querySelector('[data-assumptions]').replaceChildren(...model.assumptions.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    panel.querySelector('[data-sources]').replaceChildren(...model.sources.map(s => { const li = document.createElement('li'), a = document.createElement('a'); a.href = s.url; a.textContent = s.title; a.target = '_blank'; a.rel = 'noopener'; li.append(a); return li; }));
  }
  const observationText = () => {
    const mb = bytes => bytes == null ? 'unavailable' : `${(bytes / MiB).toFixed(1)} MiB`;
    panel.querySelector('[data-observation]').textContent = observation ? `Measured linear buffer: ${mb(observation.linearBufferBytes)} (not physical RAM). Runtime workers: ${observation.runtimeWorkersRunning ?? '?'} running, ${observation.runtimeWorkersIdle ?? '?'} idle. Additional CPU workers: ${observation.additionalWorkers?.cpuWorkersCreated ?? '?'}. JS heap only: ${mb(observation.jsHeapBytes)}. Tracked GPU buffers: ${mb(observation.gpuResources?.bufferAllocationBytes)}, textures: ${observation.gpuResources?.ownedTextures ?? '?'}. GPU residency: unavailable. Page estimate: ${measurement?.available ? mb(measurement.bytes) : measurement?.reason ?? 'not requested'}.` : 'No measurement yet.';
  };
  panel.querySelector('[data-observe]').onclick = async () => { observation = await collectMemoryObservation(); observationText(); };
  panel.querySelector('[data-measure]').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    panel.querySelector('[data-observation]').textContent = 'Requesting a browser memory estimate…';
    try { observation = await collectMemoryObservation(); measurement = await measurePageMemory(); observationText(); } finally { button.disabled = false; }
  };
  panel.querySelector('[data-export]').onclick = () => downloadJson('nxi-memory-report.json', { generatedAt: new Date().toISOString(), build, binaryProfile: profile, simulation: model, observed: observation, pageMeasurement: measurement });
  panel.querySelector('[data-reset]').onclick = () => { input = { ...defaultMemoryInputs }; if (profile) { input.functions = profile.definedFunctions; input.tableEntries = profile.tableInitialEntries; } for (const c of fields.querySelectorAll('input')) c.value = input[c.dataset.memoryInput]; render(); };
  render();
  // Small metadata only: never download or compile the engine for simulation.
  Promise.all(['build-info.json', 'memory-profile.json'].map(async path => {
    try { const r = await fetch(new URL(path, import.meta.url), { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; }
  })).then(([info, binary]) => {
    build = info; profile = binary;
    if (binary && !hadSavedScenario) {
      input.functions = binary.definedFunctions; input.tableEntries = binary.tableInitialEntries;
      for (const c of fields.querySelectorAll('input')) c.value = input[c.dataset.memoryInput]; render();
    }
    panel.querySelector('[data-build]').textContent = `Build: ${String(info?.sourceCommit ?? 'unavailable').slice(0, 12)}. ${binary ? `Binary profile: ${binary.definedFunctions.toLocaleString()} defined functions, ${binary.tableInitialEntries.toLocaleString()} table entries. Reset scenario to use these counts.` : 'Binary profile unavailable; editable example counts are in use.'}`;
  });
  return panel;
}
