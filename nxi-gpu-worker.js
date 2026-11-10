// NXI WebGPU worker. Owns the GPU device and the game canvas (OffscreenCanvas) and
// drains the command ring the GPU thread writes into the shared heap (GpuRing.cs).
// Recording never calls JS, so the emulator's GPU thread never waits on the page.
const OP = { Wrap: 0, CreateTexture: 1, DestroyTexture: 2, WriteTexture: 3, Present: 4, ClearColor: 5, Fence: 6,
  CreateBuffer: 7, WriteBuffer: 8, DestroyBuffer: 9, CreateTexture2: 10, CreateView: 11, CreateSampler: 12, DestroySampler: 13,
  CreateProgram: 14, DestroyProgram: 15, Draw: 16, ClearDepth: 17, WriteTexture2: 18, ReadTexture: 19, ReadBuffer: 20,
  CopyBuffer: 21, CopyTexture: 22, ClearView: 23, Dispatch: 24, ReadBufferOwned: 25 };
const FORMATS = ['rgba8unorm', 'bgra8unorm'];
let device, context, readback = false, readbackBusy = false, errors = 0, canvasFormat, memory, heap, head, ring, base, blit, sampler;
let started = false, stopped = false;
let capabilities = null;
const shaderHealth = { attempted: 0, failed: 0, firstFailure: null };
const commandNames = Object.fromEntries(Object.entries(OP).map(([name, op]) => [op, name]));
const commandCounts = Object.fromEntries(Object.keys(OP).filter(name => name !== 'Wrap').map(name => [name, 0]));
commandCounts.Unknown = 0;
let receivedCommands = 0, lastCommand = null;
// Safe metadata only: no shader source, game bytes or exception text in snapshots.
function shaderFailure(program, id, stage, phase) {
  if (program.failed) return;
  program.failed = phase;
  shaderHealth.failed++;
  shaderHealth.firstFailure ??= { program: id, stage, phase };
  Atomics.add(head, 5, 1);
}
const textures = new Map();
// Stage 2 (draws). Everything is keyed by ids the managed side picks.
const buffers = new Map(), samplers = new Map(), programs = new Map();
let naga = null, zeroBuffer, frame = null; // frame: open command encoder + render pass
const decoder = new TextDecoder();

const BLIT = `
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> crop: vec4f; // uv scale xy, unused zw
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: V; o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y) * crop.xy; return o;
}
@fragment fn fs(v: V) -> @location(0) vec4f { return vec4f(textureSample(src, smp, v.uv).rgb, 1.0); }`;

self.onmessage = async ({ data }) => {
  if (data.type === 'memory-snapshot') {
    self.postMessage({ type: 'memory-snapshot', requestId: data.requestId, snapshot: {
      at: new Date().toISOString(), capabilities, shaderHealth: { ...shaderHealth },
      commandHealth: { received: receivedCommands, last: lastCommand, counts: { ...commandCounts },
        meaning: 'Commands observed after ring-envelope validation, before dispatch; includes rejected or skipped work. Not GPU completion or frame correctness.' },
      buffers: buffers.size,
      bufferAllocationBytes: [...buffers.values()].reduce((sum, entry) => sum + entry.buffer.size, 0),
      ownedTextures: [...textures.values()].filter(entry => entry.owner).length,
      textureViews: [...textures.values()].filter(entry => !entry.owner).length,
      samplers: samplers.size, programs: programs.size, physicalGpuBytes: null,
      note: 'Tracked guest GPU resources only. Buffer bytes are requested allocations; driver overhead, internal staging, texture residency and physical GPU memory are not exposed.'
    } });
    return;
  }
  if (started) return;
  started = true;
  try {
    memory = data.memory; base = data.address;
    views();
    // Kept global: if these are collected, Chromium can drop the device with them.
    self.nxiGpu = navigator.gpu;
    const adapter = self.nxiAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    device = self.nxiDevice = await adapter.requestDevice();
    capabilities = {
      features: [...(device.features ?? [])].sort(),
      limits: Object.fromEntries(['maxTextureDimension2D', 'maxBufferSize', 'maxUniformBufferBindingSize',
        'maxStorageBufferBindingSize', 'maxBindGroups', 'maxUniformBuffersPerShaderStage',
        'maxStorageBuffersPerShaderStage', 'maxSampledTexturesPerShaderStage',
        'maxStorageTexturesPerShaderStage', 'maxComputeWorkgroupStorageSize']
        .map(name => [name, device.limits[name] ?? null])),
      shaderTranslator: false,
    };
    device.lost.then(info => fail(new Error('WebGPU device lost: ' + info.message)), fail);
    // Validation errors are counted, not fatal: an unsupported draw shouldn't kill the display.
    device.onuncapturederror = e => { Atomics.add(head, 5, 1); if (++errors <= 20) console.error('NXI-GPU ' + e.error.message); };
    canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    self.nxiDumpFailedShaders = !!data.readback; // test mode only
    readback = !!data.readback; // tests: headless Chromium loses the device on canvas present
    if (readback) canvasFormat = 'rgba8unorm';
    else {
      context = data.canvas.getContext('webgpu');
      if (!context) throw new Error('No WebGPU canvas context');
      context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
    }
    const module = device.createShaderModule({ code: BLIT });
    blit = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: canvasFormat }] }, primitive: { topology: 'triangle-list' } });
    sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    zeroBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.VERTEX });
    // naga turns the core's SPIR-V into WGSL. Without it the display still works, draws don't.
    try {
      const mod = await import(new URL('./naga/naga.js', self.location.href).href);
      await mod.default({ module_or_path: new URL('./naga/naga_bg.wasm', self.location.href) });
      naga = mod; capabilities.shaderTranslator = true;
    } catch (e) { console.error('NXI-GPU shader translator unavailable: ' + (e.message || e)); }
    if (stopped) return;
    Atomics.store(head, 3, 1);
    postMessage({ ready: true, capabilities, adapter: adapter.info?.vendor + ' ' + (adapter.info?.architecture ?? '') });
    pump().catch(fail);
  } catch (e) {
    fail(e);
  }
};

// Shared memory grows in place, but views made before growth keep the old length,
// so they are rebuilt from memory.buffer whenever it changed.
function views() {
  if (ring && heap === memory.buffer) return;
  heap = memory.buffer;
  head = new Int32Array(heap, base, 16);
  ring = new DataView(heap, base + 64, Atomics.load(head, 2) + 16);
}

