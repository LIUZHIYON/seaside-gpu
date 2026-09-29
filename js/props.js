/* ============================================================
 * 道具与生态：棕榈 / 阔叶树 / 礁石 / 海蚀柱 / 木栈桥 / 螃蟹 / 海鸥 / 鱼 / 海草
 * 返回网格数据，由 main.js 上传为 GPU 缓冲
 * ============================================================ */
(function () {
  const S = window.Seaside;
  const G = S.G;
  const m4 = S.M.m4;
  const C = G.C;

  function TRS(px, py, pz, ry, rx, rz, s) {
    if (s === undefined) s = 1;
    return m4.compose(m4.create(), px, py, pz, ry || 0, rx || 0, rz || 0,
      typeof s === 'number' ? s : s[0], typeof s === 'number' ? s : s[1], typeof s === 'number' ? s : s[2]);
  }
  S.TRS = TRS;

  /* ---------- 棕榈树 ---------- */
  function palmMesh(x, z, seed, scale) {
    const m = new G.Mesh();
    const rnd = S.rng(seed * 7.31 + 1.7);
    const lean = (rnd() - 0.5) * 0.35;
    const h = 5.2 + rnd() * 2.4;
    const segs = 7;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const seglen = h / segs;
      const bend = lean * t * t;
      const r0 = 0.30 * (1 - t * 0.55), r1 = 0.30 * (1 - (t + 1 / segs) * 0.55);
      const ry = rnd() * 6.28;
      G.addCyl(m, r0, r1, seglen * 1.05, 8,
        TRS(px, py + seglen / 2, pz, ry, bend * 0.35, bend, [1, 1, 1]),
        [C.wood[0] + t * 0.06, C.wood[1] + t * 0.05, C.wood[2] + t * 0.04]);
      px += Math.sin(bend) * seglen * 0.6;
      py += seglen;
      pz += Math.sin(bend) * seglen * 0.25;
    }
    // 椰果
    for (let i = 0; i < 3; i++) {
      const a = rnd() * 6.28;
      G.addSphere(m, 0.09, 6, 5, TRS(px + Math.cos(a) * 0.16, py - 0.1, pz + Math.sin(a) * 0.16, 0, 0, 0, 1),
        [0.38, 0.30, 0.18]);
    }
    // 叶片
    const nLeaf = 8;
    for (let i = 0; i < nLeaf; i++) {
      const a = (i / nLeaf) * 6.28 + rnd() * 0.25;
      const droop = -0.55 - rnd() * 0.45;
      const len = 2.1 + rnd() * 0.9;
      const mt = m4.mul(m4.create(),
        TRS(px, py, pz, a, droop, 0.12, 1),
        TRS(len / 2, 0, 0, 0, 0, 0, 1));
      const shade = 0.85 + rnd() * 0.3;
      G.addQuad(m, len, 0.72, mt, [C.palm[0] * shade, C.palm[1] * shade, C.palm[2] * shade]);
    }
    const base = S.terrainHeight(x, z);
    const world = TRS(x, base - 0.15, z, rnd() * 6.28, 0, 0, scale);
    // 直接把局部网格烘焙到世界坐标
    return bake(m, world);
  }

  /* ---------- 阔叶树（递归分枝） ---------- */
  function treeMesh(x, z, seed, scale) {
    const m = new G.Mesh();
    const rnd = S.rng(seed * 3.77 + 9.1);
    const bark = [C.wood[0] * 0.95, C.wood[1] * 0.95, C.wood[2] * 0.95];

    function branch(origin, dir, len, rad, depth) {
      const end = [
        origin[0] + dir[0] * len, origin[1] + dir[1] * len, origin[2] + dir[2] * len
      ];
      // 圆柱默认沿 +y，需旋转到 dir
      const yaw = Math.atan2(dir[0], dir[2]);
      const pitch = Math.acos(S.clamp(dir[1], -1, 1));
      G.addCyl(m, rad, rad * 0.72, len, 6,
        TRS((origin[0] + end[0]) / 2, (origin[1] + end[1]) / 2, (origin[2] + end[2]) / 2,
          yaw, pitch, 0, 1), bark);
      if (depth <= 0) {
        const shade = 0.8 + rnd() * 0.4;
        G.addSphere(m, len * 0.78, 6, 5,
          TRS(end[0], end[1] + len * 0.15, end[2], rnd() * 6.28, rnd() * 0.6, rnd() * 0.6, [1.1, 0.85, 1.1]),
          [C.leaf[0] * shade, C.leaf[1] * shade, C.leaf[2] * shade]);
        return;
      }
      const nb = 2 + (rnd() > 0.6 ? 1 : 0);
      for (let i = 0; i < nb; i++) {
        const nd = [
          dir[0] + (rnd() - 0.5) * 1.1,
          dir[1] + (rnd() - 0.3) * 0.55,
          dir[2] + (rnd() - 0.5) * 1.1
        ];
        const l = Math.hypot(nd[0], nd[1], nd[2]) || 1;
        branch(end, [nd[0] / l, Math.max(nd[1] / l, 0.15), nd[2] / l], len * (0.66 + rnd() * 0.12), rad * 0.68, depth - 1);
      }
    }
    branch([0, 0, 0], [0, 1, 0], 1.5, 0.17, 3);
    const base = S.terrainHeight(x, z);
    return bake(m, TRS(x, base - 0.1, z, rnd() * 6.28, 0, 0, scale));
  }

  /* ---------- 岩石（含海蚀柱） ---------- */
  function rockMesh(x, z, r, seed, tall) {
    const m = new G.Mesh();
    const rnd = S.rng(seed * 5.13 + 2.9);
    const n = tall ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const rr = r * (tall ? (1 - t * 0.55) : (0.55 + rnd() * 0.5));
      const yy = tall ? t * r * 2.6 : (rnd() - 0.3) * r * 0.5;
      const shade = 0.85 + rnd() * 0.3;
      G.addSphere(m, rr, 7, 6,
        TRS((rnd() - 0.5) * r * (tall ? 0.5 : 1.1), yy, (rnd() - 0.5) * r * (tall ? 0.5 : 1.1),
          rnd() * 6.28, rnd() * 0.5, rnd() * 0.5, [1, 0.75 + rnd() * 0.3, 1]),
        [C.rock[0] * shade, C.rock[1] * shade, C.rock[2] * shade]);
    }
    const base = tall ? S.terrainHeight(x, z) - 1.0 : S.terrainHeight(x, z) - r * 0.25;
    return bake(m, TRS(x, base, z, rnd() * 6.28, 0, 0, 1));
  }

  /* ---------- 浮木 ---------- */
  function driftMesh(x, z, seed) {
    const m = new G.Mesh();
    const rnd = S.rng(seed * 11.3 + 4.4);
    const len = 3.0 + rnd() * 2.2;
    G.addCyl(m, 0.16, 0.12, len, 7,
      TRS(0, 0.16, 0, rnd() * 6.28, Math.PI / 2 - 0.08, 0, 1),
      [C.wood[0] * 0.8, C.wood[1] * 0.8, C.wood[2] * 0.8]);
    G.addCyl(m, 0.08, 0.06, 1.5, 6,
      TRS(0.7, 0.42, 0.25, 0.9, 1.2, 0.7, 1),
      [C.wood[0] * 0.75, C.wood[1] * 0.75, C.wood[2] * 0.75]);
    return bake(m, TRS(x, S.terrainHeight(x, z) + 0.02, z, rnd() * 6.28, 0, 0, 1));
  }

  /* ---------- 草丛 / 海草 ---------- */
  function grassMesh(x, z, seed, underwater) {
    const m = new G.Mesh();
    const rnd = S.rng(seed * 13.7 + 6.1);
    const n = 7;
    const col = underwater ? [0.16, 0.36, 0.26] : [0.35, 0.52, 0.28];
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28;
      const hgt = 0.32 + rnd() * 0.42;
      const mt = m4.mul(m4.create(),
        TRS(Math.cos(a) * 0.16, hgt / 2, Math.sin(a) * 0.16, a, 0, (rnd() - 0.5) * 0.5, 1),
        TRS(0, 0, 0, 0, 0, 0, 1));
      G.addQuad(m, 0.14, hgt, mt, [col[0] * (0.8 + rnd() * 0.4), col[1] * (0.8 + rnd() * 0.4), col[2] * (0.8 + rnd() * 0.4)]);
    }
    const y = underwater ? S.terrainHeight(x, z) + 0.05 : S.terrainHeight(x, z);
    return bake(m, TRS(x, y, z, 0, 0, 0, 1));
  }

  /* ---------- 螃蟹 ---------- */
  function crabMesh() {
    const m = new G.Mesh();
    const body = [0.62, 0.32, 0.22];
    G.addSphere(m, 0.26, 8, 6, TRS(0, 0.16, 0, 0, 0, 0, [1.35, 0.62, 1]), body);
    // 眼睛
    for (const sx of [-1, 1]) {
      G.addCyl(m, 0.025, 0.025, 0.14, 5, TRS(sx * 0.1, 0.30, 0.16, 0, 0.25, 0, 1), [0.1, 0.1, 0.1]);
      G.addSphere(m, 0.04, 6, 5, TRS(sx * 0.1, 0.37, 0.18, 0, 0, 0, 1), [0.08, 0.08, 0.08]);
    }
    // 腿
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const zz = -0.16 + i * 0.16;
        G.addCyl(m, 0.022, 0.016, 0.30, 5, TRS(sx * 0.30, 0.12, zz, 0, 0, sx * 1.05, 1), [0.5, 0.28, 0.2]);
        G.addCyl(m, 0.018, 0.010, 0.22, 5, TRS(sx * 0.44, 0.04, zz, 0, 0, sx * 0.55, 1), [0.45, 0.24, 0.17]);
      }
      // 钳
      G.addCyl(m, 0.035, 0.028, 0.26, 5, TRS(sx * 0.26, 0.18, 0.26, sx * 0.5, 0, sx * 0.8, 1), [0.55, 0.3, 0.2]);
      G.addSphere(m, 0.09, 6, 5, TRS(sx * 0.34, 0.20, 0.40, 0, 0, 0, [1.3, 0.7, 1]), [0.66, 0.34, 0.22]);
    }
    return m;
  }

  /* ---------- 海鸥 ---------- */
  function birdMesh() {
    const m = new G.Mesh();
    const white = [0.94, 0.94, 0.92];
    G.addSphere(m, 0.11, 7, 6, TRS(0, 0, 0, 0, 0, 0, [2.1, 1, 1]), white);
    G.addSphere(m, 0.07, 6, 5, TRS(0, 0.03, 0.22, 0, 0, 0, 1), white);
    G.addCyl(m, 0.012, 0.03, 0.08, 5, TRS(0, 0.03, 0.30, Math.PI / 2, 0, 0, 1), [0.9, 0.62, 0.22]);
    for (const sx of [-1, 1]) {
      G.addQuad(m, 0.52, 0.16, TRS(sx * 0.26, 0.02, 0, 0, 0, 0, 1), white);
    }
    return m;
  }

  /* ---------- 鱼 ---------- */
  function fishMesh() {
    const m = new G.Mesh();
    G.addSphere(m, 0.11, 7, 6, TRS(0, 0, 0, 0, 0, 0, [2.0, 1.0, 0.75]), [0.55, 0.62, 0.68]);
    G.addQuad(m, 0.22, 0.16, TRS(-0.24, 0, 0, 0, 0, 0.35, 1), [0.42, 0.52, 0.62]);
    return m;
  }

  /* ---------- 卵石 / 贝壳（实例化） ---------- */
  function pebbleMesh() {
    const m = new G.Mesh();
    G.addSphere(m, 0.11, 6, 5, TRS(0, 0, 0, 0, 0, 0, [1, 0.62, 1.15]), [0.5, 0.48, 0.45]);
    return m;
  }
  function shellMesh() {
    const m = new G.Mesh();
    G.addSphere(m, 0.10, 7, 5, TRS(0, 0, 0, 0, 0, 0, [1, 0.35, 1]), [0.95, 0.88, 0.80]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI - Math.PI / 2;
      G.addBox(m, 0.012, 0.02, 0.09, TRS(0, 0.035, 0, a * 0.5, 0, 0, 1), [0.88, 0.78, 0.70]);
    }
    return m;
  }

  /* ---------- 木栈桥（伸入海中） ---------- */
  function pierMesh(x, z0, z1) {
    const m = new G.Mesh();
    const len = z1 - z0, cz = (z0 + z1) / 2, deckY = 1.45;
    const deckCol = [C.woodLight[0], C.woodLight[1], C.woodLight[2]];
    G.addBox(m, 3.2, 0.14, len, TRS(x, deckY, cz, 0, 0, 0, 1), deckCol);
    // 板缝
    for (let i = 0; i < Math.floor(len / 0.6); i++) {
      G.addBox(m, 3.16, 0.02, 0.035, TRS(x, deckY + 0.08, z0 + 0.35 + i * 0.6, 0, 0, 0, 1),
        [C.woodDark[0], C.woodDark[1], C.woodDark[2]]);
    }
    // 桩柱
    for (let i = 0; i <= 14; i++) {
      const pz = z0 + (len * i) / 14;
      for (const sx of [-1.4, 1.4]) {
        const bed = S.terrainHeight(x + sx, pz);
        const h = deckY - bed + 0.8;
        G.addCyl(m, 0.15, 0.17, h, 8, TRS(x + sx, bed + h / 2, pz, 0, 0, 0, 1),
          [C.woodDark[0] * 1.1, C.woodDark[1] * 1.1, C.woodDark[2] * 1.1]);
      }
    }
    // 栏杆
    for (const sx of [-1.5, 1.5]) {
      for (const ry of [0.55, 0.95]) {
        G.addBox(m, 0.07, 0.07, len, TRS(x + sx, deckY + ry, cz, 0, 0, 0, 1),
          [C.wood[0], C.wood[1], C.wood[2]]);
      }
      for (let i = 0; i <= Math.floor(len / 4.5); i++) {
        const pz = z0 + 1.5 + i * 4.5;
        if (pz > z1) break;
        G.addBox(m, 0.08, 1.05, 0.08, TRS(x + sx, deckY + 0.52, pz, 0, 0, 0, 1),
          [C.woodDark[0], C.woodDark[1], C.woodDark[2]]);
      }
    }
    // 系缆柱
    for (let i = 0; i < 3; i++) {
      const pz = z0 + 6 + i * (len - 12) / 2;
      G.addCyl(m, 0.11, 0.13, 0.5, 8, TRS(x - 1.35, deckY + 0.32, pz, 0, 0, 0, 1),
        [C.woodDark[0], C.woodDark[1], C.woodDark[2]]);
    }
    // 灯柱
    const lz = z1 - 3;
    G.addCyl(m, 0.06, 0.07, 2.1, 7, TRS(x + 1.3, deckY + 1.05, lz, 0, 0, 0, 1),
      [C.woodDark[0], C.woodDark[1], C.woodDark[2]]);
    G.addCyl(m, 0.13, 0.16, 0.26, 8, TRS(x + 1.3, deckY + 2.15, lz, 0, 0, 0, 1), [0.87, 0.90, 0.92]);
    G.addSphere(m, 0.10, 8, 6, TRS(x + 1.3, deckY + 2.15, lz, 0, 0, 0, 1), [1.0, 0.95, 0.77]);
    return m;
  }

  /* ---------- 把局部网格烘焙进世界矩阵 ---------- */
  function bake(mesh, m) {
    const v = mesh.v;
    for (let i = 0; i < v.length; i += 9) {
      const px = v[i], py = v[i + 1], pz = v[i + 2];
      const nx = v[i + 3], ny = v[i + 4], nz = v[i + 5];
      const ox = m[0] * px + m[4] * py + m[8] * pz + m[12];
      const oy = m[1] * px + m[5] * py + m[9] * pz + m[13];
      const oz = m[2] * px + m[6] * py + m[10] * pz + m[14];
      let ax = m[0] * nx + m[4] * ny + m[8] * nz;
      let ay = m[1] * nx + m[5] * ny + m[9] * nz;
      let az = m[2] * nx + m[6] * ny + m[10] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      v[i] = ox; v[i + 1] = oy; v[i + 2] = oz;
      v[i + 3] = ax / l; v[i + 4] = ay / l; v[i + 5] = az / l;
    }
    return mesh;
  }

  S.Props = {
    palmMesh, treeMesh, rockMesh, driftMesh, grassMesh,
    crabMesh, birdMesh, fishMesh, pebbleMesh, shellMesh, pierMesh, bake
  };
})();
