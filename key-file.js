// Format metadata only. Never log source text, values, or native parser errors.
// Sizes and ranges mirror the vendored LibHac DefaultKeySet.CreateKeyList,
// KeyInfo.Matches and Crypto/KeyTypes.cs. RSA keypairs are 0x210 bytes.
export const MAX_KEY_FILE_BYTES = 1024 * 1024;
const singles = new Map(`
  secure_boot_key tsec_key device_key keyblob_mac_key_source mariko_bek mariko_kek
  master_key_source package2_key_source bis_kek_source per_console_key_source
  retail_specific_aes_key_source aes_kek_generation_source aes_key_generation_source
  titlekek_source header_kek_source key_area_key_application_source
  key_area_key_ocean_source key_area_key_system_source save_mac_kek_source
  save_mac_key save_mac_key_source save_mac_sd_card_kek_source
  save_mac_sd_card_key_source save_mac_sd_card_key sd_seed sd_card_kek_source
  xci_header_key eticket_rsa_kek ssl_rsa_kek
`.trim().split(/\s+/).map(name => [name, 32]));
for (const name of ['header_key_source', 'header_key', 'sd_card_save_key_source',
  'sd_card_nca_key_source', 'sd_card_custom_storage_key_source']) singles.set(name, 64);
singles.set('eticket_rsa_keypair', 1056);
const ranges = new Map([
  ['tsec_secret', 0, 0x40, 32],
  ...['tsec_root_kek', 'package1_mac_kek', 'package1_kek', 'tsec_auth_signature',
    'tsec_root_key'].map(name => [name, 0, 8, 32]),
  ...['keyblob_key_source', 'keyblob_key', 'keyblob_mac_key'].map(name => [name, 0, 6, 32]),
  ['encrypted_keyblob', 0, 6, 352], ['keyblob', 0, 6, 288],
  ['master_kek_source', 6, 0x20, 32], ['mariko_aes_class_key', 0, 0x0c, 32],
  ...['mariko_master_kek_source', 'master_kek', 'master_key', 'package1_key',
    'package2_key', 'titlekek', 'key_area_key_application', 'key_area_key_ocean',
    'key_area_key_system'].map(name => [name, 0, 0x20, 32]),
  ['package1_mac_key', 6, 0x20, 32],
  ['bis_key_source', 0, 4, 64], ['bis_key', 0, 4, 64],
  ['save_mac_key_source', 0, 2, 32], ['save_mac_key', 0, 2, 32],
  ['xci_t1_titlekey_kek', 0, 0x10, 32],
].map(([name, start, end, size]) => [name, { start, end, size }]));

function expectedLength(name) {
  const single = singles.get(name.replace(/_dev$/, ''));
  if (single) return single;
  const match = /_([0-9a-f]{2})$/.exec(name);
  if (!match) return undefined;
  const range = ranges.get(name.slice(0, -3).replace(/_dev$/, ''));
  const index = parseInt(match[1], 16);
  return range && index >= range.start && index < range.end ? range.size : undefined;
}

export function canonicalKeyFileName(name) {
  const canonical = typeof name === 'string' ? name.toLowerCase() : '';
  if (!['prod.keys', 'title.keys', 'console.keys'].includes(canonical))
    throw new Error('Choose prod.keys, title.keys or console.keys. Extract ZIP archives first.');
  return canonical;
}

function decode(bytes) {
  let encoding = 'utf-8', offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) {
    encoding = 'utf-32le'; offset = 4;
  } else if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff) {
    encoding = 'utf-32be'; offset = 4;
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  try {
    if (offset) {
      if ((bytes.byteLength - offset) % 4) throw new Error();
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let text = '';
      for (let i = offset; i < bytes.byteLength; i += 4) {
        const point = view.getUint32(i, encoding === 'utf-32le');
        if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error();
        text += String.fromCodePoint(point);
      }
      return { text, encoding };
    }
    // TextDecoder removes an initial BOM; fatal mode prevents replacement chars
    // from silently changing malformed text into an apparently valid key file.
    return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
  } catch {
    throw new Error('The key file is not valid text. Choose the extracted .keys file in UTF-8 or a Unicode format with a byte-order mark.');
  }
}