// Disable before reporting failure so a backpressured managed producer can exit.
// A failed ring is not reused: outstanding commands/texture ids belong to this device.
function fail(error) {
  if (stopped) return;
  stopped = true;
  if (head) {
    Atomics.store(head, 3, 0);
    Atomics.add(head, 5, 1);
    Atomics.notify(head, 0);
  }
  const message = String(error?.message || error);
  console.error('NXI-GPU ' + message);
  postMessage({ ready: false, error: message });
  for (const { texture } of textures.values()) texture.destroy();
  textures.clear();
  device?.destroy();
}

let presentCrop = null, presentTarget = null, readbackOut = null;

async function pump() {
  while (!stopped) {
    views();
    if (Atomics.load(head, 3) !== 1) { fail(new Error('WebGPU command queue disabled')); return; }
    let read = Atomics.load(head, 1), work = 0;
    const capacity = Atomics.load(head, 2);
    // Bound each task, even when the producer never lets the ring empty. Timers,
    // device-loss notifications and submitted-work promises must get to run.
    while (work < 64) {
      const write = Atomics.load(head, 0);
      if (read < 0 || read > capacity || write < 0 || write > capacity || (read | write) % 4)
        throw new Error('Invalid GPU ring cursor');
      if (read === write) break;
      const op = ring.getUint32(read, true);
      if (op === OP.Wrap) {
        if (read === 0 || write >= read) throw new Error('Invalid GPU ring wrap');
        read = 0; Atomics.store(head, 1, 0); work++; continue;
      }
      const total = ring.getUint32(read + 4, true);
      const published = write > read ? write - read : capacity - read;
      if (total < 8 || total % 4 || total > capacity / 2 || total > published || read + total > capacity)
        throw new Error('Invalid GPU command length: ' + total);
      // Fixed opcode names only: never retain guest payloads, addresses or arbitrary keys.
      lastCommand = commandNames[op] ?? 'Unknown';
      receivedCommands++; commandCounts[lastCommand]++;
      run(op, read + 8, total - 8);
      read += total; Atomics.store(head, 1, read); work++;
    }
    // A real task yield is necessary: await waitAsync(..., 0).value only queues
    // a microtask and can starve WebGPU completion and device-loss callbacks.
    await new Promise(resolve => setTimeout(resolve, work ? 0 : 4));
  }
}

function u32(at) { return ring.getUint32(at, true); }

class Reader {
  constructor(p, size) { this.p = p; this.end = p + size; }
  need(n) { if (this.p + n > this.end) throw new Error('GPU command payload too short'); }
  u() { this.need(4); const v = ring.getUint32(this.p, true); this.p += 4; return v; }
  i() { this.need(4); const v = ring.getInt32(this.p, true); this.p += 4; return v; }
  f() { this.need(4); const v = ring.getFloat32(this.p, true); this.p += 4; return v; }
  bytes(n) { this.need(n); const v = new Uint8Array(heap, base + 64 + this.p, n); this.p += (n + 3) & ~3; return v; }
  s() { const n = this.u(); return n ? decoder.decode(this.bytes(n).slice()) : ''; }
}

// Ends the open render pass and submits everything recorded so far. Needed before any
// queue.write*/readback so the queue sees operations in the order the core issued them.
function flush() {
  if (!frame) return;
  frame.pass?.end();
  device.queue.submit([frame.enc.finish()]);
  frame = null;
  for (const b of scratch.splice(0)) b.destroy();
}

function encoder() { return (frame ??= { enc: device.createCommandEncoder(), pass: null, key: '' }).enc; }

function endPass() { if (frame?.pass) { frame.pass.end(); frame.pass = null; frame.key = ''; } }

function view(id) {
  const t = textures.get(id);
  if (!t) throw new Error('Unknown GPU texture ' + id);
  return t;
}

// SPIR-V from the core declares a fixed capability set and the gl_PerVertex builtins WGSL lacks.
// Drop those declarations before naga reads it (they're unused by WebGPU-targeted programs).
function prepareSpirv(bytes) {
  const w = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  let ins = [];
  for (let i = 5; i < w.length;) {
    const n = w[i] >>> 16;
    if (!n) throw new Error('Bad SPIR-V');
    ins.push(Array.from(w.subarray(i, i + n)));
    i += n;
  }
  // OpCapability (keep Shader) and gl_PerVertex PointSize/Clip/Cull member builtins.
  ins = ins.filter(x => !((x[0] & 0xffff) === 17 && x[1] !== 1) && !((x[0] & 0xffff) === 72 && x[3] === 11 && [1, 3, 4].includes(x[4])));
  // naga has no IsNan: x is NaN exactly when the unordered compare x != x is true.
  ins = ins.map(x => (x[0] & 0xffff) === 156 ? [(5 << 16) | 183, x[1], x[2], x[3], x[3]] : x);
  const bound = { next: w[3] };
  ins = splitCombinedSamplers(ins, bound);
  const out = [w[0], w[1], w[2], bound.next, w[4]];
  for (const x of ins) out.push(...x);
  return new Uint8Array(new Uint32Array(out).buffer);
}

