/* ============================================================
 * 地形：高度函数 + 网格烘焙（顶点色：干沙/湿沙/岩石/海床）
 * ============================================================ */
(function () {
  const S = window.Seaside;

  S.CFG = {
    WORLD_SIZE: 520,
    EYE: 1.65,
    WALK: 5.2,
    RUN: 9.2,
    SWIM: 2.6,
    WORLD_LIMIT: 242
  };

  /* ---------- 地形高度（海平面 = 0，陆地在 -z 方向） ---------- */
  S.terrainHeight = (x, z) => {
    let h = 7.5 * (1 - S.smoothstep(-130, 18, z));
    h -= S.smoothstep(18, 150, z) * 9.0;
    const inland = S.smoothstep(14, -46, z);
    h += inland * (S.fbm(x * 0.021 + 7.3, z * 0.021 + 3.1) - 0.5) * 4.6;
    h += (S.fbm(x * 0.09, z * 0.09) - 0.5) * 0.6;

    // 西侧海岬丘陵
    h += 10.5 * S.smoothstep(-58, -175, x) *
      (0.5 + 0.95 * S.fbm(x * 0.02 + 5.2, z * 0.02 + 9.7));

    // 东侧小岛（驾船可前往）
    const dx = x - 128, dz = z - 62;
    h += 6.4 * Math.exp(-(dx * dx + dz * dz) / 1500);

    // 边缘抬升（仅陆地侧）
    if (z < 5) h += 12 * S.smoothstep(158, 205, Math.max(Math.abs(x), Math.abs(z)));
    return h;
  };

  /* ---------- 顶点着色 ---------- */
  const C_DRY = [0.855, 0.769, 0.604];   // 干沙
  const C_WET = [0.612, 0.549, 0.435];   // 湿沙
  const C_ROCK = [0.427, 0.400, 0.365];  // 岩石
  const C_GRASS = [0.392, 0.478, 0.288]; // 耐盐草
  const C_BED = [0.690, 0.647, 0.510];   // 浅海床
  const C_DEEP = [0.180, 0.243, 0.259];  // 深海床

  function colorAt(x, z, h, slope) {
    const n = S.fbm(x * 0.35, z * 0.35, 3);
    let c;
    if (h < 0) {
      const t = S.smoothstep(-0.3, -7.5, h);
      c = [
        C_BED[0] + (C_DEEP[0] - C_BED[0]) * t,
        C_BED[1] + (C_DEEP[1] - C_BED[1]) * t,
        C_BED[2] + (C_DEEP[2] - C_BED[2]) * t
      ];
    } else {
      // 湿沙带（刚退潮处）
      const wet = 1 - S.smoothstep(0.05, 0.75, h);
      c = [
        C_DRY[0] + (C_WET[0] - C_DRY[0]) * wet,
        C_DRY[1] + (C_WET[1] - C_DRY[1]) * wet,
        C_DRY[2] + (C_WET[2] - C_DRY[2]) * wet
      ];
      // 内陆高处长草
      const grass = S.smoothstep(1.6, 4.2, h) * S.smoothstep(30, -30, z) *
        S.smoothstep(0.35, 0.62, S.fbm(x * 0.06 + 3, z * 0.06 + 8, 3));
      for (let i = 0; i < 3; i++) c[i] = c[i] + (C_GRASS[i] - c[i]) * grass * 0.8;
    }
    // 陡坡露岩
    const rock = S.smoothstep(0.35, 0.95, slope);
    for (let i = 0; i < 3; i++) c[i] = c[i] + (C_ROCK[i] - c[i]) * rock;
    // 细碎色斑
    const d = (n - 0.5) * 0.09;
    return [S.clamp(c[0] + d, 0, 1), S.clamp(c[1] + d, 0, 1), S.clamp(c[2] + d, 0, 1)];
  }

  /* ---------- 网格烘焙 ---------- */
  // 顶点布局：pos(3) normal(3) color(3) = 9 floats
  S.buildTerrainMesh = function (seg) {
    seg = seg || 256;
    const half = S.CFG.WORLD_SIZE / 2;
    const n = seg + 1;
    const verts = new Float32Array(n * n * 9);
    const idx = new Uint32Array(seg * seg * 6);
    const step = S.CFG.WORLD_SIZE / seg;

    let p = 0;
    for (let j = 0; j < n; j++) {
      const z = -half + j * step;
      for (let i = 0; i < n; i++) {
        const x = -half + i * step;
        const h = S.terrainHeight(x, z);
        // 法线：有限差分
        const e = 0.6;
        const hx = S.terrainHeight(x + e, z) - S.terrainHeight(x - e, z);
        const hz = S.terrainHeight(x, z + e) - S.terrainHeight(x, z - e);
        let nx = -hx / (2 * e), ny = 1, nz = -hz / (2 * e);
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;
        const slope = Math.hypot(hx, hz) / (2 * e);
        const c = colorAt(x, z, h, slope);
        verts[p++] = x; verts[p++] = h; verts[p++] = z;
        verts[p++] = nx; verts[p++] = ny; verts[p++] = nz;
        verts[p++] = c[0]; verts[p++] = c[1]; verts[p++] = c[2];
      }
    }

    let q = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    return { verts, idx, count: idx.length };
  };
})();
