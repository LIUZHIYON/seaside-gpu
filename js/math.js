/* ============================================================
 * 数学库：mat4（列主序，与 WGSL 一致）/ 向量小工具 / 插值
 * 手写 WebGPU 渲染器，不依赖任何三方库
 * ============================================================ */
(function () {
  const S = (window.Seaside = window.Seaside || {});

  const M = {};

  M.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  M.lerp = (a, b, t) => a + (b - a) * t;
  M.smoothstep = (e0, e1, x) => {
    const t = M.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  M.TAU = Math.PI * 2;

  /* ---------- vec3（普通数组 [x,y,z]） ---------- */
  const v3 = {
    make: (x = 0, y = 0, z = 0) => [x, y, z],
    set: (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; },
    copy: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
    add: (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
    sub: (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
    scale: (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
    addScaled: (o, a, b, s) => { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    cross: (o, a, b) => {
      const x = a[1] * b[2] - a[2] * b[1];
      const y = a[2] * b[0] - a[0] * b[2];
      const z = a[0] * b[1] - a[1] * b[0];
      o[0] = x; o[1] = y; o[2] = z; return o;
    },
    norm: (o, a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o;
    }
  };
  M.v3 = v3;

  /* ---------- mat4（列主序：m[col*4 + row]） ---------- */
  const m4 = {
    create: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

    identity: (o) => {
      o.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      return o;
    },

    /* o = a * b（先应用 b 再应用 a） */
    mul: (o, a, b) => {
      const out = o === a || o === b ? new Float32Array(16) : o;
      for (let c = 0; c < 4; c++) {
        const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
        for (let r = 0; r < 4; r++) {
          out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
        }
      }
      if (out !== o) o.set(out);
      return o;
    },

    /* WebGPU 深度范围 [0,1] 的透视矩阵（右手系，视线 -z） */
    perspective: (o, fovy, aspect, near, far) => {
      const f = 1 / Math.tan(fovy / 2);
      const nf = 1 / (near - far);
      o.set([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, far * nf, -1,
        0, 0, far * near * nf, 0
      ]);
      return o;
    },

    /* 正交投影（WebGPU 深度范围 [0,1]） */
    ortho: (o, l, r, b, t, n, f) => {
      o.set([
        2 / (r - l), 0, 0, 0,
        0, 2 / (t - b), 0, 0,
        0, 0, 1 / (n - f), 0,
        -(r + l) / (r - l), -(t + b) / (t - b), n / (n - f), 1
      ]);
      return o;
    },

    lookAt: (o, eye, center, up) => {
      const z = v3.make(); v3.sub(z, eye, center); v3.norm(z, z);      // 视线反向
      const x = v3.make(); v3.cross(x, up, z);
      if (v3.len(x) < 1e-6) { x[0] = 1; x[1] = 0; x[2] = 0; }
      v3.norm(x, x);
      const y = v3.make(); v3.cross(y, z, x);
      o.set([
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1
      ]);
      return o;
    },

    /* 平移 + 绕 Y 旋转 + 绕 X/Z 旋转（YXZ 顺序）+ 缩放 */
    compose: (o, px, py, pz, ry, rx, rz, sx, sy, sz) => {
      const cy = Math.cos(ry), sy_ = Math.sin(ry);
      const cx = Math.cos(rx), sx_ = Math.sin(rx);
      const cz = Math.cos(rz), sz_ = Math.sin(rz);
      // R = Ry * Rx * Rz
      const m00 = cy * cz + sy_ * sx_ * sz_;
      const m01 = cx * sz_;
      const m02 = -sy_ * cz + cy * sx_ * sz_;
      const m10 = -cy * sz_ + sy_ * sx_ * cz;
      const m11 = cx * cz;
      const m12 = sy_ * sz_ + cy * sx_ * cz;
      const m20 = sy_ * cx;
      const m21 = -sx_;
      const m22 = cy * cx;
      o.set([
        m00 * sx, m01 * sx, m02 * sx, 0,
        m10 * sy, m11 * sy, m12 * sy, 0,
        m20 * sz, m21 * sz, m22 * sz, 0,
        px, py, pz, 1
      ]);
      return o;
    },

    translation: (o, x, y, z) => {
      m4.identity(o); o[12] = x; o[13] = y; o[14] = z; return o;
    },

    invert: (o, a) => {
      const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
      const b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
      const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
      const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
      const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
      const b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return m4.identity(o);
      det = 1 / det;
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
      o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
      o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
      o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
      o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
      o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
      o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
      o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
      o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
      o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
      o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
      o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
      o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
      return o;
    },

    /* 变换方向向量（忽略平移） */
    xformDir: (o, m, v) => {
      const x = v[0], y = v[1], z = v[2];
      o[0] = m[0] * x + m[4] * y + m[8] * z;
      o[1] = m[1] * x + m[5] * y + m[9] * z;
      o[2] = m[2] * x + m[6] * y + m[10] * z;
      return o;
    }
  };
  M.m4 = m4;

  S.M = M;
  S.clamp = M.clamp;
  S.lerp = M.lerp;
  S.smoothstep = M.smoothstep;
})();