// Combined image-samplers (one binding) aren't readable by naga or expressible in WGSL.
// Split each into an image variable (same binding) and a sampler variable (binding + 64),
// and rebuild the sampled image at each load with OpSampledImage.
const SAMPLER_BINDING_OFFSET = 64;
function splitCombinedSamplers(ins, bound) {
  const op = x => x[0] & 0xffff, word = (o, rest) => [((rest.length + 1) << 16) | o, ...rest];
  const sampledImage = new Map(), pointers = new Map(), combined = new Map();
  let samplerType = 0;
  for (const x of ins) {
    if (op(x) === 27) sampledImage.set(x[1], x[2]);                 // OpTypeSampledImage result image
    if (op(x) === 26) samplerType = x[1];                            // OpTypeSampler
    if (op(x) === 32) pointers.set(x[1], { storage: x[2], type: x[3] });
  }
  for (const x of ins) {
    if (op(x) !== 59) continue;                                      // OpVariable type result storage
    const ptr = pointers.get(x[1]);
    if (ptr && ptr.storage === 0 && sampledImage.has(ptr.type)) combined.set(x[2], { sampledType: ptr.type, image: sampledImage.get(ptr.type) });
  }
  if (!combined.size) return ins;
  const fresh = () => bound.next++;
  const decl = [];
  if (!samplerType) { samplerType = fresh(); decl.push(word(26, [samplerType])); }
  const samplerPtr = fresh();
  decl.push(word(32, [samplerPtr, 0, samplerType]));
  for (const [v, c] of combined) {
    c.imagePtr = fresh(); c.sampler = fresh();
    decl.push(word(32, [c.imagePtr, 0, c.image]), word(59, [samplerPtr, c.sampler, 0]));
  }
  const out = [];
  let inserted = false;
  for (const x of ins) {
    if (op(x) === 59 && combined.has(x[2])) {
      if (!inserted) { out.push(...decl); inserted = true; }
      out.push(word(59, [combined.get(x[2]).imagePtr, x[2], 0]));
      continue;
    }
    if (op(x) === 71 && combined.has(x[1]) && (x[2] === 33 || x[2] === 34)) { // Binding / DescriptorSet
      out.push(x);
      const c = combined.get(x[1]);
      out.push(word(71, [c.sampler, x[2], x[2] === 33 ? x[3] + SAMPLER_BINDING_OFFSET : x[3]]));
      continue;
    }
    if (op(x) === 61 && combined.has(x[3])) {                        // OpLoad type result pointer
      const c = combined.get(x[3]), img = fresh(), smp = fresh();
      out.push(word(61, [c.image, img, x[3]]), word(61, [samplerType, smp, c.sampler]), word(86, [x[1], x[2], img, smp]));
      continue;
    }
    out.push(x);
  }
  return out;
}

const STAGE_BITS = { vertex: GPUShaderStage.VERTEX, fragment: GPUShaderStage.FRAGMENT, compute: GPUShaderStage.COMPUTE };

// Bind group layouts come from the WGSL itself: naga keeps only what the shader uses,
// with the exact texture dimension and sample type, which 'auto' layouts can't share.
function reflect(wgsl, stage, groups) {
  const re = /@group\((\d+)\) @binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+\w+\s*:\s*([^;]+);/g;
  for (let m; (m = re.exec(wgsl));) {
    const g = +m[1], b = +m[2], space = m[3] ?? '', type = m[4].trim();
    const entry = { binding: b, visibility: STAGE_BITS[stage] };
    if (space.startsWith('uniform')) entry.buffer = { type: 'uniform' };
    else if (space.startsWith('storage')) entry.buffer = { type: space.includes('read_write') ? 'storage' : 'read-only-storage' };
    else if (type === 'sampler') entry.sampler = { type: 'filtering' };
    else if (type === 'sampler_comparison') entry.sampler = { type: 'comparison' };
    else if (type.startsWith('texture_storage')) {
      const [, dim, fmt] = /texture_storage_(\w+?)<(\w+)/.exec(type);
      entry.storageTexture = { access: 'read-write', format: fmt, viewDimension: dim.replace('_array', '-array') };
    } else if (type.startsWith('texture_depth')) {
      const dim = type.replace('texture_depth_', '').replace('multisampled_', '');
      entry.texture = { sampleType: 'depth', viewDimension: dim.replace('_array', '-array'), multisampled: type.includes('multisampled') };
    } else if (type.startsWith('texture_')) {
      const [, dim, scalar] = /texture_(?:multisampled_)?(\w+?)<(\w+)>/.exec(type);
      entry.texture = { sampleType: scalar === 'i32' ? 'sint' : scalar === 'u32' ? 'uint' : 'float', viewDimension: dim.replace('_array', '-array'), multisampled: type.includes('multisampled') };
    } else continue;
    const list = (groups[g] ??= new Map()), prev = list.get(b);
    if (prev) prev.visibility |= entry.visibility; else list.set(b, entry);
  }
}

// The core flips Y with a negative viewport height (Vulkan style); WebGPU doesn't allow that.
// Wrap the vertex entry point so a pipeline constant can flip the clip-space Y instead.
function addFlipY(wgsl) {
  const head = /@vertex\s*fn main\(/.exec(wgsl);
  if (!head) return wgsl;
  // Parameters contain attributes like @builtin(vertex_index), so find the matching paren by hand.
  let k = head.index + head[0].length, depth = 1;
  for (; k < wgsl.length && depth; k++) depth += wgsl[k] === '(' ? 1 : wgsl[k] === ')' ? -1 : 0;
  const params = wgsl.slice(head.index + head[0].length, k - 1);
  const ret = /^\s*->\s*(\w+)\s*\{/.exec(wgsl.slice(k));
  if (!ret) return wgsl;
  const struct = new RegExp('struct ' + ret[1] + '\\s*\\{([^}]*)\\}').exec(wgsl);
  const pos = struct && /@builtin\(position\)\s*(?:@\w+(?:\([^)]*\))?\s*)*(\w+)\s*:/.exec(struct[1]);
  if (!pos) return wgsl;
  const args = [...params.replace(/@\w+(\([^)]*\))?/g, '').matchAll(/(\w+)\s*:/g)].map(m => m[1]).join(', ');
  return wgsl.slice(0, head.index) + `fn nxi_vertex_main(${params.replace(/@\w+(\([^)]*\))?\s*/g, '')}) -> ${ret[1]} {` + wgsl.slice(k + ret[0].length) +
    `\noverride nxi_flip_y: f32 = 1.0;\n@vertex\nfn main(${params}) -> ${ret[1]} {\n  var o = nxi_vertex_main(${args});\n  o.${pos[1]}.y = o.${pos[1]}.y * nxi_flip_y;\n  return o;\n}\n`;
}

// Parameter text of the @vertex entry point (parameters carry attributes with parentheses).
function entryParams(wgsl) {
  let best = null;
  for (const head of wgsl.matchAll(/@vertex\s*fn main\(/g)) best = head; // the wrapper (last) when present
  if (!best) return '';
  let k = best.index + best[0].length, depth = 1;
  for (; k < wgsl.length && depth; k++) depth += wgsl[k] === '(' ? 1 : wgsl[k] === ')' ? -1 : 0;
  return wgsl.slice(best.index + best[0].length, k - 1);
}

function vertexInputs(wgsl) {
  const inputs = [];
  for (const m of entryParams(wgsl).matchAll(/@location\((\d+)\)\s*(?:@\w+(?:\([^)]*\))?\s*)*\w+\s*:\s*(?:vec(\d)<(\w+)>|(\w+))/g))
    inputs.push({ location: +m[1], size: +(m[2] ?? 1), scalar: m[3] ?? m[4] });
  return inputs;
}

