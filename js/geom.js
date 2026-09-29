/* ============================================================
 * 程序化几何：盒/柱/锥/球/环/面片 —— 顶点布局 pos3+normal3+color3
 * 所有图元可带变换矩阵直接烘焙进同一网格
 * ============================================================ */
(function () {
  const S = window.Seaside;
  const m4 = S.M.m4;

  function xformPoint(m, x, y, z, out) {
    if (!m) { out[0] = x; out[1] = y; out[2] = z; return out; }
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return out;
  }
  function xformDir(m, x, y, z, out) {
    if (!m) { out[0] = x; out[1] = y; out[2] = z; return out; }
    out[0] = m[0] * x + m[4] * y + m[8] * z;
    out[1] = m[1] * x + m[5] * y + m[9] * z;
    out[2] = m[2] * x + m[6] * y + m[10] * z;
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  }

  function Mesh() {
    this.v = [];   // 顶点数据（9 float/顶点）
    this.i = [];   // 索引
  }
  Mesh.prototype.count = function () { return this.v.length / 9; };
  Mesh.prototype.push = function (px, py, pz, nx, ny, nz, c) {
    this.v.push(px, py, pz, nx, ny, nz, c[0], c[1], c[2]);
    return this.v.length / 9 - 1;
  };
  Mesh.prototype.tri = function (a, b, c) { this.i.push(a, b, c); };
  Mesh.prototype.quad = function (a, b, c, d) { this.i.push(a, b, c, a, c, d); };
  Mesh.prototype.data = function () {
    return { verts: new Float32Array(this.v), idx: new Uint32Array(this.i), count: this.i.length };
  };

  const _p = [0, 0, 0], _n = [0, 0, 0];

  /* ---------- 盒 ---------- */
  function addBox(mesh, w, h, d, mt, col) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const faces = [
      [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], [0, 0, 1]],
      [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], [0, 0, -1]],
      [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], [1, 0, 0]],
      [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], [-1, 0, 0]],
      [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd], [0, 1, 0]],
      [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd], [0, -1, 0]]
    ];
    for (const f of faces) {
      const base = mesh.count();
      for (let k = 0; k < 4; k++) {
        xformPoint(mt, f[k][0], f[k][1], f[k][2], _p);
        xformDir(mt, f[4][0], f[4][1], f[4][2], _n);
        mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
      }
      mesh.quad(base, base + 1, base + 2, base + 3);
    }
    return mesh;
  }

  /* ---------- 圆柱 / 圆锥（r0 底半径，r1 顶半径，沿 +y） ---------- */
  function addCyl(mesh, r0, r1, h, seg, mt, col, capTop, capBot) {
    capTop = capTop !== false; capBot = capBot !== false;
    const y0 = -h / 2, y1 = h / 2;
    const sideStart = mesh.count();
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // 侧面法线（考虑锥度）
      const slope = (r0 - r1) / h;
      xformDir(mt, ca, slope, sa, _n);
      xformPoint(mt, ca * r0, y0, sa * r0, _p);
      mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
      xformPoint(mt, ca * r1, y1, sa * r1, _p);
      mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
    }
    for (let i = 0; i < seg; i++) {
      const a = sideStart + i * 2;
      mesh.quad(a, a + 2, a + 3, a + 1);
    }
    if (capTop && r1 > 1e-5) {
      const c = mesh.count();
      xformPoint(mt, 0, y1, 0, _p); xformDir(mt, 0, 1, 0, _n);
      mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        xformPoint(mt, Math.cos(a) * r1, y1, Math.sin(a) * r1, _p);
        mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
      }
      for (let i = 0; i < seg; i++) mesh.tri(c, c + 1 + i, c + 2 + i);
    }
    if (capBot && r0 > 1e-5) {
      const c = mesh.count();
      xformPoint(mt, 0, y0, 0, _p); xformDir(mt, 0, -1, 0, _n);
      mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        xformPoint(mt, Math.cos(a) * r0, y0, Math.sin(a) * r0, _p);
        mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
      }
      for (let i = 0; i < seg; i++) mesh.tri(c, c + 2 + i, c + 1 + i);
    }
    return mesh;
  }

  /* ---------- 球 ---------- */
  function addSphere(mesh, r, segU, segV, mt, col, squashY) {
    squashY = squashY || 1;
    const start = mesh.count();
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI;
      const sy = Math.cos(v), sr = Math.sin(v);
      for (let i = 0; i <= segU; i++) {
        const u = (i / segU) * Math.PI * 2;
        const nx = Math.cos(u) * sr, ny = sy, nz = Math.sin(u) * sr;
        xformDir(mt, nx, ny / squashY, nz, _n);
        xformPoint(mt, nx * r, ny * r * squashY, nz * r, _p);
        mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
      }
    }
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const a = start + j * (segU + 1) + i;
        mesh.quad(a, a + segU + 1, a + segU + 2, a + 1);
      }
    }
    return mesh;
  }

  /* ---------- 圆环 ---------- */
  function addTorus(mesh, R, r, segU, segV, mt, col) {
    const start = mesh.count();
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * Math.PI * 2;
      const cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= segV; j++) {
        const v = (j / segV) * Math.PI * 2;
        const cv = Math.cos(v), sv = Math.sin(v);
        const nx = cu * cv, ny = sv, nz = su * cv;
        xformDir(mt, nx, ny, nz, _n);
        xformPoint(mt, cu * (R + r * cv), r * sv, su * (R + r * cv), _p);
        mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
      }
    }
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const a = start + i * (segV + 1) + j;
        mesh.quad(a, a + segV + 1, a + segV + 2, a + 1);
      }
    }
    return mesh;
  }

  /* ---------- 双面面片（树叶、旗帜） ---------- */
  function addQuad(mesh, w, h, mt, col) {
    const hw = w / 2, hh = h / 2;
    const base = mesh.count();
    xformDir(mt, 0, 0, 1, _n);
    const pts = [[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]];
    for (const p of pts) {
      xformPoint(mt, p[0], p[1], p[2], _p);
      mesh.push(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], col);
    }
    mesh.quad(base, base + 1, base + 2, base + 3);
    mesh.quad(base, base + 2, base + 1, base + 3);   // 背面
    return mesh;
  }

  /* ---------- 按面法线平滑重算（放样曲面用） ---------- */
  function recomputeNormals(mesh) {
    const v = mesh.v, idx = mesh.i;
    for (let i = 0; i < v.length; i += 9) { v[i + 3] = 0; v[i + 4] = 0; v[i + 5] = 0; }
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k] * 9, b = idx[k + 1] * 9, c = idx[k + 2] * 9;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      v[a + 3] += nx; v[a + 4] += ny; v[a + 5] += nz;
      v[b + 3] += nx; v[b + 4] += ny; v[b + 5] += nz;
      v[c + 3] += nx; v[c + 4] += ny; v[c + 5] += nz;
    }
    for (let i = 0; i < v.length; i += 9) {
      const l = Math.hypot(v[i + 3], v[i + 4], v[i + 5]) || 1;
      v[i + 3] /= l; v[i + 4] /= l; v[i + 5] /= l;
    }
    return mesh;
  }

  /* 常用颜色 */
  const C = {
    wood: [0.55, 0.39, 0.22],
    woodDark: [0.35, 0.24, 0.13],
    woodLight: [0.68, 0.52, 0.32],
    leaf: [0.24, 0.47, 0.24],
    leaf2: [0.30, 0.55, 0.27],
    palm: [0.22, 0.45, 0.22],
    rock: [0.42, 0.40, 0.37],
    rockDark: [0.31, 0.30, 0.29],
    metal: [0.62, 0.65, 0.68],
    rope: [0.80, 0.73, 0.58],
    white: [0.92, 0.92, 0.90],
    flag: [0.85, 0.22, 0.20],
    sand: [0.85, 0.77, 0.60]
  };

  S.G = { Mesh, addBox, addCyl, addSphere, addTorus, addQuad, recomputeNormals, C, xformPoint, xformDir };
})();
