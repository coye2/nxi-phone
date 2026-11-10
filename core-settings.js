import { downloadJson } from './theme-preferences.js';

export function validateSetting(schema, value) {
  if (!schema.supported) throw new Error(schema.reason || 'This setting is unavailable in the phone engine.');
  if (schema.kind === 'boolean' && typeof value === 'boolean') return value;
  if (schema.kind === 'enum' && schema.values.includes(value)) return value;
  if (['number', 'integer'].includes(schema.kind) && typeof value === 'number' && Number.isFinite(value) &&
      (schema.kind !== 'integer' || Number.isInteger(value)) && (schema.minimum == null || value >= schema.minimum) && (schema.maximum == null || value <= schema.maximum)) return value;
  throw new Error(`${schema.label}: enter a valid ${schema.kind} within the listed range.`);
}
export function planSettingsImport(document, schemas) {
  if (!document || document.format !== 'nxi-settings' || document.version !== 1 || document.core !== 'nxi' || document.scope !== 'global' || !document.settings || typeof document.settings !== 'object' || Array.isArray(document.settings))
    throw new Error('Choose a global NX Infinity settings export. Game-specific files can be imported in the full launcher.');
  const apply = [], skipped = [];
  for (const [id, value] of Object.entries(document.settings)) {
    const schema = schemas.find(s => s.id === id);
    try { if (!schema) throw new Error('Unknown setting'); validateSetting(schema, value); apply.push({ id, value }); }
    catch (error) { skipped.push({ id, reason: error.message }); }
  }
  return { apply, skipped };
}

