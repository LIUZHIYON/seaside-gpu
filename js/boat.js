/* ============================================================
 * 小船：放样船体 + 船肋/坐板/木桶/缆绳 + 双桨摆动 + 驾驶物理
 * ============================================================ */
(function () {
  const S = window.Seaside;
  const G = S.G;
  const m4 = S.M.m4;
  const C = G.C;
  const TRS = S.TRS;

  /* ---------- 船体：放样曲面（ station × 高度 ） ---------- */
  function hullMesh() {
    const m = new G.Mesh();
    const NT = 16, NY = 5;          // 纵向站位 / 舷高分段
    const L = 4.4, B = 0.58, D = 0.66;
    const wood = [0.62, 0.42, 0.24];
    const woodDark = [0.34, 0.22, 0.12];

    const halfW = (t) => B * Math.pow(Math.sin(Math.PI * (0.24 + 0.76 * t)), 0.55);
    const grid = [];
    for (let i = 0; i <= NT; i++) {
      const t = i / NT;
      const z = -L / 2 + t * L;
      const w = halfW(t);
      const row = [];
      for (let j = 0; j <= NY; j++) {
        const s = j / NY;
        const y = D * s;
        const x = w * Math.sin(Math.PI * 0.5 * s);
        row.push([x, y, z]);
      }
      grid.push(row);
    }

    // 舷侧曲面（左右两片）
    for (const side of [1, -1]) {
      for (let i = 0; i < NT; i++) {
        for (let j = 0; j < NY; j++) {
          const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
          const base = m.count();
          const shade = 0.86 + 0.14 * (j / NY);
          const col = [wood[0] * shade, wood[1] * shade, wood[2] * shade];
          for (const p of [a, b, c, d]) {
            m.push(p[0] * side, p[1], p[2], 0, 1, 0, col);
          }
          if (side > 0) m.quad(base, base + 1, base + 2, base + 3);
          else m.quad(base, base + 3, base + 2, base + 1);
        }
      }
    }
    // 船底（左右对称合并）
    for (let i = 0; i < NT; i++) {
      const a = grid[i][0], b = grid[i + 1][0];
      const base = m.count();
      const col = [woodDark[0], woodDark[1], woodDark[2]];
      for (const p of [[0, a[1], a[2]], [0, b[1], b[2]], [0.06, b[1] + 0.03, b[2]], [0.06, a[1] + 0.03, a[2]]]) {
        m.push(p[0], p[1], p[2], 0, -1, 0, col);
      }
      m.quad(base, base + 1, base + 2, base + 3);
      const base2 = m.count();
      for (const p of [[0, a[1], a[2]], [0, b[1], b[2]], [-0.06, b[1] + 0.03, b[2]], [-0.06, a[1] + 0.03, a[2]]]) {
        m.push(p[0], p[1], p[2], 0, -1, 0, col);
      }
      m.quad(base2, base2 + 3, base2 + 2, base2 + 1);
    }
    // 船尾封板
    {
      const t0 = grid[0];
      const base = m.count();
      for (let j = 0; j <= NY; j++) {
        m.push(-t0[j][0], t0[j][1], t0[j][2], 0, 0, -1, [woodDark[0] * 1.15, woodDark[1] * 1.15, woodDark[2] * 1.15]);
        m.push(t0[j][0], t0[j][1], t0[j][2], 0, 0, -1, [woodDark[0] * 1.15, woodDark[1] * 1.15, woodDark[2] * 1.15]);
      }
      for (let j = 0; j < NY; j++) m.quad(base + j * 2, base + j * 2 + 2, base + j * 2 + 3, base + j * 2 + 1);
    }
    // 舷缘压条
    for (const side of [1, -1]) {
      for (let i = 0; i < NT; i++) {
        const a = grid[i][NY], b = grid[i + 1][NY];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
        G.addBox(m, 0.05, 0.09, len + 0.02,
          TRS((a[0] * side + b[0] * side) / 2, D + 0.03, (a[2] + b[2]) / 2, yaw, 0, 0, 1),
          [woodDark[0] * 1.25, woodDark[1] * 1.25, woodDark[2] * 1.25]);
      }
    }
    // 船肋（内壁）
    for (let i = 2; i < NT - 2; i += 3) {
      const t = i / NT;
      const w = halfW(t);
      for (const side of [1, -1]) {
        G.addBox(m, 0.05, 0.34, 0.09,
          TRS(side * (w * 0.86), 0.30, -L / 2 + t * L, 0, 0, side * -0.12, 1),
          [woodDark[0], woodDark[1], woodDark[2]]);
      }
    }
    // 坐板
    for (const zz of [0.55, -0.75]) {
      G.addBox(m, 1.02, 0.075, 0.30, TRS(0, 0.46, zz, 0, 0, 0, 1),
        [C.woodLight[0], C.woodLight[1], C.woodLight[2]]);
    }
    // 船底格栅
    for (let i = 0; i < 4; i++) {
      G.addBox(m, 0.78, 0.035, 0.12, TRS(0, 0.07 + i * 0.001, -0.85 + i * 0.55, 0, 0, 0, 1),
        [woodDark[0] * 1.2, woodDark[1] * 1.2, woodDark[2] * 1.2]);
    }
    // 船首缆绳环 + 绳圈 + 木桶
    G.addTorus(m, 0.075, 0.018, 8, 10, TRS(0, D + 0.02, L / 2 - 0.06, 0, 0, 0, 1), C.metal);
    G.addTorus(m, 0.16, 0.035, 8, 12, TRS(-0.26, 0.16, -1.55, Math.PI / 2, 0, 0, 1), C.rope);
    G.addCyl(m, 0.15, 0.13, 0.24, 10, TRS(0.3, 0.20, -1.5, 0, 0, 0, 1), [0.45, 0.30, 0.16]);
    // 旗杆与旗
    G.addCyl(m, 0.03, 0.025, 1.5, 6, TRS(0, D + 0.75, -L / 2 + 0.35, 0, 0, 0, 1), C.woodDark);
    G.addQuad(m, 0.5, 0.3, TRS(0.25, D + 1.35, -L / 2 + 0.35, 0, 0, 0, 1), C.flag);

    G.recomputeNormals(m);
    return m;
  }

  /* ---------- 桨（可摆动） ---------- */
  function oarMesh(side) {
    const m = new G.Mesh();
    const L = 2.1;
    // 局部坐标：pivot 在桨架处，桨叶朝 -x（外侧）
    G.addCyl(m, 0.035, 0.028, L, 7, TRS(-L / 2 * side, 0, 0, 0, Math.PI / 2 * side, 0, 1),
      [0.72, 0.55, 0.33]);
    G.addBox(m, 0.30, 0.075, 0.14, TRS(-L * side, 0, 0, 0, 0, 0, 1), [0.66, 0.48, 0.28]);
    G.addTorus(m, 0.05, 0.014, 6, 10, TRS(0, 0, 0, 0, 0, 0, 1), [0.45, 0.35, 0.22]);
    G.recomputeNormals(m);
    return m;
  }

  /* ---------- 状态与物理 ---------- */
  S.initBoat = function () {
    S.boat = {
      x: 14, z: 42, heading: 2.7, v: 0, occ: false,
      pitch: 0, roll: 0, oarT: 0, y: 0
    };
    return {
      hull: hullMesh().data(),
      oarL: oarMesh(1).data(),
      oarR: oarMesh(-1).data()
    };
  };

  const _m = m4.create();
  S.boatMatrix = function (out) {
    const b = S.boat;
    return m4.compose(out, b.x, b.y, b.z, b.heading, b.pitch, b.roll, 1, 1, 1);
  };

  /* 返回桨的世界矩阵：boatMat * pivot(yaw, feather) */
  S.oarMatrix = function (out, boatMat, side) {
    const b = S.boat;
    const swing = Math.sin(b.oarT) * 0.6;
    const feather = Math.cos(b.oarT) * 0.18;
    const local = m4.compose(m4.create(),
      side * 0.52, 0.52, side > 0 ? 0.35 : -0.35,
      swing, 0, feather, 1, 1, 1);
    return m4.mul(out, boatMat, local);
  };

  S.updateBoat = function (dt, t) {
    const b = S.boat;
    if (!b) return;
    const k = S.keys || {};
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading);

    let acc = 0, turn = 0;
    if (b.occ) {
      if (k.KeyW || k.ArrowUp) acc = 3.4;
      if (k.KeyS || k.ArrowDown) acc = -2.4;
      if (k.KeyA || k.ArrowLeft) turn = 1;
      if (k.KeyD || k.ArrowRight) turn = -1;
    }
    b.v += acc * dt;
    b.v *= 1 - 0.5 * dt;
    b.v = S.clamp(b.v, -2.4, 7.0);

    const turnRate = turn * 1.5 * S.clamp(Math.abs(b.v) / 2.5, 0.12, 1) * (b.v < 0 ? -1 : 1);
    b.heading += turnRate * dt;

    const nx = b.x + fx * b.v * dt;
    const nz = b.z + fz * b.v * dt;
    if (S.terrainHeight(nx, nz) > -0.5) b.v *= -0.25;
    else { b.x = nx; b.z = nz; }

    // 四点采样波浪 → 浮动姿态（带限幅）
    const rx = Math.cos(b.heading), rz = -Math.sin(b.heading);
    const y0 = S.waveHeight(b.x, b.z, t) + 0.05;
    const hb = S.waveHeight(b.x + fx * 1.5, b.z + fz * 1.5, t);
    const hs = S.waveHeight(b.x - fx * 1.5, b.z - fz * 1.5, t);
    const hl = S.waveHeight(b.x - rx * 0.7, b.z - rz * 0.7, t);
    const hr = S.waveHeight(b.x + rx * 0.7, b.z + rz * 0.7, t);
    const tp = S.clamp(-Math.atan((hb - hs) / 3.0) * 0.9, -0.18, 0.18);
    const tr = S.clamp(Math.atan((hl - hr) / 1.4) * 0.8, -0.22, 0.22);
    b.pitch += (tp - b.pitch) * Math.min(1, dt * 4);
    b.roll += (tr - b.roll) * Math.min(1, dt * 4);
    b.y = y0;

    if (Math.abs(b.v) > 0.25) b.oarT += dt * (1.1 + Math.abs(b.v) * 0.5);
    else b.oarT += (0 - (b.oarT % 6.283)) * 0;   // 保持当前相位
    return _m;
  };

  S.tryBoard = function () {
    const b = S.boat, p = S.player;
    if (!b || !p) return;
    if (p.mode !== 'boat') {
      const d = Math.hypot(p.pos[0] - b.x, p.pos[2] - b.z);
      if (d < 5.5) { b.occ = true; p.mode = 'boat'; }
    } else {
      b.occ = false;
      const ex = b.x + Math.cos(b.heading) * 2.4;
      const ez = b.z - Math.sin(b.heading) * 2.4;
      p.pos[0] = ex; p.pos[2] = ez;
      const th = S.terrainHeight(ex, ez);
      p.mode = th < -0.55 ? 'swim' : 'walk';
      p.pos[1] = th + S.CFG.EYE;
      p.velY = 0; p.grounded = true;
    }
  };
})();
