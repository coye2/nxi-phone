// Firmware comes in many shapes: a ZIP from any tool (subfolders, readmes, __MACOSX, Windows
// paths), loose .nca files, or a dumped folder with NCAs split into 00/01/... parts. The native
// installer only reads one shape, so whatever the user picks is rewritten here, streaming, into a
// clean uncompressed ZIP with <id>.nca / <id>.cnmt.nca at the root. Everything else is skipped.
const NCA = /^([0-9a-f]{32})(\.cnmt)?\.nca$/i;
const MAX_TOTAL = 512 * 1024 * 1024;

export class FirmwareError extends Error {}

// Where a path lands in the clean package, or null for anything that isn't firmware.
export function ncaTarget(path) {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  if (!parts.length || parts.includes('__MACOSX')) return null;
  const leaf = parts[parts.length - 1];
  if (leaf.startsWith('._')) return null;
  if (NCA.test(leaf)) return { name: leaf.toLowerCase(), part: -1 };
  if (/^\d{2}$/.test(leaf) && parts.length > 1 && NCA.test(parts[parts.length - 2]))
    return { name: parts[parts.length - 2].toLowerCase(), part: Number(leaf) };
  return null;
}

async function bytes(blob, start, end) { return new Uint8Array(await blob.slice(start, end).arrayBuffer()); }
const u16 = (b, o) => b[o] | b[o + 1] << 8;
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

async function sniff(file) {
  const head = await bytes(file, 0, 8);
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('Rar!')) throw new FirmwareError('This is a RAR archive (WinRAR), not a ZIP. Unpack it first, then pick the .nca files or the firmware folder. Or re-pack it as a ZIP.');
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) throw new FirmwareError('This is a 7-Zip archive. Unpack it first, then pick the .nca files or the firmware folder. Or re-pack it as a ZIP.');
  return head[0] === 0x50 && head[1] === 0x4b;
}

// Entries of a ZIP, read from its central directory without loading the whole file.
export async function zipEntries(file) {
  const tailStart = Math.max(0, file.size - 65557), tail = await bytes(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new FirmwareError('This ZIP is damaged or incomplete. Download it again, or pick the unpacked .nca files instead.');
  let count = u16(tail, eocd + 10), size = u32(tail, eocd + 12), offset = u32(tail, eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || u32(tail, locator) !== 0x07064b50) throw new FirmwareError('This ZIP is damaged or incomplete.');
    const z = await bytes(file, u64(tail, locator + 8), u64(tail, locator + 8) + 56);
    if (u32(z, 0) !== 0x06064b50) throw new FirmwareError('This ZIP is damaged or incomplete.');
    count = u64(z, 32); size = u64(z, 40); offset = u64(z, 48);
  }
  const cd = await bytes(file, offset, offset + size), entries = [], decoder = new TextDecoder();
  for (let p = 0, i = 0; i < count; i++) {
    if (u32(cd, p) !== 0x02014b50) throw new FirmwareError('This ZIP is damaged or incomplete.');
    const flags = u16(cd, p + 8), method = u16(cd, p + 10), nameLength = u16(cd, p + 28), extraLength = u16(cd, p + 30), commentLength = u16(cd, p + 32);
    let compressed = u32(cd, p + 20), length = u32(cd, p + 24), local = u32(cd, p + 42);
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLength));
    for (let e = p + 46 + nameLength, end = e + extraLength; e + 4 <= end; e += 4 + u16(cd, e + 2)) {
      if (u16(cd, e) !== 1) continue;
      let q = e + 4;
      if (length === 0xffffffff) { length = u64(cd, q); q += 8; }
      if (compressed === 0xffffffff) { compressed = u64(cd, q); q += 8; }
      if (local === 0xffffffff) local = u64(cd, q);
    }
    entries.push({ name, flags, method, compressed, length, local, directory: name.endsWith('/') || name.endsWith('\\') });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entrySource(file, entry) {
  return {
    path: entry.name, length: entry.length,
    async open() {
      if (entry.flags & 1) throw new FirmwareError('This ZIP is password protected. Re-pack it without a password.');
      if (entry.method !== 0 && entry.method !== 8)
        throw new FirmwareError(`This ZIP uses a compression type the browser can't read (method ${entry.method}). Re-pack it as a normal ZIP, or pick the unpacked .nca files.`);
      const header = await bytes(file, entry.local, entry.local + 30);
      if (u32(header, 0) !== 0x04034b50) throw new FirmwareError('This ZIP is damaged or incomplete.');
      const start = entry.local + 30 + u16(header, 26) + u16(header, 28);
      const stream = file.slice(start, start + entry.compressed).stream();
      return entry.method === 8 ? stream.pipeThrough(new DecompressionStream('deflate-raw')) : stream;
    }
  };
}