export function prepareKeyFile(fileName, input, { compatibleOnly = false } = {}) {
  const name = canonicalKeyFileName(fileName);
  if (compatibleOnly && name === 'title.keys')
    throw new Error('Compatible-entry recovery is available only for prod.keys and console.keys.');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 16 || bytes.byteLength > MAX_KEY_FILE_BYTES)
    throw new Error('Choose a non-empty key file up to 1 MiB.');
  // A renamed archive must not reach either the native parser or device storage.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b &&
      ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6) || (bytes[2] === 7 && bytes[3] === 8)))
    throw new Error('This is a ZIP archive. Extract it, then choose prod.keys, title.keys or console.keys.');
  const { text, encoding } = decode(bytes);
  const lines = text.split(/\r\n|[\r\n\0]/);
  const entries = [], issues = []; let recognizedEntries = 0, hasRsaKeyPair = false;
  const fail = (line, reason) => { throw new Error(`Line ${line}: ${reason} Your saved keys were not replaced.`); };
  for (let index = 0; index < lines.length; index++) {
    // The core accepts space/tab padding, '#' comments, '=' or ',' and CR/LF/NUL.
    // The browser setup also supports ';' comments. Canonical output uses UTF-8,
    // LF and '=' while retaining every entry and its value.
    const line = lines[index].replace(/^[ \t]+|[ \t]+$/g, '');
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const match = /^([a-z0-9_]+)[ \t]*[=,][ \t]*([0-9a-f]+)[ \t]*$/i.exec(line);
    if (!match) fail(index + 1, 'Expected a key name, = or comma, and a hexadecimal value.');
    const key = match[1].toLowerCase(), value = match[2];
    const size = name === 'title.keys' ? 32 : expectedLength(key);
    if (name === 'title.keys' && !/^[0-9a-f]{32}$/.test(key))
      fail(index + 1, 'A title-key entry needs a 32-digit hexadecimal title ID.');
    if (size && value.length !== size) {
      // Only catalog names may appear in diagnostics. A title rights ID and an
      // unrecognized export label must never become a displayed key name.
      issues.push({ line: index + 1, ...(name === 'title.keys' ? {} : { key }),
        expectedDigits: size, actualDigits: value.length });
      continue;
    }
    if (value.length % 2) fail(index + 1, 'The hexadecimal value must contain complete pairs of digits.');
    if (!size && (value.length < 32 || value.length > 512))
      fail(index + 1, 'This additional key entry has a length the installed runtime does not support.');
    const canonical = `${key} = ${value}`;
    // LibHac's reader uses a 2,048-character line buffer. Do not report success
    // for records it would silently skip, even if native setup accepted them.
    if (canonical.length >= 2048) fail(index + 1, 'This entry is too long for the key reader.');
    if (size) recognizedEntries++;
    if (size === 1056) hasRsaKeyPair = true;
    entries.push(canonical);
  }
  if (issues.length && (!compatibleOnly || !recognizedEntries)) {
    const first = issues[0];
    const label = first.key || 'this title-key entry';
    const error = new Error(`Line ${first.line}: Mochi expects ${first.expectedDigits} hexadecimal digits for ${label}; this entry has ${first.actualDigits}.` +
      (issues.length > 1 ? ` ${issues.length} entries have incompatible lengths.` : '') + ' Your saved keys were not replaced.');
    Object.assign(error, { code: 'key_entries_incompatible',
      canImportCompatible: name !== 'title.keys' && recognizedEntries > 0,
      compatibleEntries: recognizedEntries, incompatibleEntries: issues.length, issues });
    throw error;
  }
  if (!entries.length) throw new Error('The key file has no entries. Your saved keys were not replaced.');
  if (!recognizedEntries) throw new Error('No supported key entries were found in this file. Your saved keys were not replaced.');
  const canonical = new TextEncoder().encode(entries.join('\n') + '\n');
  if (canonical.byteLength > MAX_KEY_FILE_BYTES) throw new Error('The normalized key file exceeds the 1 MiB limit.');
  return {
    name, bytes: canonical, entries: entries.length, recognizedEntries,
    additionalEntries: entries.length - recognizedEntries, encoding, hasRsaKeyPair,
    ...(compatibleOnly ? { compatibleEntries: recognizedEntries, incompatibleEntries: issues.length, issues } : {}),
    normalized: name !== fileName || canonical.length !== bytes.length || canonical.some((value, i) => value !== bytes[i]),
  };
}
