/* ============================================================
 * 主装配：场景几何 / GPU 资源 / 通道编排 / 主循环
 * 通道顺序：阴影 → 天空+地形+道具（HDR）→ 拷贝 → 水面（屏幕空间折射）→ Bloom → 合成
 * ============================================================ */
(function () {
  const S = window.Seaside;
  const m4 = S.M.m4;
  const G = S.G;
  const P = S.Props;
  const GPUX = S.GPUX;
  const W = S.WGSL;

  const R = (S.R = {
    ready: false, W: 0, H: 0, dpr: 1, scale: 1,
    solids: [], insts: [], casters: [], dyn: [], schools: [],
    simT: 0, last: 0, fpsEma: 60, lowFrames: 0, qualityStep: 0,
    postOn: true, shadowOn: true, bloom: 0.42, exposure: 1.05,
    camPos: [0, 3, 0], camTarget: [0, 3, 1]
  });

  const SUN = (function () { const d = [-0.34, 0.56, 0.76]; const l = Math.hypot(d[0], d[1], d[2]); return [d[0] / l, d[1] / l, d[2] / l]; })();
  S.SUN_DIR = SUN;

  /* ---------- 工具 ---------- */
  function merge(list) {
    const m = new G.Mesh();
    let off = 0;
    for (const s of list) {
      for (let i = 0; i < s.v.length; i++) m.v.push(s.v[i]);
      for (let i = 0; i < s.i.length; i++) m.i.push(s.i[i] + off);
      off += s.v.length / 9;
    }
    return m;
  }

  /* ---------- 场景几何 ---------- */
  function buildScene() {
    const veg = [], rock = [], under = [], pier = [];
    const rnd = S.rng(1.234);

    // 棕榈（海滩）
    const palmSpots = [[-34, -7], [-16, -3], [6, -5], [26, -8], [-58, 7], [52, -3], [78, -6]];
    for (let i = 0; i < palmSpots.length; i++) {
      const s = palmSpots[i];
      if (S.terrainHeight(s[0], s[1]) > 0.35) veg.push(P.palmMesh(s[0], s[1], i + 1, 0.9 + rnd() * 0.35));
    }
    // 阔叶树（内陆）
    const treeSpots = [[-88, -34], [-64, -22], [-30, -30], [4, -34], [40, -26], [70, -32],
      [-110, -52], [-46, -48], [22, -52], [58, -44], [-14, -62], [86, -50]];
    for (let i = 0; i < treeSpots.length; i++) {
      const s = treeSpots[i];
      if (S.terrainHeight(s[0], s[1]) > 1.0) veg.push(P.treeMesh(s[0], s[1], i + 21, 1.0 + rnd() * 0.7));
    }
    // 浮木
    for (let i = 0; i < 5; i++) {
      const x = -70 + rnd() * 140, z = -6 + rnd() * 8;
      if (S.terrainHeight(x, z) > 0.1 && S.terrainHeight(x, z) < 2.5) veg.push(P.driftMesh(x, z, i + 41));
    }
    // 草丛
    for (let i = 0; i < 46; i++) {
      const x = -120 + rnd() * 240, z = -60 + rnd() * 56;
      const h = S.terrainHeight(x, z);
      if (h > 0.5 && h < 6) veg.push(P.grassMesh(x, z, i + 61, false));
    }
    // 海蚀柱（海中）+ 沙滩礁石
    rock.push(P.rockMesh(-46, 46, 3.4, 3.1, true));
    rock.push(P.rockMesh(4, 58, 2.8, 5.7, true));
    rock.push(P.rockMesh(40, 42, 2.4, 8.3, true));
    for (let i = 0; i < 14; i++) {
      const x = -80 + rnd() * 160, z = -10 + rnd() * 22;
      const h = S.terrainHeight(x, z);
      if (h > -0.4 && h < 3.2) rock.push(P.rockMesh(x, z, 0.5 + rnd() * 1.1, i + 91, false));
    }
    // 水下礁石与海草
    for (let i = 0; i < 16; i++) {
      const x = -90 + rnd() * 180, z = 8 + rnd() * 70;
      const h = S.terrainHeight(x, z);
      if (h < -0.8) under.push(P.rockMesh(x, z, 0.7 + rnd() * 1.5, i + 131, false));
    }
    for (let i = 0; i < 26; i++) {
      const x = -90 + rnd() * 180, z = 6 + rnd() * 80;
      const h = S.terrainHeight(x, z);
      if (h < -0.6 && h > -7) under.push(P.grassMesh(x, z, i + 171, true));
    }
    pier.push(P.pierMesh(-52, 2, 64));

    return {
      veg: merge(veg).data(),
      rock: merge(rock).data(),
      under: merge(under).data(),
      pier: merge(pier).data()
    };
  }

  /* ---------- 实例化散布 ---------- */
  function scatter() {
    const rnd = S.rng(7.77);
    const pebbles = [], shells = [];
    for (let i = 0; i < 240; i++) {
      const x = -110 + rnd() * 220, z = -30 + rnd() * 40;
      const h = S.terrainHeight(x, z);
      if (h < 0.05 || h > 3.2) continue;
      pebbles.push({
        m: S.TRS(x, h - 0.02, z, rnd() * 6.28, rnd() * 0.4, rnd() * 0.4, 0.5 + rnd() * 0.9),
        c: [0.42 + rnd() * 0.22, 0.40 + rnd() * 0.2, 0.38 + rnd() * 0.18, 1]
      });
    }
    for (let i = 0; i < 90; i++) {
      const x = -110 + rnd() * 220, z = -26 + rnd() * 36;
      const h = S.terrainHeight(x, z);
      if (h < -0.1 || h > 1.6) continue;
      shells.push({
        m: S.TRS(x, h + 0.02, z, rnd() * 6.28, 0, rnd() * 0.3, 0.7 + rnd() * 0.5),
        c: [0.9 + rnd() * 0.1, 0.85 + rnd() * 0.1, 0.78 + rnd() * 0.1, 1]
      });
    }
    return {
      pebbleMesh: P.pebbleMesh().data(), pebbles,
      shellMesh: P.shellMesh().data(), shells
    };
  }

  /* ---------- 生态（动态） ---------- */
  function wildlife() {
    const rnd = S.rng(3.14);
    const crabs = [], birds = [];
    for (let i = 0; i < 14 && crabs.length < 6; i++) {
      const x = -50 + rnd() * 100, z = 4 + rnd() * 16;
      const h = S.terrainHeight(x, z);
      if (h < -0.2 || h > 1.8) continue;
      crabs.push({ x, z, y: h, dir: rnd() * 6.28, hide: 0, scared: false, t: rnd() * 6.28 });
    }
    for (let i = 0; i < 7; i++) {
      birds.push({
        cx: -60 + rnd() * 120, cz: 30 + rnd() * 90,
        r: 14 + rnd() * 24, y: 16 + rnd() * 14,
        sp: 0.22 + rnd() * 0.2, ph: rnd() * 6.28,
        dive: 0, diveT: 3 + rnd() * 8, flap: rnd() * 6.28
      });
    }
    const fishMesh = P.fishMesh().data();
    const schools = [];
    for (let i = 0; i < 3; i++) {
      const cx = -70 + rnd() * 140, cz = 20 + rnd() * 70;
      const cnt = 20 + Math.floor(rnd() * 10);
      schools.push({
        cx, cz, cnt, mesh: fishMesh,
        baseY: S.terrainHeight(cx, cz) + 1.4 + rnd() * 1.2,
        r: 2.2 + rnd() * 2.0, sp: 0.45 + rnd() * 0.35, ph: rnd() * 6.28,
        col: [[0.55, 0.62, 0.68, 1], [0.72, 0.66, 0.45, 1], [0.45, 0.60, 0.72, 1]][i]
      });
    }
    return { crabs, birds, schools };
  }

  /* ---------- 水面极坐标网格（近密远疏） ---------- */
  function buildWaterGrid() {
    const NR = 118, NA = 128;
    const step = Math.pow(375, 1 / NR);
    const A = 300 / (Math.pow(step, NR) - 1);
    const verts = new Float32Array((NR + 1) * NA * 2);
    const idx = new Uint32Array(NR * NA * 6);
    let p = 0;
    for (let i = 0; i <= NR; i++) {
      const r = A * (Math.pow(step, i) - 1);
      for (let j = 0; j < NA; j++) {
        const a = (j / NA) * Math.PI * 2;
        verts[p++] = Math.cos(a) * r;
        verts[p++] = Math.sin(a) * r;
      }
    }
    let q = 0;
    for (let i = 0; i < NR; i++) {
      for (let j = 0; j < NA; j++) {
        const j2 = (j + 1) % NA;
        const a = i * NA + j, b = i * NA + j2, c = (i + 1) * NA + j, d = (i + 1) * NA + j2;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    return { verts, idx, count: idx.length };
  }

  /* ---------- GPU 资源构建 ---------- */
  const VB_STRIDE = 36;   // pos3 + nrm3 + col3
  const IB_STRIDE = 80;   // mat4 + vec4

  function makeSolid(pipe, data, model, tint, m2) {
    const dev = GPUX.device;
    const vbuf = GPUX.buffer(data.verts, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, 'vbuf');
    const ibuf = GPUX.buffer(data.idx, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, 'ibuf');
    const arr = new Float32Array(24);
    arr.set(model || m4.create(), 0);
    arr.set(tint || [1, 1, 1, 0], 16);
    arr.set(m2 || [0.25, 24, 0, 0], 20);
    const ubuf = GPUX.buffer(arr, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'objU');
    const bg = GPUX.bind(pipe, 1, [{ binding: 0, resource: { buffer: ubuf } }], 'obj');
    return { vbuf, ibuf, ubuf, arr, bg, count: data.count };
  }

  function makeInst(pipe, data, list) {
    const dev = GPUX.device;
    const vbuf = GPUX.buffer(data.verts, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, 'ivbuf');
    const ibuf = GPUX.buffer(data.idx, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, 'iibuf');
    const inst = new Float32Array(list.length * 20);
    for (let i = 0; i < list.length; i++) {
      inst.set(list[i].m, i * 20);
      inst.set(list[i].c, i * 20 + 16);
    }
    const dbuf = GPUX.buffer(inst, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, 'instU');
    return { vbuf, ibuf, dbuf, data: inst, count: data.count, instCount: list.length };
  }

  /* ---------- 启动 ---------- */
  S.boot = async function () {
    const canvas = document.getElementById('gpuCanvas');
    try {
      await GPUX.init(canvas);
    } catch (e) {
      const el = document.getElementById('gpuError');
      if (el) { el.style.display = 'block'; el.textContent = '⚠ ' + e.message + '　请用 Chrome / Edge 113 以上版本打开；若使用本地文件方式打开受限，可在本目录执行 python -m http.server 8080 后访问 http://localhost:8080'; }
      if (S.ui) S.ui.hideBootTip();
      console.error(e);
      return;
    }
    const dev = GPUX.device;

    /* --- 尺寸 --- */
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * R.scale;
      const w = Math.max(320, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(240, Math.floor(canvas.clientHeight * dpr));
      if (w === R.W && h === R.H) return false;
      R.W = w; R.H = h;
      canvas.width = w; canvas.height = h;
      return true;
    }
    R.resize = resize;
    resize();

    /* --- Uniform 缓冲 --- */
    R.frameArr = new Float32Array(64);        // 256 B
    R.frameBuf = GPUX.buffer(R.frameArr, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'frame');
    R.shFrameArr = new Float32Array(64);
    R.shFrameBuf = GPUX.buffer(R.shFrameArr, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'shFrame');
    R.shArr = new Float32Array(20);           // lightVP(16) + info(4)
    R.shBuf = GPUX.buffer(R.shArr, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'shadow');
    R.waveArr = new Float32Array(S.WAVE_GPU.length * 4);
    S.WAVE_GPU.forEach((w, i) => R.waveArr.set(w, i * 4));
    R.waveBuf = GPUX.buffer(R.waveArr, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'waves');

    /* --- 管线 --- */
    const skyMod = GPUX.module(W.SKY, 'sky');
    const solidMod = GPUX.module(W.SOLID, 'solid');
    const instMod = GPUX.module(W.INST, 'inst');
    const waterMod = GPUX.module(W.WATER, 'water');
    const shDepthMod = GPUX.module(W.SHADOW_DEPTH, 'shadowDepth');
    const shInstMod = GPUX.module(W.SHADOW_INST, 'shadowInst');
    const brightMod = GPUX.module(W.POST_BRIGHT, 'bright');
    const blurMod = GPUX.module(W.POST_BLUR, 'blur');
    const compMod = GPUX.module(W.POST_COMP, 'comp');

    const vbLayout = [{
      arrayStride: VB_STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x3' }
      ]
    }];
    const instVbLayout = [{
      arrayStride: VB_STRIDE, stepMode: 'vertex',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x3' }
      ]
    }, {
      arrayStride: IB_STRIDE, stepMode: 'instance',
      attributes: [
        { shaderLocation: 3, offset: 0, format: 'float32x4' },
        { shaderLocation: 4, offset: 16, format: 'float32x4' },
        { shaderLocation: 5, offset: 32, format: 'float32x4' },
        { shaderLocation: 6, offset: 48, format: 'float32x4' },
        { shaderLocation: 7, offset: 64, format: 'float32x4' }
      ]
    }];

    R.skyPipe = GPUX.pipeline({
      label: 'sky', vs: { module: skyMod }, fs: { module: skyMod },
      targets: [{ format: 'rgba16float' }],
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      // 主渲染通道带 depth32float 附件，管线必须声明匹配的深度状态，否则 Attachment state 不兼容
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' }
    });
    R.solidPipe = GPUX.pipeline({
      label: 'solid', vs: { module: solidMod, buffers: vbLayout }, fs: { module: solidMod },
      vertexBuffers: vbLayout,
      targets: [{ format: 'rgba16float' }],
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }
    });
    R.instPipe = GPUX.pipeline({
      label: 'inst', vs: { module: instMod, buffers: instVbLayout }, fs: { module: instMod },
      vertexBuffers: instVbLayout,
      targets: [{ format: 'rgba16float' }],
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }
    });
    R.waterPipe = GPUX.pipeline({
      label: 'water', vs: { module: waterMod, buffers: [{
        arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
      }] }, fs: { module: waterMod },
      vertexBuffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }],
      targets: [{ format: 'rgba16float' }],
      primitive: { topology: 'triangle-list', cullMode: 'none' }
    });
    R.shadowPipe = GPUX.pipeline({
      label: 'shadow', vs: { module: shDepthMod, buffers: vbLayout },
      vertexBuffers: vbLayout,
      vertex: { module: shDepthMod, entryPoint: 'vs_main', buffers: vbLayout },
      depthStencil: {
        format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less',
        depthBias: 1, depthBiasSlopeScale: 2.0
      }
    });
    R.shadowInstPipe = GPUX.pipeline({
      label: 'shadowInst', vs: { module: shInstMod, buffers: instVbLayout },
      vertexBuffers: instVbLayout,
      vertex: { module: shInstMod, entryPoint: 'vs_main', buffers: instVbLayout },
      depthStencil: {
        format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less',
        depthBias: 1, depthBiasSlopeScale: 2.0
      }
    });

    /* --- 采样器与后处理管线 --- */
    R.samp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    R.shSamp = dev.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    const noVB = { vertex: { module: brightMod, entryPoint: 'vs_main' }, fs: { module: brightMod } };
    R.brightPipe = GPUX.pipeline({ label: 'bright', vs: { module: brightMod }, fs: { module: brightMod }, targets: [{ format: 'rgba16float' }], primitive: { topology: 'triangle-list', cullMode: 'none' } });
    R.blurPipe = GPUX.pipeline({ label: 'blur', vs: { module: blurMod }, fs: { module: blurMod }, targets: [{ format: 'rgba16float' }], primitive: { topology: 'triangle-list', cullMode: 'none' } });
    R.compPipe = GPUX.pipeline({ label: 'composite', vs: { module: compMod }, fs: { module: compMod }, targets: [{ format: GPUX.format }], primitive: { topology: 'triangle-list', cullMode: 'none' } });

    R.ppBright = new Float32Array([0.78, 0, 0, 0]); R.ppBrightBuf = GPUX.buffer(R.ppBright, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'ppBright');
    R.ppBlurH = new Float32Array([1, 0, 0, 0]); R.ppBlurHBuf = GPUX.buffer(R.ppBlurH, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'ppBlurH');
    R.ppBlurV = new Float32Array([0, 1, 0, 0]); R.ppBlurVBuf = GPUX.buffer(R.ppBlurV, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'ppBlurV');
    R.ppComp = new Float32Array([1.05, 0.42, 0.32, 0]); R.ppCompBuf = GPUX.buffer(R.ppComp, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'ppComp');

    /* --- 几何 --- */
    const stat = buildScene();
    const sc = scatter();
    const life = wildlife();
    R.terrain = makeSolid(R.solidPipe, S.buildTerrainMesh(192), m4.create(), [1, 1, 1, 0], [0.06, 12, 0, 0]);
    R.solids = [R.terrain];
    for (const key of ['veg', 'rock', 'under', 'pier']) {
      const o = makeSolid(R.solidPipe, stat[key], m4.create(), [1, 1, 1, 0],
        key === 'pier' ? [0.35, 28, 0, 0] : [0.18, 18, 0, 0]);
      R.solids.push(o);
      R[key + 'Obj'] = o;
    }

    // 船
    const boatParts = S.initBoat();
    R.boatHull = makeSolid(R.solidPipe, boatParts.hull, m4.create(), [1, 1, 1, 0], [0.45, 40, 0, 0]);
    R.oarL = makeSolid(R.solidPipe, boatParts.oarL, m4.create(), [1, 1, 1, 0], [0.3, 26, 0, 0]);
    R.oarR = makeSolid(R.solidPipe, boatParts.oarR, m4.create(), [1, 1, 1, 0], [0.3, 26, 0, 0]);
    R.solids.push(R.boatHull, R.oarL, R.oarR);
    R.casters = [R.vegObj, R.rockObj, R.pierObj, R.boatHull, R.oarL, R.oarR];

    // 螃蟹 / 海鸥（独立实体，逐帧改模型矩阵）
    R.crabState = life.crabs;
    R.birdState = life.birds;
    const crabData = P.crabMesh().data();
    R.crabs = life.crabs.map(() => makeSolid(R.solidPipe, crabData, m4.create(), [1, 1, 1, 0], [0.5, 32, 0, 0]));
    R.solids.push(...R.crabs);
    const birdData = P.birdMesh().data();
    R.birds = life.birds.map(() => makeSolid(R.solidPipe, birdData, m4.create(), [1, 1, 1, 0], [0.4, 30, 0, 0]));
    R.solids.push(...R.birds);

    // 实例化：卵石 / 贝壳 / 鱼群
    R.insts = [
      makeInst(R.instPipe, sc.pebbleMesh, sc.pebbles),
      makeInst(R.instPipe, sc.shellMesh, sc.shells)
    ];
    R.schools = life.schools.map((s) => {
      const list = [];
      for (let i = 0; i < s.cnt; i++) list.push({ m: m4.create(), c: s.col });
      const inst = makeInst(R.instPipe, s.mesh, list);
      inst.school = s;
      R.insts.push(inst);
      return inst;
    });

    // 水面
    const wg = buildWaterGrid();
    R.waterVerts = GPUX.buffer(wg.verts, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, 'wv');
    R.waterIdx = GPUX.buffer(wg.idx, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, 'wi');
    R.waterCount = wg.count;

    // 阴影贴图
    R.shadowTex = GPUX.texture(2048, 2048, 'depth32float',
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, 'shadowMap');
    R.shadowView = R.shadowTex.createView();

    /* --- 绑定组（依赖尺寸） --- */
    function buildSizeResources() {
      const w = R.W, h = R.H;
      if (R.sceneA) { R.sceneA.destroy(); R.sceneB.destroy(); R.depthTex.destroy(); }
      if (R.bloomA) { R.bloomA.destroy(); R.bloomB.destroy(); }
      R.sceneA = GPUX.texture(w, h, 'rgba16float',
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST, 'sceneA');
      R.sceneB = GPUX.texture(w, h, 'rgba16float',
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC, 'sceneB');
      R.depthTex = GPUX.texture(w, h, 'depth32float',
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, 'depth');
      R.sceneAView = R.sceneA.createView();
      R.sceneBView = R.sceneB.createView();
      R.depthView = R.depthTex.createView();
      const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
      R.bloomA = GPUX.texture(bw, bh, 'rgba16float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, 'bloomA');
      R.bloomB = GPUX.texture(bw, bh, 'rgba16float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, 'bloomB');
      R.bloomAView = R.bloomA.createView();
      R.bloomBView = R.bloomB.createView();
      R.bw = bw; R.bh = bh;

      R.skyBG = GPUX.bind(R.skyPipe, 0, [{ binding: 0, resource: { buffer: R.frameBuf } }], 'skyBG');
      R.solidBG = GPUX.bind(R.solidPipe, 0, [{ binding: 0, resource: { buffer: R.frameBuf } }], 'solidBG');
      R.instBG = GPUX.bind(R.instPipe, 0, [{ binding: 0, resource: { buffer: R.frameBuf } }], 'instBG');
      R.waterBG = GPUX.bind(R.waterPipe, 0, [{ binding: 0, resource: { buffer: R.frameBuf } }], 'waterBG');
      R.waterResBG = GPUX.bind(R.waterPipe, 1, [
        { binding: 0, resource: R.sceneAView },
        { binding: 1, resource: R.samp },
        { binding: 2, resource: { buffer: R.waveBuf } }
      ], 'waterRes');
      R.shadowSolidBG = GPUX.bind(R.solidPipe, 2, [
        { binding: 0, resource: { buffer: R.shBuf } },
        { binding: 1, resource: R.shadowView },
        { binding: 2, resource: R.shSamp }
      ], 'shadowSolid');
      R.shadowInstBG = GPUX.bind(R.instPipe, 1, [
        { binding: 0, resource: { buffer: R.shBuf } },
        { binding: 1, resource: R.shadowView },
        { binding: 2, resource: R.shSamp }
      ], 'shadowInst');
      R.shadowFrameBG = GPUX.bind(R.shadowPipe, 0, [{ binding: 0, resource: { buffer: R.shFrameBuf } }], 'shadowFrame');
      R.shadowInstFrameBG = GPUX.bind(R.shadowInstPipe, 0, [{ binding: 0, resource: { buffer: R.shFrameBuf } }], 'shadowInstFrame');

      // 阴影 pass 的 Obj 绑定组（与主管线布局不同）
      for (const o of R.casters) {
        o.shadowBG = GPUX.bind(R.shadowPipe, 1, [{ binding: 0, resource: { buffer: o.ubuf } }], 'castBG');
      }

      R.brightBG = GPUX.bind(R.brightPipe, 0, [
        { binding: 0, resource: R.sceneBView },
        { binding: 1, resource: R.samp },
        { binding: 2, resource: { buffer: R.ppBrightBuf } }
      ], 'brightBG');
      R.blurHBG = GPUX.bind(R.blurPipe, 0, [
        { binding: 0, resource: R.bloomAView },
        { binding: 1, resource: R.samp },
        { binding: 2, resource: { buffer: R.ppBlurHBuf } }
      ], 'blurHBG');
      R.blurVBG = GPUX.bind(R.blurPipe, 0, [
        { binding: 0, resource: R.bloomBView },
        { binding: 1, resource: R.samp },
        { binding: 2, resource: { buffer: R.ppBlurVBuf } }
      ], 'blurVBG');
      R.compBG = GPUX.bind(R.compPipe, 0, [
        { binding: 0, resource: R.sceneBView },
        { binding: 1, resource: R.bloomAView },
        { binding: 2, resource: R.samp },
        { binding: 3, resource: { buffer: R.ppCompBuf } }
      ], 'compBG');

      R.ppBlurH[2] = 1 / bw; R.ppBlurH[3] = 1 / bh;
      R.ppBlurV[2] = 1 / bw; R.ppBlurV[3] = 1 / bh;
      dev.queue.writeBuffer(R.ppBlurHBuf, 0, R.ppBlurH);
      dev.queue.writeBuffer(R.ppBlurVBuf, 0, R.ppBlurV);
    }
    buildSizeResources();
    R.buildSizeResources = buildSizeResources;

    S.postFXOn = () => R.postOn;
    S.setPostFX = (on) => { R.postOn = !!on; R.bloom = on ? 0.42 : 0.0; };
    S.setShadow = (on) => { R.shadowOn = !!on; };

    R.ready = true;
    if (S.ui) S.ui.hideBootTip();
    R.last = performance.now();
    requestAnimationFrame(frame);
  };

  /* ---------- 相机 ---------- */
  const view = m4.create(), proj = m4.create(), viewProj = m4.create(), invVP = m4.create();
  const lightView = m4.create(), lightProj = m4.create(), lightVP = m4.create();

  function updateCamera(dt) {
    const p = S.player, b = S.boat;
    if (p.mode === 'boat' && b) {
      const yaw = b.heading + (S.boatLookYaw || 0);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const pitchOff = (S.boatLookPitch || 0) * 2.2;
      const dx = b.x - fx * 7.8, dy = b.y + 3.3 + pitchOff, dz = b.z - fz * 7.8;
      const k = Math.min(1, dt * 3.2);
      R.camPos[0] += (dx - R.camPos[0]) * k;
      R.camPos[1] += (dy - R.camPos[1]) * k;
      R.camPos[2] += (dz - R.camPos[2]) * k;
      R.camTarget[0] = b.x + fx * 5.0;
      R.camTarget[1] = b.y + 0.8;
      R.camTarget[2] = b.z + fz * 5.0;
    } else {
      R.camPos[0] = p.pos[0];
      R.camPos[1] = p.pos[1] + p.eye;
      R.camPos[2] = p.pos[2];
      const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
      R.camTarget[0] = R.camPos[0] - Math.sin(p.yaw) * cp;
      R.camTarget[1] = R.camPos[1] + sp;
      R.camTarget[2] = R.camPos[2] - Math.cos(p.yaw) * cp;
    }
  }

  function updateShadow(cx, cz) {
    // 光源：沿太阳方向的平行光，正交范围覆盖玩家周围
    const d = 70, ext = 78;
    const eye = [cx + SUN[0] * d, SUN[1] * d + 20, cz + SUN[2] * d];
    m4.lookAt(lightView, eye, [cx, 0, cz], [0, 1, 0]);
    m4.ortho(lightProj, -ext, ext, -ext, ext, 1, 260);
    m4.mul(lightVP, lightProj, lightView);
  }

  /* ---------- 生态动画 ---------- */
  const _m = m4.create();
  function updateWildlife(t, dt) {
    const p = S.player;
    // 螃蟹：横行 + 靠近钻沙
    for (let i = 0; i < R.crabState.length; i++) {
      const c = R.crabState[i];        // 状态
      const o = R.crabs[i];            // GPU 实体
      const d = Math.hypot(p.pos[0] - c.x, p.pos[2] - c.z);
      if (d < 4.5) c.scared = true;
      else if (d > 7.0) c.scared = false;
      c.hide += ((c.scared ? 1 : 0) - c.hide) * Math.min(1, dt * (c.scared ? 6 : 2.2));
      if (!c.scared) {
        c.t += dt;
        c.dir += Math.sin(c.t * 0.7 + i) * dt * 0.6;
        const nx = c.x + Math.cos(c.dir) * dt * 0.55;
        const nz = c.z + Math.sin(c.dir) * dt * 0.55;
        const h = S.terrainHeight(nx, nz);
        if (h > -0.2 && h < 2.2) { c.x = nx; c.z = nz; c.y = h; }
        else c.dir += 2.1;
      }
      m4.compose(_m, c.x, c.y - c.hide * 0.42, c.z, c.dir + Math.PI / 2, 0, 0, 1.5, 1.5, 1.5);
      o.arr.set(_m, 0);
      GPUX.device.queue.writeBuffer(o.ubuf, 0, o.arr);
    }
    // 海鸥：盘旋 + 俯冲入海
    for (let i = 0; i < R.birdState.length; i++) {
      const s = R.birdState[i];        // 状态
      const b = R.birds[i];            // GPU 实体
      s.diveT -= dt;
      if (s.diveT <= 0 && s.dive <= 0) { s.dive = 1; s.diveT = 6 + (i % 3) * 3; }
      let y = s.y;
      if (s.dive > 0) {
        s.dive -= dt * 0.35;
        if (s.dive < 0) s.dive = 0;
        const k = Math.sin(Math.min(1, 1 - s.dive) * Math.PI);
        y = s.y - k * (s.y - 0.5);
      }
      const a = t * s.sp + s.ph;
      const x = s.cx + Math.cos(a) * s.r;
      const z = s.cz + Math.sin(a) * s.r;
      const yaw = -a + Math.PI / 2;
      const flap = Math.sin(t * 7 + s.ph) * 0.25;
      m4.compose(_m, x, y + Math.sin(t * 0.7 + s.ph) * 0.8, z, yaw, s.dive > 0 ? -0.5 : 0, flap, 1.6, 1.6, 1.6);
      b.arr.set(_m, 0);
      GPUX.device.queue.writeBuffer(b.ubuf, 0, b.arr);
    }
    // 鱼群
    for (const inst of R.schools) {
      const sc = inst.school;
      for (let i = 0; i < sc.cnt; i++) {
        const a = t * sc.sp + i * 0.42 + sc.ph;
        const rr = sc.r * (0.55 + 0.45 * Math.sin(a * 0.7));
        const x = sc.cx + Math.cos(a) * rr;
        const z = sc.cz + Math.sin(a) * rr;
        const y = sc.baseY + Math.sin(a * 1.3 + i) * 0.35;
        m4.compose(_m, x, y, z, -a + Math.PI / 2, 0, Math.sin(t * 6 + i) * 0.15, 1.3, 1.3, 1.3);
        inst.data.set(_m, i * 20);
      }
      GPUX.device.queue.writeBuffer(inst.dbuf, 0, inst.data);
    }
  }

  /* ---------- 自检：回读一帧像素，确认不是黑屏 ---------- */
  function h2f(h) {
    const s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : (s ? -Infinity : Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  S.probe = function () {
    const dev = GPUX.device;
    const bpr = Math.ceil((R.W * 8) / 256) * 256;      // rgba16float = 8 字节/像素
    const buf = dev.createBuffer({
      size: bpr * R.H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: R.sceneB }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: R.H }, [R.W, R.H, 1]
    );
    dev.queue.submit([enc.finish()]);
    buf.mapAsync(GPUMapMode.READ).then(() => {
      const u16 = new Uint16Array(buf.getMappedRange().slice(0));
      buf.unmap(); buf.destroy();
      let sum = 0, n = 0, mx = 0, sr = 0, sg = 0, sb = 0;
      const stride = Math.max(4, Math.floor(u16.length / 20000) * 4);
      for (let i = 0; i < u16.length; i += stride) {
        const r = h2f(u16[i]), g = h2f(u16[i + 1]), b = h2f(u16[i + 2]);
        sr += r; sg += g; sb += b;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += lum; n++; if (lum > mx) mx = lum;
      }
      const avg = sum / Math.max(1, n);
      R.probeResult = {
        avg: +avg.toFixed(4), max: +mx.toFixed(3),
        rgb: [+(sr / n).toFixed(3), +(sg / n).toFixed(3), +(sb / n).toFixed(3)]
      };
      console.log('[自检] 平均亮度=' + avg.toFixed(4) + ' 最大亮度=' + mx.toFixed(3) +
        ' 平均RGB=' + R.probeResult.rgb.join(','));
      if (avg < 0.002) {
        const el = document.getElementById('bootTip');
        if (el) {
          el.classList.remove('gone');
          el.textContent = '⚠ 画面输出接近全黑，请按 F12 查看控制台错误（WebGPU 管线可能未正确建立）';
        }
      }
    }).catch((e) => console.warn('[自检] 像素回读失败', e));
  };
  S.probeNow = function () { try { S.probe(); } catch (e) { console.warn(e); } };

  /* ---------- 主循环 ---------- */
  function frame(now) {
    const dtRaw = (now - R.last) / 1000;
    R.last = now;
    const dt = Math.min(Math.max(dtRaw, 0.0005), 0.05);
    R.simT += dt;
    const t = R.simT;

    if (resize()) R.buildSizeResources();

    // 逻辑
    S.updatePlayer(dt, t);
    S.updateBoat(dt, t);
    updateWildlife(t, dt);
    updateCamera(dt);

    // 船与桨的模型矩阵
    const bm = S.boatMatrix(_m);
    R.boatHull.arr.set(bm, 0);
    GPUX.device.queue.writeBuffer(R.boatHull.ubuf, 0, R.boatHull.arr);
    S.oarMatrix(_m, bm, 1); R.oarL.arr.set(_m, 0);
    GPUX.device.queue.writeBuffer(R.oarL.ubuf, 0, R.oarL.arr);
    S.oarMatrix(_m, bm, -1); R.oarR.arr.set(_m, 0);
    GPUX.device.queue.writeBuffer(R.oarR.ubuf, 0, R.oarR.arr);

    // 相机矩阵
    const aspect = R.W / R.H;
    m4.perspective(proj, 1.15, aspect, 0.1, 900);
    m4.lookAt(view, R.camPos, R.camTarget, [0, 1, 0]);
    m4.mul(viewProj, proj, view);
    m4.invert(invVP, viewProj);

    // 水下判定
    const surf = S.waveHeight(R.camPos[0], R.camPos[2], t);
    const under = R.camPos[1] < surf - 0.05 ? 1 : 0;
    if (under !== R.lastUnder) {
      R.lastUnder = under;
      if (S.ui) S.ui.setUnderwater(under === 1);
      if (S.audio) S.audio.setUnderwater(under === 1);
    }

    // Frame uniform
    const f = R.frameArr;
    f.set(viewProj, 0);
    f.set(invVP, 16);
    f[32] = R.camPos[0]; f[33] = R.camPos[1]; f[34] = R.camPos[2]; f[35] = t;
    f[36] = SUN[0]; f[37] = SUN[1]; f[38] = SUN[2]; f[39] = under;
    f[40] = 0.75; f[41] = 0.88; f[42] = 0.94; f[43] = 0.0022;
    f[44] = R.exposure; f[45] = 0.95; f[46] = R.shadowOn ? 0.85 : 0; f[47] = 1.0;
    f[48] = R.W; f[49] = R.H; f[50] = 1 / R.W; f[51] = 1 / R.H;
    f[52] = proj[10]; f[53] = proj[14]; f[54] = 0.1; f[55] = 900;
    f[56] = R.camPos[0]; f[57] = R.camPos[2]; f[58] = 0; f[59] = 0;
    GPUX.device.queue.writeBuffer(R.frameBuf, 0, f);

    // 阴影矩阵
    updateShadow(R.camPos[0], R.camPos[2]);
    R.shArr.set(lightVP, 0);
    R.shArr[16] = R.shadowOn ? 0.85 : 0; R.shArr[17] = 1 / 2048; R.shArr[18] = 0; R.shArr[19] = 0;
    GPUX.device.queue.writeBuffer(R.shBuf, 0, R.shArr);
    R.shFrameArr.set(lightVP, 0);
    GPUX.device.queue.writeBuffer(R.shFrameBuf, 0, R.shFrameArr);

    // 合成参数
    R.ppComp[0] = R.exposure;
    R.ppComp[1] = R.bloom;
    R.ppComp[2] = 0.32;
    R.ppComp[3] = t;
    GPUX.device.queue.writeBuffer(R.ppCompBuf, 0, R.ppComp);

    encode();

    // FPS 与自适应画质
    if (dtRaw > 0) {
      const fps = 1 / dtRaw;
      R.fpsEma += (fps - R.fpsEma) * 0.06;
      if (R.fpsEma < 45) R.lowFrames++; else R.lowFrames = Math.max(0, R.lowFrames - 1);
      if (R.lowFrames > 90 && R.qualityStep < 2) {
        R.qualityStep++;
        R.scale = R.qualityStep === 1 ? 0.85 : 0.7;
        R.lowFrames = 0;
        resize(true);
        R.buildSizeResources();
        if (R.qualityStep === 2) R.shadowOn = false;
      }
      if (S.ui && S.ui.setFps) S.ui.setFps(Math.round(R.fpsEma));
    }
    if (S.audio && S.audio.tick) S.audio.tick();
    if (!R.probed && R.frameNo > 40) { R.probed = true; try { S.probe(); } catch (e) { console.warn(e); } }
    R.frameNo = (R.frameNo || 0) + 1;
    if (S.ui) {
      S.ui.setMode(S.player.mode === 'boat' ? '驾船中' : S.player.mode === 'swim' ? '游泳中' : '漫步中');
      const b = S.boat;
      const near = b && Math.hypot(S.player.pos[0] - b.x, S.player.pos[2] - b.z) < 5.5;
      S.ui.setPrompt(S.player.mode === 'boat' ? '' : near ? '按 E 登船' : '');
    }
    requestAnimationFrame(frame);
  }

  function resize(force) {
    const canvas = GPUX.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * R.scale;
    const w = Math.max(320, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(240, Math.floor(canvas.clientHeight * dpr));
    if (!force && w === R.W && h === R.H) return false;
    R.W = w; R.H = h;
    canvas.width = w; canvas.height = h;
    return true;
  }

  /* ---------- 编码 ---------- */
  function encode() {
    const dev = GPUX.device;
    const enc = dev.createCommandEncoder();

    // 1) 阴影
    if (R.shadowOn) {
      const sp = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: R.shadowView, depthClearValue: 1.0,
          depthLoadOp: 'clear', depthStoreOp: 'store'
        }
      });
      sp.setPipeline(R.shadowPipe);
      sp.setBindGroup(0, R.shadowFrameBG);
      for (const o of R.casters) {
        sp.setBindGroup(1, o.shadowBG);
        sp.setVertexBuffer(0, o.vbuf);
        sp.setIndexBuffer(o.ibuf, 'uint32');
        sp.drawIndexed(o.count);
      }
      sp.end();
    }

    // 2) 天空 + 不透明场景
    const mp = enc.beginRenderPass({
      colorAttachments: [{
        view: R.sceneAView, clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: R.depthView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store'
      }
    });
    mp.setPipeline(R.skyPipe);
    mp.setBindGroup(0, R.skyBG);
    mp.draw(3);

    mp.setPipeline(R.solidPipe);
    mp.setBindGroup(0, R.solidBG);
    mp.setBindGroup(2, R.shadowSolidBG);
    for (const o of R.solids) {
      mp.setBindGroup(1, o.bg);
      mp.setVertexBuffer(0, o.vbuf);
      mp.setIndexBuffer(o.ibuf, 'uint32');
      mp.drawIndexed(o.count);
    }

    mp.setPipeline(R.instPipe);
    mp.setBindGroup(0, R.instBG);
    mp.setBindGroup(1, R.shadowInstBG);
    for (const o of R.insts) {
      mp.setVertexBuffer(0, o.vbuf);
      mp.setVertexBuffer(1, o.dbuf);
      mp.setIndexBuffer(o.ibuf, 'uint32');
      mp.drawIndexed(o.count, o.instCount);
    }
    mp.end();

    // 3) 场景 A → B，供水面折射采样
    enc.copyTextureToTexture(
      { texture: R.sceneA }, { texture: R.sceneB }, [R.W, R.H, 1]
    );

    // 4) 水面（采样场景色/深度，自行手动剔除被遮挡的片元）
    const wp = enc.beginRenderPass({
      colorAttachments: [{ view: R.sceneBView, loadOp: 'load', storeOp: 'store' }]
    });
    wp.setPipeline(R.waterPipe);
    wp.setBindGroup(0, R.waterBG);
    wp.setBindGroup(1, R.waterResBG);
    wp.setVertexBuffer(0, R.waterVerts);
    wp.setIndexBuffer(R.waterIdx, 'uint32');
    wp.drawIndexed(R.waterCount);
    wp.end();

    // 5) Bloom
    if (R.postOn) {
      let pp = enc.beginRenderPass({
        colorAttachments: [{ view: R.bloomAView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
      });
      pp.setPipeline(R.brightPipe);
      pp.setBindGroup(0, R.brightBG);
      pp.draw(3);
      pp.end();

      pp = enc.beginRenderPass({
        colorAttachments: [{ view: R.bloomBView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
      });
      pp.setPipeline(R.blurPipe);
      pp.setBindGroup(0, R.blurHBG);
      pp.draw(3);
      pp.end();

      pp = enc.beginRenderPass({
        colorAttachments: [{ view: R.bloomAView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
      });
      pp.setPipeline(R.blurPipe);
      pp.setBindGroup(0, R.blurVBG);
      pp.draw(3);
      pp.end();
    }

    // 6) 合成到画布
    const cp = enc.beginRenderPass({
      colorAttachments: [{
        view: GPUX.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store'
      }]
    });
    cp.setPipeline(R.compPipe);
    cp.setBindGroup(0, R.compBG);
    cp.draw(3);
    cp.end();

    dev.queue.submit([enc.finish()]);
  }

  /* ---------- 开场 ---------- */
  S.start = function () {
    const ov = document.getElementById('startOverlay');
    if (ov) { ov.classList.add('hide'); setTimeout(() => { ov.style.display = 'none'; }, 700); }
    S.started = true;
    if (S.audio && S.audio.init) S.audio.init();
  };

  window.addEventListener('DOMContentLoaded', () => {
    S.boot();
  });
})();
