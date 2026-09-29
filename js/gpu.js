/* ============================================================
 * WebGPU 设备与资源封装（含错误捕获，便于真机诊断）
 * ============================================================ */
(function () {
  const S = window.Seaside;

  const GPUX = {
    device: null, context: null, format: null, canvas: null,
    errors: [],
    counts: {},
    log(msg) {
      msg = String(msg);
      if (GPUX.counts[msg]) { GPUX.counts[msg]++; return; }   // 去重：保留首次错误，避免刷屏淹没根因
      GPUX.counts[msg] = 1;
      GPUX.errors.push(msg);
      if (GPUX.errors.length > 40) GPUX.errors.shift();
      console.error('[WebGPU] ' + msg);
    }
  };

  /* ---------- 初始化 ---------- */
  GPUX.init = async function (canvas) {
    if (!navigator.gpu) throw new Error('当前浏览器不支持 WebGPU（需 Chrome/Edge 113+）');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('未获取到 GPU 适配器（requestAdapter 返回 null）');
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('无法创建 WebGPU 画布上下文');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    device.addEventListener('uncapturederror', (e) => GPUX.log(e.error.message));
    device.onuncapturederror = (e) => GPUX.log(e.error.message);

    GPUX.device = device;
    GPUX.context = ctx;
    GPUX.format = format;
    GPUX.canvas = canvas;
    GPUX.adapterInfo = adapter.info ? {
      vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      device: adapter.info.device, description: adapter.info.description
    } : null;
    return GPUX;
  };

  /* ---------- 着色器模块（带编译信息检查） ---------- */
  GPUX.module = function (code, label) {
    const device = GPUX.device;
    const mod = device.createShaderModule({ code, label: label || 'shader' });
    mod.getCompilationInfo().then((info) => {
      for (const m of info.messages) {
        if (m.type !== 'info') {
          GPUX.log(`${label} [${m.type}] line ${m.lineNum}:${m.linePos} ${m.message}`);
        }
      }
    }).catch(() => {});
    return mod;
  };

  /* ---------- 缓冲 ---------- */
  GPUX.buffer = function (data, usage, label) {
    const device = GPUX.device;
    const size = Math.max(16, Math.ceil(data.byteLength / 16) * 16);
    const buf = device.createBuffer({ size, usage, label });
    if (data.byteLength) device.queue.writeBuffer(buf, 0, data);
    return buf;
  };

  GPUX.vertIndex = function (arr, label) {
    const isU32 = arr instanceof Uint32Array;
    const usage = GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST;
    return GPUX.buffer(isU32 ? arr : new Uint16Array(arr), usage, label);
  };

  /* ---------- 纹理 ---------- */
  GPUX.texture = function (w, h, format, usage, label) {
    return GPUX.device.createTexture({
      size: [w, h, 1], format, usage, label,
      dimension: '2d'
    });
  };

  GPUX.view = function (tex, format) {
    return tex.createView();
  };

  /* ---------- 渲染管线 ---------- */
  GPUX.pipeline = function (opts) {
    const device = GPUX.device;
    const layout = opts.bindLayouts
      ? device.createPipelineLayout({ bindGroupLayouts: opts.bindLayouts })
      : 'auto';
    return device.createRenderPipeline({
      label: opts.label,
      layout,
      vertex: {
        module: opts.vs.module, entryPoint: opts.vs.entry || 'vs_main',
        buffers: opts.vertexBuffers || []
      },
      fragment: opts.fs ? {
        module: opts.fs.module, entryPoint: opts.fs.entry || 'fs_main',
        targets: opts.targets
      } : undefined,
      primitive: opts.primitive || { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: opts.depthStencil || undefined
    });
  };

  /* ---------- 便捷：自动布局的 bind group ---------- */
  GPUX.bind = function (pipeline, index, entries, label) {
    const device = GPUX.device;
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(index),
      entries, label
    });
  };

  S.GPUX = GPUX;
})();
