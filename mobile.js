import { themes } from './visual/themes.js';
import { normalizeThemes, desktopThemeFile, resolvedTheme, patterns, patternImages, downloadJson } from './theme-preferences.js';
import { mountMemoryPanel } from './memory-panel.js';
import { mountCoreSettings } from './core-settings.js';
import { avatarCategories, avatarItems, avatarData, validImagePath } from './visual/avatars.js';

// Reuse NXI's original HOME / Dune presentation and preferences. The only game
// records and artwork come from the integrated native library, never a demo list.
const byId = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  library: 'M3 4h6v16H3zM12 4h3v16h-3zM18 4l3 1v15l-3-1z',
  play: 'M8 4l12 8-12 8z', heart: 'M12 20S2 14 2 7a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13z',
  check: 'M4 12l5 5L20 6',
};
const icon = name => `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="${paths[name] ?? paths.library}"/></svg>`;
const avatarUrl = value => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(value) ? value : './visual/avatar0.jpg';
let shell;

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem('nxi-web-v1') ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function reportMobileStatus(text, options = {}) {
  const source = byId('message');
  if (source && source.textContent !== String(text ?? '')) source.textContent = String(text ?? '');
  const target = byId('mobile-message');
  if (target) target.textContent = String(text ?? '');
  const retry = byId('mobile-retry');
  if (retry && typeof options.error === 'boolean') retry.hidden = !options.error;
}

