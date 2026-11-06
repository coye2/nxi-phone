// Same image source as NXI; pinned paths avoid runtime GitHub API limits.
export const AVATAR_REPOSITORY = 'henry-debruin/nso-icons';
export const validImagePath = p => typeof p === 'string' && p.length <= 220 && !p.includes('..') && /^[a-z0-9-]+\/(characters|backgrounds|frames|mii)\/[A-Za-z0-9_. -]+\.(png|jpg|jpeg)$/i.test(p);
let catalog;
async function source() {
  return catalog ??= fetch(new URL('./avatar-catalog.json', import.meta.url)).then(r => { if (!r.ok) throw Error('Avatar catalog could not load.'); return r.json(); }).then(c => ({...c, paths: c.paths.filter(validImagePath)})).catch(e => { catalog = null; throw e; });
}
export async function avatarCategories() {
  const {paths} = await source();
  return [...new Set(paths.map(p => p.split('/')[0]))].sort().map(id => ({id, name: id.replaceAll('-', ' ')}));
}
export async function avatarItems(category = '', part = 'characters') {
  const c = await source();
  return c.paths.filter(p => (!category || p.startsWith(category + '/')) && (!part || p.split('/')[1] === part)).map(id => {
    const [collection, layer, file] = id.split('/');
    return {id, collection, part: layer, name: file.replace(/\.[^.]+$/, ''), search: collection.replaceAll('-', ' ') + ' ' + file, url: 'https://raw.githubusercontent.com/' + AVATAR_REPOSITORY + '/' + c.commit + '/' + id.split('/').map(encodeURIComponent).join('/')};
  });
}
export async function avatarData(item) {
  if (!validImagePath(item.id)) throw Error('Invalid avatar.');
  const r = await fetch(item.url, {mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(15000)});
  if (!r.ok || +(r.headers.get('Content-Length') ?? 0) > 8388608) throw Error('Avatar download failed.');
  const blob = await r.blob();
  if (blob.size > 8388608) throw Error('Avatar exceeds 8 MB.');
  return imageData(blob);
}
export async function imageData(blob) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 8388608) throw Error('Choose a PNG, JPEG or WebP smaller than 8 MB.');
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > 25000000) { bitmap.close(); throw Error('Image resolution is too large.'); }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
  const c = canvas.getContext('2d'), scale = Math.min(192 / bitmap.width, 192 / bitmap.height);
  c.drawImage(bitmap, (192 - bitmap.width * scale) / 2, (192 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  bitmap.close(); return canvas.toDataURL('image/png');
}