function createProgram(r) {
  const id = r.u(), stageCount = r.u(), stages = {}, groups = [];
  const program = { stages, groups, pipelines: new Map() };
  programs.set(id, program);
  shaderHealth.attempted++;
  if (!stageCount) { shaderFailure(program, id, 'none', 'no-stages'); return; }
  for (let k = 0; k < stageCount; k++) {
    const stage = r.s(), spv = r.bytes(r.u());
    if (!['vertex', 'fragment', 'compute'].includes(stage)) {
      shaderFailure(program, id, 'unsupported', 'unsupported-stage'); return;
    }
    if (!naga) { shaderFailure(program, id, stage, 'translator-unavailable'); return; }
    let wgsl, m, info;
    try {
      m = naga.parseSpirv(prepareSpirv(spv)); info = naga.validate(m);
      wgsl = naga.writeWgsl(m, info, {});
    } catch {
      shaderFailure(program, id, stage, 'spirv-translation');
      return;
    } finally {
      info?.free(); m?.free();
    }
    if (stage === 'vertex') wgsl = addFlipY(wgsl);
    reflect(wgsl, stage, groups);
    const module = device.createShaderModule({ code: wgsl });
    stages[stage] = { module, wgsl };
    // A late result must not poison a replacement with the same id.
    module.getCompilationInfo().then(result => {
      if (!stopped && programs.get(id) === program && result.messages.some(m => m.type === 'error'))
        shaderFailure(program, id, stage, 'wgsl-validation');
    }, () => {
      if (!stopped && programs.get(id) === program) shaderFailure(program, id, stage, 'wgsl-validation-unavailable');
    });
  }
  program.layouts = [0, 1, 2, 3].map(g => device.createBindGroupLayout({ entries: [...(groups[g]?.values() ?? [])] }));
  program.layout = device.createPipelineLayout({ bindGroupLayouts: program.layouts });
  program.inputs = stages.vertex ? vertexInputs(stages.vertex.wgsl) : [];
}

const BLEND_KEYS = ['op', 'src', 'dst', 'aop', 'asrc', 'adst'];

let skips = 0;
function skip(reason) { if (++skips <= 30) console.warn('NXI-GPU draw skipped: ' + reason); }

