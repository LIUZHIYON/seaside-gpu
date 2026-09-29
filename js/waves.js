/* ============================================================
 * 波浪：7 重 Gerstner 波（JS 与 WGSL 严格共用同一组参数）
 * ============================================================ */
(function () {
  const S = window.Seaside;

  // 每个波：[dirX, dirZ, steepness, wavelength]
  S.WAVES = [
    [1.0, 0.25, 0.085, 64.0],
    [0.62, 1.0, 0.09, 34.0],
    [-0.35, 0.85, 0.10, 19.0],
    [0.9, -0.42, 0.12, 10.0],
    [0.5, 0.78, 0.14, 5.5],
    [0.85, 0.42, 0.10, 3.2],
    [-0.6, 0.3, 0.09, 2.1]
  ];

  // 派生出的 GPU 常量（dx, dz, steepness, k）
  S.WAVE_GPU = S.WAVES.map((w) => {
    const len = Math.hypot(w[0], w[1]);
    return [w[0] / len, w[1] / len, w[2], (2 * Math.PI) / w[3]];
  });

  S.waveHeight = (x, z, t) => {
    let y = 0;
    for (let i = 0; i < S.WAVES.length; i++) {
      const w = S.WAVES[i];
      const len = Math.hypot(w[0], w[1]);
      const dx = w[0] / len, dz = w[1] / len;
      const k = (2 * Math.PI) / w[3];
      const c = Math.sqrt(9.8 / k);
      const f = k * (dx * x + dz * z - c * t);
      y += (w[2] / k) * Math.sin(f);
    }
    return y;
  };

  /* 生成 WGSL 常量数组源码，保证与 JS 完全一致 */
  S.waveWGSL = () => {
    const rows = S.WAVE_GPU.map(
      (w) => `    vec4<f32>(${w[0].toFixed(6)}, ${w[1].toFixed(6)}, ${w[2].toFixed(6)}, ${w[3].toFixed(6)})`
    ).join(',\n');
    return `const NW : i32 = ${S.WAVE_GPU.length};\nconst WAVES = array<vec4<f32>, ${S.WAVE_GPU.length}>(\n${rows}\n);`;
  };
})();
