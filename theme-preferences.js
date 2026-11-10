import { themes } from './brand-theme.js';

export const patterns = ['Plain', 'Dots', 'Grid', 'Orbits', 'Stripes', 'Checker', 'Stars', 'Waves', 'Triangles', 'Pixels'];
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
const get = (object, key) => object?.[key] ?? object?.[key[0].toUpperCase() + key.slice(1)];
export function validChoice(value, fallback = 'dune') {
  const preset = get(value, 'preset');
  return { preset: themes.some(t => t.id === preset) ? preset : fallback, accent: color(get(value, 'accent')), pattern: patterns.includes(get(value, 'pattern')) ? get(value, 'pattern') : 'Plain' };
}
export function normalizeThemes(value = {}) {
  return { version: 1, desktop: validChoice(get(value, 'desktop')), home: validChoice(get(value, 'home'), 'home'),
    favorites: [...new Set((Array.isArray(get(value, 'favorites')) ? get(value, 'favorites') : []).filter(id => themes.some(t => t.id === id)))],
    saved: (Array.isArray(get(value, 'saved')) ? get(value, 'saved') : []).filter(t => typeof get(t, 'name') === 'string' && get(t, 'name').trim()).slice(0, 16).map(t => ({ name: get(t, 'name').trim().slice(0, 32), choice: validChoice(get(t, 'choice')) })) };
}
export function desktopThemeFile(value) {
  const p = normalizeThemes(value), choice = c => ({ Preset: c.preset, Accent: c.accent, Pattern: c.pattern });
  return { Version: 1, Desktop: choice(p.desktop), Home: choice(p.home), Favorites: p.favorites, Saved: p.saved.map(t => ({ Name: t.name, Choice: choice(t.choice) })) };
}
export function contrast(a, b) {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function resolvedTheme(choice) {
  const safe = validChoice(choice), preset = themes.find(t => t.id === safe.preset), accent = safe.accent ?? preset.accent;
  return { ...preset, accent, pattern: safe.pattern, accentInk: contrast(accent, '#ffffff') > contrast(accent, '#181818') ? '#ffffff' : '#181818', focus: contrast(accent, preset.canvas) >= 3 ? accent : preset.ink };
}
export const patternImages = {
  Plain: 'none', Dots: 'radial-gradient(var(--pattern-ink) 1px, transparent 1px)',
  Grid: 'linear-gradient(var(--pattern-ink) 1px, transparent 1px),linear-gradient(90deg,var(--pattern-ink) 1px,transparent 1px)',
  Orbits: 'repeating-radial-gradient(circle at center,transparent 0 7px,var(--pattern-ink) 8px 9px,transparent 10px 16px)',
  Stripes: 'repeating-linear-gradient(45deg,transparent 0 10px,var(--pattern-ink) 10px 11px,transparent 11px 20px)',
  Checker: 'conic-gradient(var(--pattern-ink) 25%,transparent 0 50%,var(--pattern-ink) 0 75%,transparent 0)',
  Stars: 'radial-gradient(ellipse 1px 5px at center,var(--pattern-ink) 90%,transparent),radial-gradient(ellipse 5px 1px at center,var(--pattern-ink) 90%,transparent)',
  Waves: 'repeating-radial-gradient(ellipse at 50% 100%,transparent 0 6px,var(--pattern-ink) 7px 8px,transparent 9px 15px)',
  Triangles: 'conic-gradient(from 30deg at 50% 75%,transparent 0 300deg,var(--pattern-ink) 0)',
  Pixels: 'conic-gradient(at 25% 25%,var(--pattern-ink) 25%,transparent 0)',
};

export function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