export function initializeMobileShell() {
  if (shell) return shell;
  const root = byId('mobile'), main = byId('mobile-main'), importButton = byId('import');
  const saved = readPreferences();
  mountMemoryPanel(byId('mobile-settings'));
  const preferred = ['home', 'desktop'].includes(saved.defaultMode) ? saved.defaultMode : 'home';
  const preferences = {
    defaultMode: preferred, homeTheme: saved.homeTheme ?? 'home', desktopTheme: saved.desktopTheme ?? 'dune',
    profileName: typeof saved.profileName === 'string' ? saved.profileName.slice(0, 40) : 'Player',
    avatar: avatarUrl(saved.avatar) === saved.avatar ? saved.avatar : null,
    avatarId: typeof saved.avatarId === 'string' && validImagePath(saved.avatarId) ? saved.avatarId : null,
    avatarFavorites: Array.isArray(saved.avatarFavorites) ? saved.avatarFavorites.filter(validImagePath) : [],
    avatarCategory: typeof saved.avatarCategory === 'string' ? saved.avatarCategory : 'super-mario-odyssey',
    favorites: Array.isArray(saved.favorites) ? saved.favorites.filter(id => typeof id === 'string').slice(0, 2000) : [],
    selectedGame: typeof saved.selectedGame === 'string' ? saved.selectedGame : '',
    themePreferences: normalizeThemes(saved.themePreferences ?? { home: { preset: saved.homeTheme ?? 'home' }, desktop: { preset: saved.desktopTheme ?? 'dune' } }),
  };
  const state = { api: null, entries: [], signature: '', loaded: false, mode: preferred, page: 'library',
    filter: ['all', 'favorites', 'recent'].includes(saved.homeFilter) ? saved.homeFilter : 'all',
    selected: preferences.selectedGame, detailId: '', busy: false, limit: 60, refreshing: null, timer: null };
  const coreSettings = mountCoreSettings(byId('mobile-settings'), () => state.api);
  const characters = { categories: [], items: [], loaded: false, loading: null, error: '', category: preferences.avatarCategory,
    query: '', favoritesOnly: false, page: 0, pending: null, saving: false };
  const artwork = new Map(), artworkQueue = [];
  let artworkActive = 0;
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(items => {
    for (const item of items) if (item.isIntersecting) { observer.unobserve(item.target); queueArtwork(item.target); }
  }, { root: main, rootMargin: '140px' }) : null;

  function persist() {
    try { localStorage.setItem('nxi-web-v1', JSON.stringify({ ...readPreferences(), ...preferences, mode: state.mode, homeFilter: state.filter, selectedGame: state.selected })); return true; }
    catch { reportMobileStatus('This browser could not save your launcher preferences. They will apply for this visit.'); return false; }
  }
  function report(text) { if (byId('message').textContent !== text) byId('message').textContent = text; reportMobileStatus(text); }
  function themeFor(mode = state.mode) { return resolvedTheme(preferences.themePreferences[mode]); }
  function applyTheme() {
    const theme = themeFor();
    for (const key of ['canvas', 'surface', 'ink', 'muted', 'line', 'hover', 'accent']) document.documentElement.style.setProperty('--' + key, theme[key]);
    document.documentElement.style.setProperty('--accent-ink', theme.accentInk);
    document.documentElement.style.setProperty('--focus', theme.focus);
    document.documentElement.style.setProperty('--theme-glow', theme.glow ?? 'transparent');
    document.documentElement.style.setProperty('--theme-pattern', patternImages[theme.pattern]);
    document.documentElement.style.colorScheme = theme.night ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = theme.canvas;
    byId('mobile-theme-name').textContent = theme.name;
  }
  function runtimeReady() { return !!state.api && !importButton.disabled && !state.busy && byId('game').hidden; }
  function synchronize() {
    const ready = runtimeReady();
    for (const button of root.querySelectorAll('[data-add], [data-native-action]')) button.disabled = !ready;
    byId('mobile-play').disabled = !ready || !state.entries.some(entry => entry.id === state.selected && entry.playable);
    for (const button of root.querySelectorAll('[data-classic]')) button.disabled = byId('classic-mode').disabled || !state.api || state.busy;
    const cancel = byId('cancel-import'), localCancel = byId('mobile-cancel');
    localCancel.hidden = cancel.hidden; localCancel.disabled = cancel.disabled;
    if (!state.busy) reportMobileStatus(byId('message').textContent);
  }
  function filteredGames() {
    const query = byId('mobile-search').value.trim().toLocaleLowerCase();
    return state.entries.filter(entry => entry.playable && entry.name.toLocaleLowerCase().includes(query) &&
      (state.filter !== 'favorites' || preferences.favorites.includes(entry.id)) && (state.filter !== 'recent' || entry.lastPlayed))
      .sort(state.filter === 'recent' ? (a, b) => Date.parse(b.lastPlayed) - Date.parse(a.lastPlayed) : (a, b) => a.name.localeCompare(b.name));
  }
  function cover(entry) {
    return `<div class="cover"${entry.artwork ? ` data-artwork="${escape(entry.id)}"` : ''}><div class="cover-placeholder">${icon('library')}<small>${escape(entry.kind)}</small></div></div>`;
  }
  function watchArtwork() {
    observer?.disconnect();
    const target = state.page === 'library' ? byId('mobile-library') : state.page === 'detail' ? byId('mobile-detail') : null;
    for (const element of target?.querySelectorAll('[data-artwork]') ?? []) {
      if (observer) observer.observe(element); else queueArtwork(element);
    }
  }
  function queueArtwork(element) {
    artworkQueue.push(element); void drainArtwork();
  }
  async function drainArtwork() {
    if (artworkActive >= 4 || !artworkQueue.length || !state.api) return;
    const element = artworkQueue.shift();
    if (!element.isConnected) { void drainArtwork(); return; }
    const entry = state.entries.find(item => item.id === element.dataset.artwork);
    if (!entry?.artwork) { void drainArtwork(); return; }
    artworkActive++;
    try {
      const key = entry.id + ':' + entry.artwork;
      if (!artwork.has(key)) {
        if (artwork.size >= 48) artwork.delete(artwork.keys().next().value);
        artwork.set(key, Promise.resolve(state.api.MobileArtwork(entry.id)).catch(() => null));
      }
      const url = await artwork.get(key);
      if (url && element.isConnected && /^data:image\//i.test(url)) {
        const image = new Image(); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.src = url;
        element.replaceChildren(image);
      }
    } catch { /* Keep the original cover placeholder if artwork is unavailable. */ }
    finally { artworkActive--; void drainArtwork(); }
  }
  function renderLibrary() {
    const games = filteredGames(), isHome = state.mode === 'home';
    if (!games.some(entry => entry.id === state.selected)) state.selected = games[0]?.id ?? '';
    const index = Math.max(0, games.findIndex(entry => entry.id === state.selected));
    const start = Math.min(Math.max(0, index - 10), Math.max(0, games.length - 24));
    const visible = isHome ? games.slice(start, start + 24) : games.slice(0, state.limit);
    const grid = byId('mobile-games'); grid.className = isHome ? 'home-rail' : 'tiles'; grid.hidden = !games.length;
    grid.innerHTML = visible.map(entry => {
      const favorite = preferences.favorites.includes(entry.id);
      const caption = favorite ? 'Favorite' : entry.lastPlayed ? 'Recently played' : 'Imported on this device';
      return isHome ? `<button class="home-game${entry.id === state.selected ? ' selected' : ''}" data-game="${escape(entry.id)}" aria-label="${escape(entry.name)}" aria-pressed="${entry.id === state.selected}"><div class="home-card">${cover(entry)}<div class="home-caption"><h3>${escape(entry.name)}</h3><small>${caption}</small></div></div></button>`
        : `<button class="tile" data-game="${escape(entry.id)}" aria-label="Details for ${escape(entry.name)}">${cover(entry)}<h3>${escape(entry.name)}</h3><small>${caption}</small></button>`;
    }).join('');
    byId('mobile-title').textContent = isHome ? 'HOME' : 'Library';
    byId('mobile-count').textContent = state.loaded ? `${games.length} ${games.length === 1 ? 'game' : 'games'}` : 'Your library';
    for (const button of root.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
    const query = byId('mobile-search').value.trim().toLocaleLowerCase();
    const review = state.entries.filter(entry => !entry.playable && entry.name.toLocaleLowerCase().includes(query));
    byId('mobile-review-title').hidden = !review.length;
    byId('mobile-review').innerHTML = review.slice(0, state.limit).map(entry => `<button class="tile" data-review="${escape(entry.id)}" aria-label="Review ${escape(entry.name)}">${cover(entry)}<h3>${escape(entry.name)}</h3><small>${escape(entry.kind === 'Unidentified' ? 'Setup needed' : entry.kind)}</small></button>`).join('');
    const empty = byId('mobile-empty'); empty.hidden = games.length > 0 || review.length > 0;
    const filtering = state.filter !== 'all' || !!query;
    empty.querySelector('strong').textContent = !state.loaded ? 'Your library' : filtering ? 'No games in this view' : 'No games yet';
    empty.querySelector('p').textContent = !state.loaded ? 'Your games will appear here when NX Infinity is ready.' : filtering ? 'Return to all games or change your search.' : 'Import your own files from your device.';
    empty.querySelector('[data-add]').hidden = filtering;
    byId('mobile-clear-filter').hidden = !filtering;
    byId('mobile-selected').hidden = !isHome || !games.length;
    byId('mobile-position').textContent = games.length ? `${index + 1} / ${games.length}` : '';
    byId('mobile-previous').disabled = !index; byId('mobile-next').disabled = index >= games.length - 1;
    byId('mobile-more').hidden = (isHome || games.length <= state.limit) && review.length <= state.limit;
    for (const card of grid.querySelectorAll('[data-game]')) card.onclick = () => {
      if (!isHome || state.selected === card.dataset.game) openDetails(card.dataset.game);
      else { state.selected = card.dataset.game; persist(); renderLibrary(); centerSelected(); }
    };
    for (const card of byId('mobile-review').querySelectorAll('[data-review]')) card.onclick = () => openDetails(card.dataset.review);
    synchronize(); watchArtwork();
  }
  function centerSelected() { byId('mobile-games').querySelector('.selected')?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'auto' }); }
  function moveSelection(delta) {
    const games = filteredGames(), index = games.findIndex(entry => entry.id === state.selected);
    const next = games[Math.max(0, Math.min(games.length - 1, index + delta))];
    if (next) { state.selected = next.id; persist(); renderLibrary(); centerSelected(); byId('mobile-games').querySelector('.selected')?.focus({ preventScroll: true }); }
  }
  function openDetails(id) { state.detailId = id; showPage('detail'); }
  function renderDetails() {
    const entry = state.entries.find(item => item.id === state.detailId), target = byId('mobile-detail');
    if (!entry) { target.innerHTML = '<div class="page-heading"><button class="back-button" data-detail-back aria-label="Back to library">‹</button><h1>Game details</h1></div><p class="page-intro">This file is no longer in the library.</p>'; target.querySelector('[data-detail-back]').onclick = () => showPage('library'); return; }
    const favorite = preferences.favorites.includes(entry.id);
    let lastPlayed = 'Not played';
    if (entry.lastPlayed && Number.isFinite(Date.parse(entry.lastPlayed))) lastPlayed = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(entry.lastPlayed));
    target.innerHTML = `<div class="page-heading"><button class="back-button" data-detail-back aria-label="Back to library">‹</button><span>Library</span></div><div class="detail-layout"><div class="detail-art">${cover(entry)}</div><div><div class="detail-title"><div><div class="eyebrow">IMPORTED ON THIS DEVICE</div><h1>${escape(entry.name)}</h1></div><button class="favorite-button" data-favorite aria-label="${favorite ? 'Remove favorite' : 'Add favorite'}" aria-pressed="${favorite}">${icon(favorite ? 'check' : 'heart')}</button></div><div class="meta-grid"><div><small>CONTENT</small><span>${escape(entry.kind)}</span></div><div><small>LAST PLAYED</small><span>${escape(lastPlayed)}</span></div></div><div class="detail-actions"><button class="primary" data-native-action data-entry-action disabled>${icon(entry.playable ? 'play' : 'library')}${entry.playable ? 'Play' : 'Check file'}</button><button class="secondary" data-detail-setup>Console setup</button></div>${entry.playable ? '' : '<p class="detail-note">This file needs review before it can be launched. Check the file or open Console setup.</p>'}</div></div>`;
    target.querySelector('[data-detail-back]').onclick = () => showPage('library');
    target.querySelector('[data-detail-setup]').onclick = () => byId('setup-dialog').showModal();
    target.querySelector('[data-favorite]').onclick = () => {
      preferences.favorites = favorite ? preferences.favorites.filter(id => id !== entry.id) : [...preferences.favorites, entry.id];
      persist(); renderDetails();
    };
    target.querySelector('[data-entry-action]').onclick = () => runEntry(entry);
    synchronize(); watchArtwork();
  }
  async function runEntry(entry) {
    if (!entry || !runtimeReady()) return;
    state.busy = true; synchronize(); report((entry.playable ? 'Starting ' : 'Checking ') + entry.name + '…');
    try {
      if (entry.playable) { await state.api.Play(entry.id); report('Playing ' + entry.name); }
      else { await state.api.InspectMobileContent(entry.id); await refresh(true); report('File checked.'); }
    } catch (error) {
      report(error.message || String(error));
      if (!entry.playable) { byId('setup-message').textContent = error.message || String(error); byId('setup-dialog').showModal(); }
    } finally { state.busy = false; synchronize(); }
  }
  function renderThemes() {
    for (const button of root.querySelectorAll('[data-theme-mode]')) button.setAttribute('aria-pressed', String(button.dataset.themeMode === state.mode));
    const selected = themeFor().id;
    const choice = preferences.themePreferences[state.mode], favorites = preferences.themePreferences.favorites;
    const filter = byId('theme-category').value, query = byId('theme-search').value.trim().toLowerCase();
    const visible = themes.filter(t => (!query || t.name.toLowerCase().includes(query)) && (filter === 'All' || filter === t.category || filter === 'Favorites' && favorites.includes(t.id) || filter === 'Dark' && t.night || filter === 'Light' && !t.night));
    byId('theme-count').textContent = `${visible.length} of ${themes.length} desktop themes`;
    byId('theme-accent').value = themeFor().accent;
    byId('theme-pattern').value = choice.pattern;
    byId('theme-favorite').textContent = favorites.includes(selected) ? 'Remove favorite' : 'Favorite this theme';
    byId('theme-saved').innerHTML = '<option value="">Saved themes</option>' + preferences.themePreferences.saved.map((t, i) => `<option value="${i}">${escape(t.name)}</option>`).join('');
    byId('mobile-theme-grid').innerHTML = visible.map(theme => `<button class="theme-card" data-theme="${theme.id}" aria-pressed="${theme.id === selected}"><span class="theme-preview" style="background:${theme.canvas};--sample-ink:${theme.ink};--sample-accent:${theme.accent}"></span>${escape(theme.name)}${favorites.includes(theme.id) ? ' ♥' : ''}</button>`).join('');
    for (const button of byId('mobile-theme-grid').querySelectorAll('[data-theme]')) button.onclick = () => {
      preferences[state.mode === 'home' ? 'homeTheme' : 'desktopTheme'] = button.dataset.theme;
      preferences.themePreferences[state.mode] = { ...choice, preset: button.dataset.theme, accent: null };
      persist(); applyTheme(); renderThemes();
    };
  }
  function updateAppearance() { persist(); applyTheme(); renderThemes(); }
  byId('theme-category').onchange = renderThemes;
  byId('theme-search').oninput = renderThemes;
  byId('theme-pattern').innerHTML = patterns.map(p => `<option>${p}</option>`).join('');
  byId('theme-pattern').onchange = event => { preferences.themePreferences[state.mode].pattern = event.target.value; updateAppearance(); };
  byId('theme-accent').onchange = event => { preferences.themePreferences[state.mode].accent = event.target.value; updateAppearance(); };
  byId('theme-reset-accent').onclick = () => { preferences.themePreferences[state.mode].accent = null; updateAppearance(); };
  byId('theme-favorite').onclick = () => {
    const id = themeFor().id, list = preferences.themePreferences.favorites;
    preferences.themePreferences.favorites = list.includes(id) ? list.filter(t => t !== id) : [...list, id]; updateAppearance();
  };
  byId('theme-save-form').onsubmit = event => {
    event.preventDefault(); const name = byId('theme-save-name').value.trim().slice(0, 32);
    if (!name) return;
    const list = preferences.themePreferences.saved, index = list.findIndex(t => t.name === name);
    const item = { name, choice: { ...preferences.themePreferences[state.mode] } };
    if (index >= 0) list[index] = item;
    else if (list.length < 16) list.push(item);
    else { report('You can save up to 16 themes. Remove a saved theme first.'); return; }
    updateAppearance(); report('Theme saved.');
  };
  byId('theme-saved').onchange = event => { const item = preferences.themePreferences.saved[Number(event.target.value)]; if (event.target.value !== '' && item) { preferences.themePreferences[state.mode] = { ...item.choice }; byId('theme-save-name').value = item.name; updateAppearance(); } };
  byId('theme-delete-saved').onclick = () => { const name = byId('theme-save-name').value.trim(); preferences.themePreferences.saved = preferences.themePreferences.saved.filter(t => t.name !== name); updateAppearance(); };
  byId('theme-export').onclick = () => downloadJson('nxi-themes.json', desktopThemeFile(preferences.themePreferences));
  byId('theme-import').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 1024 * 1024) throw new Error('Theme files must be smaller than 1 MiB.');
      const value = JSON.parse(await file.text());
      if (!value || typeof value !== 'object' || !(value.home || value.Home || value.desktop || value.Desktop)) throw new Error('Choose an NXI theme preferences export.');
      preferences.themePreferences = normalizeThemes(value); updateAppearance(); report('Desktop theme preferences imported.');
    } catch (error) { report(error.message); } finally { event.target.value = ''; }
  };
  async function loadCharacters() {
    if (characters.loaded) return;
    if (characters.loading) return characters.loading;
    characters.error = '';
    const loading = (async () => {
      try {
        [characters.categories, characters.items] = await Promise.all([avatarCategories(), avatarItems('', 'characters')]);
        if (characters.category && !characters.categories.some(category => category.id === characters.category))
          characters.category = characters.categories.some(category => category.id === 'super-mario-odyssey') ? 'super-mario-odyssey' : '';
        characters.loaded = true;
      } catch (error) {
        characters.error = (error.message || String(error)) + ' Your saved character is still available.';
      }
    })();
    characters.loading = loading; renderCharacters();
    try { await loading; }
    finally { characters.loading = null; if (state.page === 'profile') renderCharacters(); }
  }
  function renderCharacters() {
    const list = characters.items.filter(item => item.part === 'characters' &&
      (characters.favoritesOnly ? preferences.avatarFavorites.includes(item.id) : !characters.category || item.collection === characters.category) &&
      item.search.toLocaleLowerCase().includes(characters.query.toLocaleLowerCase()));
    const pages = Math.max(1, Math.ceil(list.length / 12)); characters.page = Math.min(characters.page, pages - 1);
    const chosen = characters.items.find(item => item.id === characters.pending);
    // A committed character uses its saved data URL even when the catalog is
    // available. Reopening the profile offline must not re-fetch that picture.
    const preview = byId('profile-preview');
    preview.crossOrigin = 'anonymous'; preview.src = chosen?.url ?? avatarUrl(preferences.avatar);
    byId('avatar-browse').setAttribute('aria-pressed', String(!characters.favoritesOnly));
    byId('avatar-favorites').setAttribute('aria-pressed', String(characters.favoritesOnly));
    const collection = byId('avatar-category');
    collection.innerHTML = '<option value="">All collections</option>' + characters.categories.map(category => `<option value="${escape(category.id)}">${escape(category.name.replace(/\b\w/g, letter => letter.toUpperCase()))}</option>`).join('');
    collection.value = characters.category;
    if (byId('avatar-search').value !== characters.query) byId('avatar-search').value = characters.query;
    byId('avatar-message').textContent = characters.error || (characters.loading ? 'Loading character collections…' : '');
    byId('avatar-message').hidden = !characters.error && !characters.loading;
    byId('avatar-retry').hidden = !characters.error;
    const selection = characters.pending ?? preferences.avatarId;
    byId('avatar-grid').innerHTML = list.slice(characters.page * 12, characters.page * 12 + 12).map(item => {
      const favorite = preferences.avatarFavorites.includes(item.id);
      const url = item.id === preferences.avatarId && preferences.avatar ? avatarUrl(preferences.avatar) : item.url;
      return `<div class="avatar-choice"><button data-avatar="${escape(item.id)}" aria-label="Select ${escape(item.name)}" aria-pressed="${selection === item.id}"${characters.saving ? ' disabled' : ''}><img src="${escape(url)}" crossorigin="anonymous" loading="lazy" decoding="async" alt="${escape(item.name)}"></button><button class="avatar-favorite" data-avatar-favorite="${escape(item.id)}" aria-label="Favorite ${escape(item.name)}" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button></div>`;
    }).join('');
    byId('avatar-empty').hidden = list.length > 0 || !characters.loaded;
    byId('avatar-empty').textContent = characters.query ? 'No matching characters. Try another search.' : characters.favoritesOnly ? 'No favorites here yet. Add favorites from Browse.' : 'No characters in this collection.';
    byId('avatar-position').textContent = `${characters.page + 1} / ${pages}`;
    byId('avatar-previous').disabled = characters.page === 0;
    byId('avatar-next').disabled = characters.page >= pages - 1;
    byId('use-character').disabled = !characters.pending || characters.saving;
    byId('use-character').textContent = characters.saving ? 'Saving character…' : 'Use character';
    byId('avatar-count').textContent = `Characters only · ${list.length} in this view`;
    for (const button of byId('avatar-grid').querySelectorAll('[data-avatar]')) button.onclick = () => {
      if (characters.saving) return;
      characters.pending = button.dataset.avatar; renderCharacters();
    };
    for (const button of byId('avatar-grid').querySelectorAll('[data-avatar-favorite]')) button.onclick = () => {
      const id = button.dataset.avatarFavorite;
      preferences.avatarFavorites = preferences.avatarFavorites.includes(id) ? preferences.avatarFavorites.filter(value => value !== id) : [...preferences.avatarFavorites, id];
      persist(); renderCharacters();
    };
  }
  async function useCharacter() {
    const item = characters.items.find(item => item.id === characters.pending);
    if (!item || characters.saving) return;
    characters.saving = true; renderCharacters();
    try {
      const data = await avatarData(item);
      preferences.avatar = data; preferences.avatarId = item.id;
      const saved = persist();
      if (saved) { characters.pending = null; report('Character saved on this device.'); }
      updateHeader();
    } catch (error) { report(error.message || String(error)); }
    finally { characters.saving = false; if (state.page === 'profile') renderCharacters(); }
  }
  function updateHeader() {
    root.dataset.mode = state.mode;
    byId('mobile-mode-label').textContent = state.mode === 'home' ? 'HOME' : 'Library';
    byId('mobile-avatar').src = avatarUrl(preferences.avatar);
    byId('mobile-profile').setAttribute('aria-label', `${preferences.profileName || 'Player'} · launcher profile`);
    byId('mobile-profile-name').textContent = preferences.profileName || 'Player';
    byId('mobile-default-mode').value = preferences.defaultMode;
    for (const button of root.querySelectorAll('.home-dock button')) {
      const current = ['library', 'detail'].includes(state.page) ? button.dataset.tab === (state.mode === 'home' ? 'home' : 'library') : button.dataset.page === 'settings';
      if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    applyTheme();
  }
  function showPage(page) {
    state.page = page;
    for (const [key, id] of Object.entries({ library: 'mobile-library', detail: 'mobile-detail', settings: 'mobile-settings', themes: 'mobile-themes', profile: 'mobile-profile-page' })) byId(id).hidden = key !== page;
    main.scrollTop = 0; updateHeader();
    if (page === 'library') { renderLibrary(); if (state.mode === 'home') centerSelected(); }
    else if (page === 'detail') renderDetails();
    else if (page === 'themes') renderThemes();
    else if (page === 'profile') { byId('profile-name').value = preferences.profileName; renderCharacters(); void loadCharacters(); }
    synchronize();
  }
  async function refresh(force = false) {
    if (!state.api) return;
    if (state.refreshing) { await state.refreshing; if (!force) return; }
    const work = (async () => {
      try {
        const json = await state.api.MobileLibrary();
        if (force || json !== state.signature) {
          const entries = JSON.parse(json);
          if (!Array.isArray(entries) || entries.some(entry => typeof entry?.id !== 'string' || typeof entry.name !== 'string')) throw new Error('NXI could not read the game library.');
          state.entries = entries.slice(0, 2000); state.signature = json; state.loaded = true;
          renderLibrary(); if (state.page === 'detail') renderDetails();
        }
      } catch (error) { report(error.message || String(error)); }
    })();
    state.refreshing = work;
    try { await work; } finally { if (state.refreshing === work) state.refreshing = null; }
  }
  function startRefresh() {
    if (!state.timer && state.api) state.timer = setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
  }

  for (const button of root.querySelectorAll('[data-add]')) button.onclick = () => { if (runtimeReady()) byId('file').click(); };
  for (const button of root.querySelectorAll('[data-tab]')) button.onclick = () => { state.mode = button.dataset.tab === 'home' ? 'home' : 'desktop'; persist(); showPage('library'); };
  for (const button of root.querySelectorAll('[data-page]')) button.onclick = () => showPage(button.dataset.page);
  for (const button of root.querySelectorAll('[data-back]')) button.onclick = () => showPage('library');
  for (const button of root.querySelectorAll('[data-filter]')) button.onclick = () => { state.filter = button.dataset.filter; state.limit = 60; persist(); renderLibrary(); };
  for (const button of root.querySelectorAll('[data-setup]')) button.onclick = () => byId('setup-dialog').showModal();
  for (const button of root.querySelectorAll('[data-classic]')) button.onclick = () => { if (!byId('classic-mode').disabled) byId('classic-mode').click(); };
  for (const button of root.querySelectorAll('[data-theme-mode]')) button.onclick = () => { state.mode = button.dataset.themeMode; updateHeader(); renderThemes(); };
  byId('mobile-setup').onclick = () => byId('setup-dialog').showModal();
  byId('mobile-brand').onclick = () => showPage('library');
  byId('mobile-profile').onclick = () => showPage('profile');
  byId('mobile-search-toggle').onclick = () => {
    const search = byId('mobile-search'); search.hidden = !search.hidden;
    byId('mobile-search-toggle').setAttribute('aria-expanded', String(!search.hidden));
    if (!search.hidden) search.focus(); else { search.value = ''; renderLibrary(); }
  };
  byId('mobile-search').oninput = () => { state.limit = 60; renderLibrary(); };
  byId('mobile-clear-filter').onclick = () => { state.filter = 'all'; byId('mobile-search').value = ''; persist(); renderLibrary(); };
  byId('mobile-previous').onclick = () => moveSelection(-1); byId('mobile-next').onclick = () => moveSelection(1);
  byId('mobile-games').onkeydown = event => {
    if (state.mode === 'home' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); moveSelection(event.key === 'ArrowLeft' ? -1 : 1); }
  };
  byId('mobile-details').onclick = () => openDetails(state.selected);
  byId('mobile-play').onclick = () => runEntry(state.entries.find(entry => entry.id === state.selected));
  byId('mobile-more').onclick = () => { state.limit += 60; renderLibrary(); };
  byId('mobile-cancel').onclick = () => byId('cancel-import').click();
  byId('mobile-retry').onclick = () => location.reload();
  byId('mobile-default-mode').onchange = event => { preferences.defaultMode = event.target.value; persist(); };
  byId('classic-mode').onclick = () => { if (byId('classic-mode').disabled || !state.api) return; document.body.classList.add('classic'); byId('setup-dialog').close(); };
  byId('classic-return').onclick = () => { document.body.classList.remove('classic'); void refresh(true); };
  byId('profile-form').onsubmit = event => {
    event.preventDefault(); preferences.profileName = byId('profile-name').value.trim().slice(0, 40) || 'Player';
    const saved = persist(); updateHeader(); if (saved) report('Display name saved.');
  };
  byId('avatar-category').onchange = event => {
    characters.category = event.target.value; preferences.avatarCategory = characters.category;
    characters.query = ''; characters.favoritesOnly = false; characters.page = 0; persist(); renderCharacters();
  };
  byId('avatar-search').oninput = event => { characters.query = event.target.value; characters.page = 0; renderCharacters(); };
  byId('avatar-browse').onclick = () => { characters.favoritesOnly = false; characters.page = 0; renderCharacters(); };
  byId('avatar-favorites').onclick = () => { characters.favoritesOnly = true; characters.page = 0; renderCharacters(); };
  byId('avatar-previous').onclick = () => { characters.page = Math.max(0, characters.page - 1); renderCharacters(); };
  byId('avatar-next').onclick = () => { characters.page++; renderCharacters(); };
  byId('avatar-retry').onclick = () => { void loadCharacters(); };
  byId('use-character').onclick = useCharacter;
  const mutations = new MutationObserver(synchronize);
  mutations.observe(byId('tools'), { subtree: true, childList: true, characterData: true, attributes: true });
  mutations.observe(byId('classic-mode'), { attributes: true, attributeFilter: ['disabled'] });
  mutations.observe(byId('game'), { attributes: true, attributeFilter: ['hidden'] });
  const clock = () => { const now = new Date(); byId('mobile-clock').textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now); byId('mobile-clock').dateTime = now.toISOString(); };
  clock(); let clockTimer = setInterval(clock, 60000);
  addEventListener('pagehide', () => { clearInterval(state.timer); state.timer = null; clearInterval(clockTimer); clockTimer = null; });
  addEventListener('pageshow', () => { startRefresh(); if (!clockTimer) clockTimer = setInterval(clock, 60000); clock(); void refresh(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clock(); void refresh(); } });
  shell = { refresh, attach(api) { state.api = api; startRefresh(); synchronize(); void refresh(true); void coreSettings.refresh(); return shell; } };
  showPage('library');
  return shell;
}

export function startMobile(api) { return initializeMobileShell().attach(api); }