export function mountCoreSettings(parent, getApi) {
  const panel = document.createElement('details'); panel.className = 'settings-panel core-settings';
  panel.innerHTML = `<summary>Emulator settings</summary><p>Desktop core settings, with availability checked against the phone engine. Global values apply to every game; use the full launcher for game-specific overrides.</p>
    <div class="row"><button data-refresh>Refresh settings</button><button data-export disabled>Export settings</button><label>Import desktop settings<input data-import type="file" accept=".json,application/json" disabled></label></div>
    <label class="setting-row">Find a setting <input type="search" data-search placeholder="Search settings"></label>
    <label class="setting-row">Category <select data-category><option>All</option><option>Graphics</option><option>Performance</option><option>Audio</option><option>Controls</option><option>System</option></select></label>
    <p data-status role="status">Settings will be available when the phone engine is ready.</p><div data-import-preview hidden><p></p><button data-apply-import>Apply imported settings</button><button data-cancel-import>Cancel</button></div><div data-list class="settings-list"></div>
    <details><summary>Other desktop preferences</summary><p>Appearance, launcher view, profile and console setup are available above. The full launcher includes its desktop language, HOME audio/startup, controller mapping and per-game screens. Native desktop windows, updater, Discord integration, desktop GPU drivers and external OCR services are unavailable in a browser. Their desktop controls do not configure the phone engine.</p></details>`;
  parent.insertBefore(panel, parent.querySelector('.memory-panel'));
  let schemas = [], busy = false, importPlan = null;
  const status = text => { panel.querySelector('[data-status]').textContent = text; };
  const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
  const apiCall = async (method, ...args) => {
    const api = getApi(); if (typeof api?.[method] !== 'function') throw new Error('Settings need the updated phone engine. Reload when the update is ready.');
    let timer;
    try { return await Promise.race([Promise.resolve().then(() => api[method](...args)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The engine did not respond. Refresh to check whether the setting was applied.')), 10000); })]); }
    finally { clearTimeout(timer); }
  };
  const category = id => id.startsWith('audio.') ? 'Audio' : id.startsWith('input.') ? 'Controls' : id.startsWith('system.') ? 'System' : id.startsWith('graphics.') ? 'Graphics' : 'Performance';
  function render() {
    const list = panel.querySelector('[data-list]'); list.replaceChildren();
    const filter = panel.querySelector('[data-category]').value, query = panel.querySelector('[data-search]').value.toLowerCase().trim();
    for (const schema of schemas) {
      if (filter !== 'All' && category(schema.id) !== filter || query && !`${schema.label} ${schema.description} ${schema.id}`.toLowerCase().includes(query)) continue;
      const row = document.createElement('label'); row.className = 'setting-row' + (schema.supported ? '' : ' setting-unavailable');
      const label = document.createElement('span'), title = document.createElement('strong'), description = document.createElement('small'), state = document.createElement('small');
      title.textContent = schema.label;
      description.textContent = schema.id === 'audio.volume' ? 'Game audio volume: 0 is muted and 1 is full volume.'
        : schema.id === 'input.controller_style' ? 'Auto uses a Pro Controller on this phone build. Choose Joy-Con (R) explicitly for games that require it; automatic game detection is not connected.'
        : schema.description;
      description.className = state.className = 'setting-help';
      const value = schema.requested ?? schema.effective ?? schema.defaultValue;
      state.textContent = !schema.supported ? `Unavailable: ${schema.reason || 'No phone implementation.'}` : schema.pending ? schema.reason || 'Saved; takes effect on the next game launch.' : schema.effective == null ? 'Preference for the next game. No active value yet.' : `Engine value: ${schema.effective}`;
      label.append(title, description, state);
      const input = document.createElement(schema.kind === 'enum' ? 'select' : 'input');
      if (schema.kind === 'enum') for (const v of schema.values) { const option = document.createElement('option'); option.value = v; option.textContent = v; input.append(option); }
      else if (schema.kind === 'boolean') { input.type = 'checkbox'; input.checked = value === true; }
      else { input.type = 'number'; if (schema.minimum != null) input.min = schema.minimum; if (schema.maximum != null) input.max = schema.maximum; input.step = schema.kind === 'integer' ? '1' : 'any'; }
      if (schema.kind !== 'boolean' && value != null) input.value = value;
      input.disabled = busy || !schema.supported; input.dataset.settingId = schema.id;
      input.onchange = async () => {
        if (busy) return;
        const next = schema.kind === 'boolean' ? input.checked : schema.kind === 'enum' ? input.value : Number(input.value);
        try {
          if (input.value === '' && schema.kind !== 'boolean') throw new Error('Enter a value.');
          validateSetting(schema, next); busy = true; render();
          await apiCall('SetMobileSetting', schema.id, JSON.stringify(next));
          await save(); await refresh(); status(`${schema.label} saved. ${schema.apply === 'live' ? 'The active value is shown below when a game is running.' : 'Takes effect on the next game launch.'}`);
        } catch (error) { status(error.message); }
        finally { busy = false; render(); }
      };
      row.append(label, input); list.append(row);
    }
    panel.querySelector('[data-export]').disabled = !schemas.length || busy;
    panel.querySelector('[data-import]').disabled = !schemas.length || busy;
  }
  async function save() {
    if (typeof globalThis.nxi?.saveDeviceState === 'function') {
      const saved = await globalThis.nxi.saveDeviceState();
      if (saved === false) throw new Error('The setting changed for this visit, but device storage is busy. Use Console setup → Retry saving progress before closing.');
    }
  }
  async function refresh() {
    try {
      const snapshot = decode(await apiCall('MobileSettings'));
      if (!Array.isArray(snapshot?.settings)) throw new Error('The engine returned an invalid settings list.');
      schemas = snapshot.settings; render(); status(`${schemas.length} desktop settings · ${schemas.filter(s => s.supported).length} available on this phone engine.`);
    } catch (error) { status(error.message); }
  }
  panel.ontoggle = () => { if (panel.open && !schemas.length && getApi()) void refresh(); };
  panel.querySelector('[data-refresh]').onclick = () => void refresh();
  panel.querySelector('[data-search]').oninput = render; panel.querySelector('[data-category]').onchange = render;
  panel.querySelector('[data-export]').onclick = () => downloadJson('nxi-settings-global.json', { format: 'nxi-settings', version: 1, core: 'nxi', scope: 'global', titleId: null, game: null, settings: Object.fromEntries(schemas.filter(s => s.supported).map(s => [s.id, s.requested ?? s.defaultValue])) });
  const preview = panel.querySelector('[data-import-preview]');
  panel.querySelector('[data-import]').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 256 * 1024) throw new Error('Settings files must be smaller than 256 KiB.');
      importPlan = planSettingsImport(JSON.parse(await file.text()), schemas);
      preview.hidden = false; preview.querySelector('p').textContent = `${importPlan.apply.length} settings ready to import. ${importPlan.skipped.length} skipped. ${importPlan.skipped.map(s => `${s.id}: ${s.reason}`).join(' ')}`;
      panel.querySelector('[data-apply-import]').disabled = !importPlan.apply.length;
    } catch (error) { importPlan = null; preview.hidden = true; status(error.message); } finally { event.target.value = ''; }
  };
  panel.querySelector('[data-cancel-import]').onclick = () => { importPlan = null; preview.hidden = true; };
  panel.querySelector('[data-apply-import]').onclick = async () => {
    if (!importPlan || busy) return; const plan = importPlan; let applied = 0; busy = true; render(); preview.hidden = true;
    try { for (const item of plan.apply) { await apiCall('SetMobileSetting', item.id, JSON.stringify(item.value)); applied++; } await save(); await refresh(); status(`Imported ${applied} settings; skipped ${plan.skipped.length}.`); }
    catch (error) { status(`${applied} settings changed before the import stopped. ${error.message}`); }
    finally { busy = false; importPlan = null; render(); }
  };
  return { refresh };
}