function draw(r) {
  const program = programs.get(r.u()), topology = r.s();
  const targets = [], colors = [];
  for (let n = r.u(), k = 0; k < n; k++) {
    const tid = r.u(), t = tid ? view(tid) : null, writeMask = r.u(), blend = r.u() ? {} : null;
    for (const key of BLEND_KEYS) { const v = r.s(); if (blend) blend[key] = v; }
    if (!t) { targets.push(null); colors.push(null); continue; }
    targets.push({ format: t.format, writeMask, blend: blend ? { color: { operation: blend.op, srcFactor: blend.src, dstFactor: blend.dst }, alpha: { operation: blend.aop, srcFactor: blend.asrc, dstFactor: blend.adst } } : undefined });
    colors.push(t);
  }
  const depthId = r.u(), depthTest = r.u(), depthWrite = r.u(), depthCompare = r.s();
  const stencilOn = r.u(), sf = [r.s(), r.s(), r.s(), r.s()], sb = [r.s(), r.s(), r.s(), r.s()];
  const stencilRead = r.u(), stencilWrite = r.u(), stencilRef = r.u(), blendConstant = [r.f(), r.f(), r.f(), r.f()];
  const cullMode = r.s(), frontFace = r.s();
  const vp = [r.f(), r.f(), r.f(), r.f(), r.f(), r.f()];
  const scissorOn = r.u(), sc = [r.i(), r.i(), r.i(), r.i()];
  const vbs = [];
  for (let n = r.u(), k = 0; k < n; k++) vbs.push({ id: r.u(), offset: r.u(), size: r.u(), stride: r.u(), step: r.u() ? 'instance' : 'vertex' });
  const attrs = new Map();
  for (let n = r.u(), k = 0; k < n; k++) { const location = r.u(), vb = r.u(), offset = r.u(), format = r.s(); attrs.set(location, { vb, offset, format }); }
  const indexed = r.u(), ib = indexed ? { id: r.u(), offset: r.u(), size: r.u(), format: r.s() } : null;
  const binds = [];
  for (let n = r.u(), k = 0; k < n; k++) binds.push({ group: r.u(), binding: r.u(), kind: r.u(), id: r.u(), offset: r.u(), size: r.u() });
  const count = r.u(), instances = r.u(), first = r.u(), baseVertex = r.i(), firstInstance = r.u();
  if (!program || program.failed || !program.stages.vertex) return skip(!program ? 'no program' : program.failed ? 'shader failed: ' + program.failed : 'no vertex stage');
  const depth = depthId ? view(depthId) : null;
  const attachment = colors.find(c => c) ?? depth;
  if (!attachment) return skip('no render target');
  const [vx, vy, vw, vh] = vp, top = vh < 0 ? vy + vh : vy;
  // Do not draw using the default full-target viewport when a guest viewport
  // is empty or wholly clipped. The later WebGPU clamp must not invent pixels.
  if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh === 0 ||
      vx >= attachment.width || top >= attachment.height ||
      vx + vw <= 0 || top + Math.abs(vh) <= 0) return skip('empty viewport');

  // Vertex layout: one GPU buffer slot per shader input. Inputs with no attribute read zeros.
  const layoutsVb = [], slots = [];
  for (const input of program.inputs) {
    const a = attrs.get(input.location), vb = a && vbs[a.vb];
    if (a && vb && buffers.get(vb.id)) {
      layoutsVb.push({ arrayStride: vb.stride, stepMode: vb.step, attributes: [{ shaderLocation: input.location, offset: a.offset, format: a.format }] });
      slots.push({ buffer: buffers.get(vb.id).buffer, offset: vb.offset, size: vb.size });
    } else {
      const fmt = input.scalar === 'u32' ? 'uint32' : input.scalar === 'i32' ? 'sint32' : 'float32';
      layoutsVb.push({ arrayStride: 0, stepMode: 'vertex', attributes: [{ shaderLocation: input.location, offset: 0, format: input.size > 1 ? fmt + 'x' + input.size : fmt }] });
      slots.push({ buffer: zeroBuffer, offset: 0, size: 64 });
    }
  }
  const strip = topology.endsWith('strip'), flip = vp[3] < 0 && program.stages.vertex.wgsl.includes('nxi_flip_y') ? -1 : 1;
  const desc = {
    layout: program.layout,
    vertex: { module: program.stages.vertex.module, entryPoint: 'main', buffers: layoutsVb, constants: flip < 0 ? { nxi_flip_y: -1 } : undefined },
    // The extra Y flip mirrors the winding too, so the front face swaps with it.
    primitive: { topology, cullMode, frontFace: flip < 0 ? (frontFace === 'cw' ? 'ccw' : 'cw') : frontFace, stripIndexFormat: strip && ib ? ib.format : undefined },
  };
  if (program.stages.fragment) desc.fragment = { module: program.stages.fragment.module, entryPoint: 'main', targets };
  const samples = (colors.find(c => c) ?? depth)?.samples ?? 1;
  if (samples > 1) desc.multisample = { count: samples };
  if (depth) {
    desc.depthStencil = { format: depth.format, depthWriteEnabled: !!depthWrite && !depth.format.startsWith('stencil'), depthCompare: depthTest ? depthCompare : 'always' };
    if (depth.stencil && stencilOn) Object.assign(desc.depthStencil, {
      stencilFront: { compare: sf[0], failOp: sf[1], depthFailOp: sf[2], passOp: sf[3] },
      stencilBack: { compare: sb[0], failOp: sb[1], depthFailOp: sb[2], passOp: sb[3] },
      stencilReadMask: stencilRead, stencilWriteMask: stencilWrite });
  }
  const key = JSON.stringify([desc.primitive, layoutsVb, targets, desc.depthStencil, flip, samples]);
  let pipeline = program.pipelines.get(key);
  if (!pipeline) program.pipelines.set(key, pipeline = device.createRenderPipeline(desc));

  const groups = bindGroups(program, binds);
  // Render pass: kept open across draws to the same attachments.
  const passKey = colors.map(c => c?.id ?? 0).join(',') + '|' + (depth?.id ?? 0);
  encoder();
  if (frame.key !== passKey || !frame.pass) {
    endPass();
    frame.pass = frame.enc.beginRenderPass({
      colorAttachments: colors.map(c => c && { view: c.target, loadOp: 'load', storeOp: 'store' }),
      depthStencilAttachment: depth ? { view: depth.target, depthLoadOp: 'load', depthStoreOp: 'store', ...(depth.stencil ? { stencilLoadOp: 'load', stencilStoreOp: 'store' } : {}) } : undefined,
    });
    frame.key = passKey;
  }
  const pass = frame.pass, size = colors.find(c => c) ?? depth;
  pass.setPipeline(pipeline);
  if (depth?.stencil && stencilOn) pass.setStencilReference(stencilRef);
  if (targets.some(t => t?.blend)) pass.setBlendConstant(blendConstant);
  // WebGPU rejects viewports outside the target or with negative size; clamp them in.
  let [x, y, w, h, minD, maxD] = vp;
  if (h < 0) { y += h; h = -h; } // flipped in the shader instead (nxi_flip_y)
  if (minD > maxD) [minD, maxD] = [maxD, minD];
  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.max(1, Math.min(w, size.width - x)); h = Math.max(1, Math.min(h, size.height - y));
  if (x < size.width && y < size.height) pass.setViewport(x, y, w, h, Math.min(Math.max(minD, 0), 1), Math.min(Math.max(maxD, 0), 1));
  const sx = scissorOn ? Math.max(0, sc[0]) : 0, sy = scissorOn ? Math.max(0, sc[1]) : 0;
  const sw = scissorOn ? Math.max(0, Math.min(sc[2], size.width - sx)) : size.width, sh = scissorOn ? Math.max(0, Math.min(sc[3], size.height - sy)) : size.height;
  if (sx >= size.width || sy >= size.height || !sw || !sh) return skip('empty scissor ' + JSON.stringify([sc, size.width, size.height]));
  pass.setScissorRect(sx, sy, sw, sh);
  slots.forEach((s, i) => pass.setVertexBuffer(i, s.buffer, s.offset, Math.max(0, Math.min(s.size, s.buffer.size - s.offset))));
  groups.forEach((group, g) => pass.setBindGroup(g, group));
  if (ib) {
    const buf = buffers.get(ib.id);
    if (!buf) return skip('no index buffer ' + ib.id);
    pass.setIndexBuffer(buf.buffer, ib.format, ib.offset, Math.min(ib.size, buf.buffer.size - ib.offset));
    pass.drawIndexed(count, instances, first, baseVertex, firstInstance);
  } else pass.draw(count, instances, first, firstInstance);
}