// Every firmware NCA in the picked files, with split parts gathered in order.
export async function collectFirmware(files) {
  const sources = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (/\.zip$/i.test(file.name) || (!ncaTarget(path) && file.size >= 22 && await sniff(file))) {
      await sniff(file);
      for (const entry of await zipEntries(file)) if (!entry.directory) sources.push(entrySource(file, entry));
    } else if (/\.(rar|7z)$/i.test(file.name)) await sniff(file);
    else sources.push({ path, length: file.size, open: async () => file.stream() });
  }
  const ncas = new Map();
  for (const source of sources) {
    const target = ncaTarget(source.path);
    if (!target) continue;
    const nca = ncas.get(target.name) ?? { name: target.name, whole: null, parts: [] };
    if (target.part < 0) { if (!nca.whole) nca.whole = source; }
    else nca.parts[target.part] = source;
    ncas.set(target.name, nca);
  }
  const list = [];
  for (const nca of ncas.values()) {
    const parts = nca.whole ? [nca.whole] : nca.parts;
    if (!nca.whole && (!parts.length || Array.from(parts).some(p => !p)))
      throw new FirmwareError(`Part of ${nca.name} is missing. Pick the whole ${nca.name} folder.`);
    list.push({ name: nca.name, parts, length: parts.reduce((sum, p) => sum + p.length, 0) });
  }
  if (list.length < 3) throw new FirmwareError('No firmware found in what you picked. Pick the firmware ZIP, the folder, or all of its .nca files.');
  list.sort((a, b) => a.name < b.name ? -1 : 1);
  const total = list.reduce((sum, n) => sum + n.length, 0);
  if (total > MAX_TOTAL) throw new FirmwareError('This firmware is larger than the browser limit of 512 MiB.');
  return { ncas: list, total };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
function crc32(crc, chunk) { crc = ~crc >>> 0; for (let i = 0; i < chunk.length; i++) crc = CRC[(crc ^ chunk[i]) & 0xff] ^ crc >>> 8; return ~crc >>> 0; }
function le(size, ...values) { const out = new Uint8Array(size), view = new DataView(out.buffer); let o = 0; for (const [bytes, v] of values) { if (bytes === 2) view.setUint16(o, v, true); else view.setUint32(o, v, true); o += bytes; } return out; }

// Write the clean package (stored, no compression) through write(Uint8Array). Returns its size.
export async function writeFirmwareZip({ ncas, total }, write, { signal, onProgress = () => {} } = {}) {
  const encoder = new TextEncoder(), central = [];
  let offset = 0, done = 0;
  const put = async chunk => { await write(chunk); offset += chunk.length; };
  for (const nca of ncas) {
    const name = encoder.encode(nca.name), start = offset;
    await put(le(30, [4, 0x04034b50], [2, 20], [2, 8], [2, 0], [2, 0], [2, 0], [4, 0], [4, 0], [4, 0], [2, name.length], [2, 0]));
    await put(name);
    let crc = 0, length = 0;
    for (const part of nca.parts) {
      const reader = (await part.open()).getReader();
      try {
        for (;;) {
          signal?.throwIfAborted();
          const { done: end, value } = await reader.read();
          if (end) break;
          crc = crc32(crc, value); length += value.length; done += value.length;
          await put(value); onProgress(done, total);
        }
      } finally { reader.releaseLock(); }
    }
    if (length !== nca.length) throw new FirmwareError(`${nca.name} did not unpack to its expected size. The archive may be damaged.`);
    await put(le(16, [4, 0x08074b50], [4, crc], [4, length], [4, length]));
    central.push({ name, crc, length, start });
  }
  const cdStart = offset;
  for (const e of central) {
    await put(le(46, [4, 0x02014b50], [2, 20], [2, 20], [2, 8], [2, 0], [2, 0], [2, 0], [4, e.crc], [4, e.length], [4, e.length], [2, e.name.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, e.start]));
    await put(e.name);
  }
  await put(le(22, [4, 0x06054b50], [2, 0], [2, 0], [2, central.length], [2, central.length], [4, offset - cdStart], [4, cdStart], [2, 0]));
  return offset;
}
