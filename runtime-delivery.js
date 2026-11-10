const descriptorUrl = new URL('./runtime-delivery.json', import.meta.url);
const sri = /^sha256-[A-Za-z0-9+/]{43}=$/;

function bounded(stream, expected, label) {
  let received = 0;
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > expected) throw Error('Mochi runtime ' + label + ' exceeded its expected size.');
      controller.enqueue(chunk);
    },
    flush() { if (received !== expected) throw Error('Mochi runtime ' + label + ' is incomplete.'); }
  }));
}

function validateDescriptor(descriptor) {
  if (descriptor?.version !== 1 || !descriptor.resources || typeof descriptor.resources !== 'object' || Array.isArray(descriptor.resources))
    throw Error('Invalid Mochi runtime delivery descriptor.');
  const entries = new Map();
  for (const [name, resource] of Object.entries(descriptor.resources)) {
    if (!/^dotnet\.native(?:\.[a-z0-9]+)?\.wasm$/i.test(name) || !resource ||
        resource.encoding !== 'gzip' || resource.url !== './_framework/' + name + '.gz.bin' ||
        !Number.isSafeInteger(resource.compressedSize) || resource.compressedSize <= 0 ||
        !Number.isSafeInteger(resource.size) || resource.size <= 0 ||
        !sri.test(resource.compressedIntegrity) || !sri.test(resource.integrity))
      throw Error('Invalid Mochi native runtime delivery entry.');
    // Optional: a gzip too large for one hosted file comes as numbered parts.
    if (resource.parts !== undefined && (!Array.isArray(resource.parts) || resource.parts.length < 2 ||
        resource.parts.some((part, i) => !part || part.url !== './_framework/' + name + '.gz.' + i + '.bin' ||
          !Number.isSafeInteger(part.size) || part.size <= 0 || !sri.test(part.integrity)) ||
        resource.parts.reduce((sum, part) => sum + part.size, 0) !== resource.compressedSize))
      throw Error('Invalid Mochi native runtime delivery entry.');
    entries.set(name, resource);
  }
  return entries;
}

// Only native WASM is replaced. Returning undefined for other resource types is
// important: .NET's loader accepts URL strings or Promise<Response> overrides.
export async function configureRuntimeDelivery(dotnetBuilder, fetchImpl = fetch) {
  const descriptorResponse = await fetchImpl(descriptorUrl, { cache: 'no-cache', credentials: 'same-origin' });
  if (descriptorResponse.redirected || descriptorResponse.type === 'opaque') throw Error('Mochi runtime delivery requires a signed-in application response.');
  if (descriptorResponse.status === 404) return dotnetBuilder;
  if (!descriptorResponse.ok) throw Error('Could not load Mochi runtime delivery information (HTTP ' + descriptorResponse.status + ').');
  const entries = validateDescriptor(await descriptorResponse.json());
  if (!entries.size) return dotnetBuilder;
  if (typeof DecompressionStream !== 'function') throw Error('This browser cannot decompress the Mochi runtime. Update your browser and reopen Mochi.');
  if (typeof dotnetBuilder.withResourceLoader !== 'function') throw Error('The Mochi runtime does not support compressed delivery.');

  async function download(url, integrity) {
    const response = await fetchImpl(new URL(url, descriptorUrl), { cache: 'no-cache', credentials: 'same-origin', integrity });
    if (!response.ok || response.redirected || response.type === 'opaque')
      throw Error('Could not download the Mochi native runtime (HTTP ' + response.status + ').');
    if (!response.body) throw Error('The Mochi native runtime download is empty.');
    return response.body;
  }

  // Parts are fetched one after another (each with its own integrity) into one gzip stream.
  function joined(parts) {
    let index = 0, reader = null;
    return new ReadableStream({
      async pull(controller) {
        for (;;) {
          if (!reader) {
            if (index === parts.length) { controller.close(); return; }
            const part = parts[index++];
            reader = bounded(await download(part.url, part.integrity), part.size, 'part').getReader();
          }
          const { done, value } = await reader.read();
          if (!done) { controller.enqueue(value); return; }
          reader = null;
        }
      },
      cancel(reason) { return reader?.cancel(reason); }
    });
  }

  async function loadNative(resource, expectedIntegrity) {
    if (expectedIntegrity && expectedIntegrity !== resource.integrity)
      throw Error('Mochi runtime delivery does not match the current native build.');
    const body = resource.parts ? joined(resource.parts) : await download(resource.url, resource.compressedIntegrity);
    const compressed = bounded(body, resource.compressedSize, 'download');
    const decoded = compressed.pipeThrough(new DecompressionStream('gzip'));
    return new Response(bounded(decoded, resource.size, 'decompression'), {
      headers: { 'Content-Type': 'application/wasm', 'Content-Length': String(resource.size) }
    });
  }

  return dotnetBuilder.withResourceLoader((type, name, _defaultUri, expectedIntegrity) => {
    const resource = type === 'dotnetwasm' ? entries.get(name) : undefined;
    return resource ? loadNative(resource, expectedIntegrity) : undefined;
  });
}