// Builds the four bind groups for a draw/dispatch. Must run outside a pass: a buffer bound both
// as read-write storage and as a uniform (the core merges guest ranges into big buffers) is
// illegal in one pass, so the uniform side reads a copy taken just before.
const scratch = [];
function bindGroups(program, binds) {
  const writable = new Set();
  for (let g = 0; g < 4; g++) for (const [binding, e] of program.groups[g] ?? []) {
    if (e.buffer?.type !== 'storage') continue;
    const b = binds.find(x => x.group === g && x.binding === binding && x.kind !== 3);
    if (b) writable.add(b.id);
  }
  const groups = [];
  for (let g = 0; g < 4; g++) {
    const want = program.groups[g];
    if (!want?.size) { groups.push(device.createBindGroup({ layout: program.layouts[g], entries: [] })); continue; }
    const entries = [];
    for (const [binding, layoutEntry] of want) {
      const slot = layoutEntry.sampler && binding >= SAMPLER_BINDING_OFFSET ? binding - SAMPLER_BINDING_OFFSET : binding;
      const b = binds.find(x => x.group === g && x.binding === slot && (layoutEntry.sampler ? x.kind === 3 : x.kind !== 3));
      let res = resource(layoutEntry, b);
      if (layoutEntry.buffer && layoutEntry.buffer.type !== 'storage' && b && writable.has(b.id) && res.buffer !== dummy.ubo) {
        const copy = device.createBuffer({ size: res.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        endPass();
        encoder().copyBufferToBuffer(res.buffer, res.offset, copy, 0, res.size);
        scratch.push(copy);
        res = { buffer: copy, offset: 0, size: res.size };
      }
      entries.push({ binding, resource: res });
    }
    groups.push(device.createBindGroup({ layout: program.layouts[g], entries }));
  }
  return groups;
}

function dispatch(r) {
  const program = programs.get(r.u()), x = r.u(), y = r.u(), z = r.u(), binds = [];
  for (let n = r.u(), k = 0; k < n; k++) binds.push({ group: r.u(), binding: r.u(), kind: r.u(), id: r.u(), offset: r.u(), size: r.u() });
  if (!program || program.failed || !program.stages.compute || !x || !y || !z) return;
  program.compute ??= device.createComputePipeline({ layout: program.layout, compute: { module: program.stages.compute.module, entryPoint: 'main' } });
  const groups = bindGroups(program, binds);
  endPass();
  const pass = encoder().beginComputePass();
  pass.setPipeline(program.compute);
  groups.forEach((group, g) => pass.setBindGroup(g, group));
  pass.dispatchWorkgroups(x, y, z);
  pass.end();
}

// Missing bindings get harmless stand-ins so one unbound slot doesn't drop the draw.
let dummy;
function resource(entry, b) {
  dummy ??= {
    ubo: device.createBuffer({ size: 65536, usage: GPUBufferUsage.UNIFORM }),
    ssbo: device.createBuffer({ size: 65536, usage: GPUBufferUsage.STORAGE }),
    sampler: device.createSampler(), cmp: device.createSampler({ compare: 'less' }),
    tex: device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }),
  };
  if (entry.buffer) {
    const buf = b && buffers.get(b.id);
    if (!buf) return { buffer: entry.buffer.type === 'uniform' ? dummy.ubo : dummy.ssbo };
    const room = buf.buffer.size - b.offset;
    const size = entry.buffer.type === 'uniform' ? Math.min(65536, room) : Math.min(Math.max(16, b.size || room), room);
    return { buffer: buf.buffer, offset: b.offset, size };
  }
  if (entry.sampler) return (b && samplers.get(b.id)) ?? (entry.sampler.type === 'comparison' ? dummy.cmp : dummy.sampler);
  const t = b && textures.get(b.id);
  if (!t) return dummy.tex.createView();
  return t.view;
}

function run(op, p, size) {
  const minimum = { 1: 16, 2: 4, 3: 16, 4: 12, 5: 20, 6: 4 }[op] ?? (op >= 7 && op <= 25 ? 4 : undefined);
  if (minimum === undefined || size < minimum) throw new Error('Invalid GPU opcode/payload: ' + op);
  if (op >= 7) {
    // A bad draw/shader/texture is logged and skipped; it must not take the whole display down.
    try { runDraw(op, new Reader(p, size)); }
    catch (e) { Atomics.add(head, 5, 1); if (++errors <= 40) console.error('NXI-GPU op ' + op + ': ' + String(e.message || e).slice(0, 400)); }
    return;
  }
  flush();
  switch (op) {
    case OP.CreateTexture: {
      const id = u32(p), width = u32(p + 4), height = u32(p + 8), format = FORMATS[u32(p + 12)];
      if (!width || !height || width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D || !format)
        throw new Error('Invalid GPU texture dimensions/format');
      textures.get(id)?.texture.destroy();
      const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const v = texture.createView();
      textures.set(id, { id, texture, owner: true, view: v, target: v, width, height, format });
      break;
    }
    case OP.DestroyTexture: { const t = textures.get(u32(p)); if (t?.owner) t.texture.destroy(); textures.delete(u32(p)); break; }
    case OP.WriteTexture: {
      const t = textures.get(u32(p)); if (!t) throw new Error('Unknown GPU texture');
      const width = u32(p + 4), height = u32(p + 8), bytesPerRow = u32(p + 12);
      if (!width || !height || width > t.width || height > t.height || bytesPerRow < width * 4 || bytesPerRow % 4 || bytesPerRow * height > size - 16)
        throw new Error('Invalid GPU texture upload bounds');
      device.queue.writeTexture({ texture: t.texture }, new Uint8Array(heap, base + 64 + p + 16, bytesPerRow * height), { bytesPerRow }, [width, height]);
      break;
    }
    case OP.ClearColor: {
      const t = textures.get(u32(p)); if (!t) throw new Error('Unknown GPU texture');
      const r = ring.getFloat32(p + 4, true), g = ring.getFloat32(p + 8, true), b = ring.getFloat32(p + 12, true), a = ring.getFloat32(p + 16, true);
      const enc = device.createCommandEncoder();
      enc.beginRenderPass({ colorAttachments: [{ view: t.target, loadOp: 'clear', storeOp: 'store', clearValue: { r, g, b, a } }] }).end();
      device.queue.submit([enc.finish()]);
      break;
    }
    case OP.Present: {
      const t = textures.get(u32(p)); if (!t) throw new Error('Unknown GPU texture');
      const w = u32(p + 4) || t.width, h = u32(p + 8) || t.height;
      if (w > t.width || h > t.height) throw new Error('Invalid GPU present bounds');
      // Reused per frame size: a new texture/buffer per frame made the GPU process pool
      // gigabytes before it shrank (mostly the ?gpu=readback test path).
      if (!presentCrop) presentCrop = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      let target;
      if (readback) {
        if (presentTarget?.width !== w || presentTarget?.height !== h) {
          presentTarget?.destroy();
          presentTarget = device.createTexture({ size: [w, h], format: canvasFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        }
        target = presentTarget;
      } else {
        const canvas = context.canvas;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        target = context.getCurrentTexture();
      }
      device.queue.writeBuffer(presentCrop, 0, new Float32Array([w / t.width, h / t.height, 0, 0]));
      const group = device.createBindGroup({ layout: blit.getBindGroupLayout(0), entries: [{ binding: 0, resource: t.target }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer: presentCrop } }] });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(blit); pass.setBindGroup(0, group); pass.draw(3); pass.end();
      if (readback && !readbackBusy) {
        const bytesPerRow = Math.ceil(w * 4 / 256) * 256;
        if (readbackOut?.size !== bytesPerRow * h) {
          readbackOut?.destroy();
          readbackOut = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        }
        const out = readbackOut;
        enc.copyTextureToBuffer({ texture: target }, { buffer: out, bytesPerRow }, [w, h]);
        readbackBusy = true;
        device.queue.submit([enc.finish()]);
        out.mapAsync(GPUMapMode.READ).then(() => {
          const src = new Uint8Array(out.getMappedRange()), px = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y++) px.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
          out.unmap(); readbackBusy = false;
          postMessage({ frame: px, width: w, height: h }, [px.buffer]);
        }, () => { readbackBusy = false; });
      } else device.queue.submit([enc.finish()]);
      Atomics.add(head, 6, 1); // presented frames, read by the page
      break;
    }
    case OP.Fence: {
      const id = ring.getInt32(p, true);
      device.queue.onSubmittedWorkDone().then(() => { if (!stopped) Atomics.store(head, 4, id); }, fail);
      break;
    }
  }
}


function runDraw(op, r) {
  switch (op) {
    case OP.CreateBuffer: {
      // +64 KiB tail: the core's constant buffers are declared as 64 KiB arrays, and WebGPU
      // wants the whole declared size bound even when the guest only uses a few bytes.
      const id = r.u(), size = Math.ceil(r.u() / 4) * 4 + 65536;
      // Bitwise alignment wraps uint32 sizes into small or negative allocations.
      // Reject the full padded size before destroying an existing valid buffer.
      if (size > device.limits.maxBufferSize) throw new Error('GPU buffer exceeds device maxBufferSize');
      buffers.get(id)?.buffer.destroy();
      buffers.set(id, { buffer: device.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }) });
      break;
    }
    case OP.WriteBuffer: {
      const b = buffers.get(r.u()), offset = r.u(), data = r.bytes(r.u());
      if (!b || offset + data.length > b.buffer.size || offset % 4 || data.length % 4) throw new Error('Invalid GPU buffer write');
      flush(); device.queue.writeBuffer(b.buffer, offset, data);
      break;
    }
    case OP.DestroyBuffer: { const id = r.u(); flush(); buffers.get(id)?.buffer.destroy(); buffers.delete(id); break; }
    case OP.CreateTexture2: {
      const id = r.u(), width = r.u(), height = r.u(), layers = r.u(), levels = r.u(), samples = r.u(), dimension = r.s(), format = r.s(), wanted = r.s();
      flush(); textures.get(id)?.owner && textures.get(id).texture.destroy();
      const depthy = format.startsWith('depth') || format.startsWith('stencil');
      let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;
      if (dimension === '3d') usage &= ~GPUTextureUsage.RENDER_ATTACHMENT;
      if (samples > 1) usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
      const texture = device.createTexture({ size: [width, height, layers], mipLevelCount: levels, sampleCount: samples, dimension, format, usage });
      let viewDimension = dimension === '3d' ? '3d' : wanted === 'cube' && layers === 6 ? 'cube' : wanted === 'cube-array' && layers % 6 === 0 ? 'cube-array' : layers > 1 || wanted === '2d-array' ? '2d-array' : '2d';
      textures.set(id, { id, texture, owner: true, width, height, layers, levels, format, stencil: format.includes('stencil'),
        samples, view: texture.createView({ dimension: viewDimension, aspect: depthy && format.includes('stencil') ? 'depth-only' : 'all' }),
        target: texture.createView({ dimension: '2d', baseArrayLayer: 0, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }) });
      break;
    }
    case OP.CreateView: {
      const id = r.u(), parent = view(r.u()), format = r.s(), dimension = r.s(), baseMipLevel = r.u(), mipLevelCount = r.u(), baseArrayLayer = r.u(), arrayLayerCount = r.u();
      // WebGPU only reinterprets srgb <-> linear (and only if declared up front); otherwise keep the parent's.
      const fmt = parent.format;
      const depthy = fmt.startsWith('depth');
      // Views can't outgrow their parent; '1d' views of 2D storage aren't allowed either.
      const levels = Math.max(1, Math.min(mipLevelCount, parent.texture.mipLevelCount - baseMipLevel));
      const layers = Math.max(1, Math.min(arrayLayerCount, parent.texture.depthOrArrayLayers - baseArrayLayer));
      let dim = parent.texture.dimension === '3d' ? '3d' : dimension === '1d' ? '2d' : dimension;
      if (dim === '2d' && layers > 1) dim = '2d-array';
      if (dim === 'cube' && layers !== 6) dim = layers > 1 ? '2d-array' : '2d';
      if (dim === 'cube-array' && layers % 6) dim = '2d-array';
      const desc = { format: fmt, dimension: dim, baseMipLevel, mipLevelCount: levels, baseArrayLayer, arrayLayerCount: dim === '3d' ? 1 : layers, aspect: depthy && fmt.includes('stencil') ? 'depth-only' : 'all' };
      textures.set(id, { id, texture: parent.texture, owner: false, width: Math.max(1, parent.width >> baseMipLevel), height: Math.max(1, parent.height >> baseMipLevel), layers: arrayLayerCount, levels: mipLevelCount, format: fmt, stencil: fmt.includes('stencil'),
        samples: parent.samples, view: parent.texture.createView(desc), target: parent.texture.createView({ ...desc, dimension: '2d', mipLevelCount: 1, arrayLayerCount: 1 }) });
      break;
    }
    case OP.CreateSampler: {
      const id = r.u(), minFilter = r.s(), magFilter = r.s(), mipmapFilter = r.s(), addressModeU = r.s(), addressModeV = r.s(), addressModeW = r.s(), compare = r.s(), maxAnisotropy = r.u(), lodMinClamp = r.f(), lodMaxClamp = r.f();
      const aniso = maxAnisotropy > 1 && minFilter === 'linear' && magFilter === 'linear' && mipmapFilter === 'linear' ? Math.min(16, maxAnisotropy) : 1;
      samplers.set(id, device.createSampler({ minFilter, magFilter, mipmapFilter, addressModeU, addressModeV, addressModeW, compare: compare || undefined, maxAnisotropy: aniso, lodMinClamp: Math.max(0, lodMinClamp), lodMaxClamp: Math.max(lodMinClamp, Math.max(0, lodMaxClamp)) }));
      break;
    }
    case OP.DestroySampler: samplers.delete(r.u()); break;
    case OP.CreateProgram: createProgram(r); break;
    case OP.DestroyProgram: programs.delete(r.u()); break;
    case OP.Draw: draw(r); break;
    case OP.ClearView: {
      // Colour clear of one attachment view: [view id, r, g, b, a].
      const t = view(r.u()), clearValue = { r: r.f(), g: r.f(), b: r.f(), a: r.f() };
      endPass();
      encoder().beginRenderPass({ colorAttachments: [{ view: t.target, loadOp: 'clear', storeOp: 'store', clearValue }] }).end();
      break;
    }
    case OP.ClearDepth: {
      const t = view(r.u()), depthClearValue = r.f(), stencilClearValue = r.u(), clearDepth = r.u(), clearStencil = r.u();
      endPass();
      const a = { view: t.target };
      if (!t.format.startsWith('stencil')) Object.assign(a, clearDepth ? { depthLoadOp: 'clear', depthClearValue: Math.min(1, Math.max(0, depthClearValue)) } : { depthLoadOp: 'load' }, { depthStoreOp: 'store' });
      if (t.stencil) Object.assign(a, clearStencil ? { stencilLoadOp: 'clear', stencilClearValue } : { stencilLoadOp: 'load' }, { stencilStoreOp: 'store' });
      encoder().beginRenderPass({ colorAttachments: [], depthStencilAttachment: a }).end();
      break;
    }
    case OP.WriteTexture2: {
      const t = view(r.u()), mipLevel = r.u(), layer = r.u(), x = r.u(), y = r.u(), w = r.u(), h = r.u(), bytesPerRow = r.u(), data = r.bytes(r.u());
      flush();
      device.queue.writeTexture({ texture: t.texture, mipLevel, origin: [x, y, layer] }, data, { bytesPerRow, rowsPerImage: h }, [w, h, 1]);
      break;
    }
    case OP.CopyBuffer: {
      const src = buffers.get(r.u()), dst = buffers.get(r.u()), so = r.u(), d = r.u(), n = r.u();
      if (!src || !dst) break;
      endPass(); encoder().copyBufferToBuffer(src.buffer, so, dst.buffer, d, n);
      break;
    }
    case OP.CopyTexture: {
      const src = view(r.u()), dst = view(r.u()), sLevel = r.u(), sLayer = r.u(), dLevel = r.u(), dLayer = r.u(), w = r.u(), h = r.u();
      endPass();
      if ((src.samples ?? 1) > 1 && (dst.samples ?? 1) === 1) {
        // Multisampled -> single sample is a resolve, done by an empty render pass.
        if (src.format === dst.format) encoder().beginRenderPass({ colorAttachments: [{ view: src.target, resolveTarget: dst.target, loadOp: 'load', storeOp: 'store' }] }).end();
        break;
      }
      if ((src.samples ?? 1) !== (dst.samples ?? 1)) break;
      encoder().copyTextureToTexture({ texture: src.texture, mipLevel: sLevel, origin: [0, 0, sLayer] }, { texture: dst.texture, mipLevel: dLevel, origin: [0, 0, dLayer] }, [w, h, 1]);
      break;
    }
    case OP.Dispatch: dispatch(r); break;
    case OP.ReadTexture: readTexture(r); break;
    case OP.ReadBuffer: readBuffer(r); break;
    case OP.ReadBufferOwned: readBufferOwned(r); break;
  }
}

// Readbacks write straight into the managed heap, then publish their id in header[7].
// The managed side spins on that slot (it never touches JS).
function readTexture(r) {
  const t = view(r.u()), mipLevel = r.u(), layer = r.u(), w = r.u(), h = r.u(), bpp = r.u(), dst = r.u(), dstStride = r.u(), ticket = r.i();
  flush();
  const bytesPerRow = Math.ceil(w * bpp / 256) * 256;
  const out = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: t.texture, mipLevel, origin: [0, 0, layer], aspect: t.format.startsWith('depth') ? 'depth-only' : 'all' }, { buffer: out, bytesPerRow, rowsPerImage: h }, [w, h, 1]);
  device.queue.submit([enc.finish()]);
  out.mapAsync(GPUMapMode.READ).then(() => {
    views();
    const src = new Uint8Array(out.getMappedRange()), dest = new Uint8Array(heap);
    for (let y = 0; y < h; y++) dest.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * bpp), dst + y * dstStride);
    out.destroy();
  }, e => console.error('NXI-GPU readback ' + (e.message || e))).finally(() => Atomics.store(head, 7, ticket));
}

function readBuffer(r) {
  const b = buffers.get(r.u()), offset = r.u(), size = r.u(), dst = r.u(), ticket = r.i();
  flush();
  if (!b) { Atomics.store(head, 7, ticket); return; }
  const start = offset & ~3, len = ((offset + size + 3) & ~3) - start;
  const out = device.createBuffer({ size: len, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(b.buffer, start, out, 0, len);
  device.queue.submit([enc.finish()]);
  out.mapAsync(GPUMapMode.READ).then(() => {
    views();
    new Uint8Array(heap).set(new Uint8Array(out.getMappedRange()).subarray(offset - start, offset - start + size), dst);
    out.destroy();
  }, e => console.error('NXI-GPU readback ' + (e.message || e))).finally(() => Atomics.store(head, 7, ticket));
}


// Owned readback mailbox: [status, byteCount, payload]. The producer retains this
// allocation after timeout until status is acknowledged. Never write it after
// publishing status, including in cleanup or device-loss handlers.
function readBufferOwned(r) {
  const id = r.u(), offset = r.u(), size = r.u(), address = r.u();
  views();
  if (address % 4 || address + 8 + size > heap.byteLength || size > 16 * 1024 * 1024)
    throw new Error('Invalid owned GPU readback destination');
  const publish = (status, count) => {
    views();
    const response = new Int32Array(heap, address, 2);
    Atomics.store(response, 1, count);
    Atomics.store(response, 0, status);
  };
  let out;
  try {
    const b = buffers.get(id);
    if (!b || offset + size > b.buffer.size) throw new Error('Invalid owned GPU readback source');
    if (size === 0) { publish(1, 0); return; }
    flush();
    const start = Math.floor(offset / 4) * 4, length = Math.ceil((offset + size) / 4) * 4 - start;
    out = device.createBuffer({ size: length, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(b.buffer, start, out, 0, length);
    device.queue.submit([enc.finish()]);
    out.mapAsync(GPUMapMode.READ).then(() => {
      try {
        views();
        const bytes = new Uint8Array(out.getMappedRange()).subarray(offset - start, offset - start + size);
        new Uint8Array(heap, address + 8, size).set(bytes);
        out.destroy();
        publish(1, size);
      } catch (e) {
        out.destroy(); publish(-1, 0);
        console.error('NXI-GPU owned readback ' + (e.message || e));
      }
    }, e => {
      out.destroy(); publish(-1, 0);
      console.error('NXI-GPU owned readback ' + (e.message || e));
    });
  } catch (e) {
    out?.destroy(); publish(-1, 0);
    throw e;
  }
}
