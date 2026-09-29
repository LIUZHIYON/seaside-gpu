/* ============================================================
 * WGSL 着色器集合
 * 通用帧 Uniform（group 0） + 天空/水面/实体/后处理
 * ============================================================ */
(function () {
  const S = window.Seaside;

  /* ---------- 公共片段：Frame uniform / 噪声 / 天空 / 雾 ---------- */
  const COMMON = /* wgsl */`
struct Frame {
  viewProj     : mat4x4<f32>,
  invViewProj  : mat4x4<f32>,
  camPos       : vec4<f32>,   // xyz 相机位置, w 时间
  sunDir       : vec4<f32>,   // xyz 太阳方向, w 水下标记
  fogCol       : vec4<f32>,   // rgb 雾色, a 密度
  params       : vec4<f32>,   // x 曝光, y 云量, z 阴影强度, w 浪高缩放
  screen       : vec4<f32>,   // w, h, 1/w, 1/h
  depthP       : vec4<f32>,   // p22, p23, near, far
  waterO       : vec4<f32>,   // 水面网格原点 xz
};
@group(0) @binding(0) var<uniform> F : Frame;

fn hash21(p : vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(0.1031, 0.1030));
  q += vec2<f32>(dot(q, q.yx + 33.33));
  return fract((q.x + q.y) * q.x);
}
fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p0 : vec2<f32>, oct : i32) -> f32 {
  var p = p0;
  var s = 0.0;
  var a = 0.5;
  for (var i = 0; i < oct; i = i + 1) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2<f32>(1.7, 9.2);
    a = a * 0.5;
  }
  return s;
}

/* 天空渐变（瑞利式湛蓝 + 地平线暖白 + 太阳） */
fn skyColor(dir : vec3<f32>) -> vec3<f32> {
  let d = normalize(dir);
  let up = clamp(d.y, -1.0, 1.0);
  let h = clamp(up, 0.0, 1.0);
  let zen = vec3<f32>(0.015, 0.130, 0.760);
  let hor = vec3<f32>(0.560, 0.760, 0.940);
  var col = mix(hor, zen, pow(h, 0.42));
  col = mix(col, vec3<f32>(0.880, 0.900, 0.920), pow(1.0 - abs(up), 10.0) * 0.45);
  let sd = max(dot(d, F.sunDir.xyz), 0.0);
  col += vec3<f32>(1.0, 0.92, 0.76) * pow(sd, 5.0) * 0.28;
  col += vec3<f32>(1.0, 0.88, 0.68) * pow(sd, 260.0) * 2.0;
  return col;
}

/* 云：把视线投到高空云层，双层 fbm + 域扭曲 */
fn cloudAmount(dir : vec3<f32>, t : f32) -> f32 {
  if (dir.y <= 0.015) { return 0.0; }
  let k = 1.0 / max(dir.y, 0.015);
  var p = vec2<f32>(dir.x, dir.z) * k * 0.0042 + vec2<f32>(t * 0.0075, t * 0.0042);
  let warp = fbm(p * 0.7 + vec2<f32>(3.1, 1.7), 3);
  p = p + vec2<f32>(warp * 0.55, warp * 0.35);
  var n = fbm(p, 4);
  n = n + 0.32 * fbm(p * 2.9 + vec2<f32>(7.3, 2.1), 3);
  // 云覆盖率：阈值偏高→晴空为主，少量积云，保持"湛蓝"底色
  let cover = smoothstep(0.66 - F.params.y * 0.14, 0.92, n);
  return cover * smoothstep(0.015, 0.20, dir.y);
}

fn skyWithClouds(dir : vec3<f32>, t : f32) -> vec3<f32> {
  var col = skyColor(dir);
  let c = cloudAmount(dir, t) * clamp(F.params.y, 0.0, 1.4);
  let sd = max(dot(normalize(dir), F.sunDir.xyz), 0.0);
  let base = vec3<f32>(0.70, 0.74, 0.80);
  let lit  = vec3<f32>(1.00, 0.98, 0.95) + vec3<f32>(0.22, 0.16, 0.08) * pow(sd, 3.0);
  // 云底偏暗、朝阳侧透光
  let shade = mix(base * 0.72, lit, clamp(0.35 + sd * 0.65, 0.0, 1.0));
  col = mix(col, shade, clamp(c, 0.0, 1.0));
  return col;
}

/* 线性视深度还原（WebGPU NDC z ∈ [0,1]） */
fn linearDepth(zNdc : f32) -> f32 {
  return F.depthP.y / (zNdc + F.depthP.x);
}

/* 大气透视雾 */
fn applyFog(col : vec3<f32>, dist : f32) -> vec3<f32> {
  let f = 1.0 - exp(-dist * F.fogCol.a);
  return mix(col, F.fogCol.rgb, clamp(f, 0.0, 1.0));
}

/* 水下衰减（相机在水下时） */
fn applyWaterFog(col : vec3<f32>, dist : f32, underwater : f32) -> vec3<f32> {
  if (underwater < 0.5) { return col; }
  let deep = vec3<f32>(0.055, 0.230, 0.290);
  let f = 1.0 - exp(-dist * 0.085);
  return mix(col, deep, clamp(f, 0.0, 1.0));
}
`;

  /* ---------- 天空：全屏三角形 ---------- */
  const SKY = COMMON + /* wgsl */`
struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) ndc : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  // 覆盖全屏的大三角形
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var o : VSOut;
  o.pos = vec4<f32>(p[vi], 1.0, 1.0);
  o.ndc = p[vi];
  return o;
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4<f32> {
  let nearP = F.invViewProj * vec4<f32>(i.ndc, 0.0, 1.0);
  let farP  = F.invViewProj * vec4<f32>(i.ndc, 1.0, 1.0);
  let dir = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
  let t = F.camPos.w;
  var col = skyWithClouds(dir, t);
  // 水下：整个背景替换为水体（用 F.sunDir.w 水下标记，而不是只看 camPos.y），
  // 朝上更亮（水面透下的光），朝下更暗，避免水下仍透出明亮天空。
  if (F.sunDir.w > 0.5) {
    let upc = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    let deep = vec3<f32>(0.030, 0.150, 0.215);
    let surfC = vec3<f32>(0.130, 0.430, 0.490);
    col = mix(deep, surfC, pow(upc, 2.2));
  }
  // alpha 通道存"到相机的距离"，供水面做遮挡剔除（天空=无限远）
  return vec4<f32>(col, 10000.0);
}
`;

  /* ---------- 实体（地形 / 道具 / 船） ---------- */
  const SOLID = COMMON + /* wgsl */`
struct Obj {
  model : mat4x4<f32>,
  tint  : vec4<f32>,   // rgb 乘色, a 自发光
  m2    : vec4<f32>,   // x 高光强度, y 高光锐度, z 金属感, w 未用
};
@group(1) @binding(0) var<uniform> O : Obj;

struct Shadow {
  lightVP : mat4x4<f32>,
  info    : vec4<f32>,  // x 强度, y /texel, z 未用, w 未用
};
@group(2) @binding(0) var<uniform> SH : Shadow;
@group(2) @binding(1) var shadowMap : texture_depth_2d;
@group(2) @binding(2) var shadowSamp : sampler_comparison;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) wpos : vec3<f32>,
  @location(1) nrm  : vec3<f32>,
  @location(2) col  : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) ipos : vec3<f32>,
  @location(1) inrm : vec3<f32>,
  @location(2) icol : vec3<f32>
) -> VSOut {
  let wp = O.model * vec4<f32>(ipos, 1.0);
  var o : VSOut;
  o.pos = F.viewProj * wp;
  o.wpos = wp.xyz;
  o.nrm = normalize((O.model * vec4<f32>(inrm, 0.0)).xyz);
  o.col = icol * O.tint.rgb;
  return o;
}

fn shadowAt(wp : vec3<f32>, n : vec3<f32>) -> f32 {
  // 注意：textureSampleCompare 必须在「统一控制流」内调用，所以这里不能有任何基于
  // 片元数据的分支/早退，越界与关闭阴影一律用 0/1 权重在最后统一处理。
  let lp = SH.lightVP * vec4<f32>(wp + n * 0.06, 1.0);
  let lw = max(lp.w, 1e-5);
  let pc = lp.xyz / lw;
  let uv = vec2<f32>(pc.x * 0.5 + 0.5, 0.5 - pc.y * 0.5);
  let d = clamp(pc.z, 0.0, 1.0) - 0.0012;
  var s = 0.0;
  let texel = SH.info.y;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      s += textureSampleCompare(shadowMap, shadowSamp,
        uv + vec2<f32>(f32(x), f32(y)) * texel, d);
    }
  }
  let ok = f32(lp.w > 0.0)
         * f32(pc.z >= 0.0 && pc.z <= 1.0)
         * f32(all(abs(pc.xy) < vec2<f32>(1.0, 1.0)));
  return mix(1.0, s / 9.0, SH.info.x * ok);
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4<f32> {
  let N = normalize(i.nrm);
  let V = normalize(F.camPos.xyz - i.wpos);
  let L = normalize(F.sunDir.xyz);
  let H = normalize(L + V);

  let sh = shadowAt(i.wpos, N);
  let ndl = max(dot(N, L), 0.0);
  let sun = vec3<f32>(1.35, 1.24, 1.05) * ndl * sh;

  // 天光环境（半球）+ 地面反弹
  let up = N.y * 0.5 + 0.5;
  let amb = mix(vec3<f32>(0.30, 0.31, 0.33), skyColor(N) * 0.85, up) * 0.55;

  var albedo = i.col;
  var col = albedo * (sun + amb);

  // 高光
  let spec = pow(max(dot(N, H), 0.0), max(O.m2.y, 4.0)) * O.m2.x * sh * ndl;
  col += vec3<f32>(1.0, 0.96, 0.88) * spec;

  // 自发光
  col += albedo * O.tint.a;

  let dist = length(F.camPos.xyz - i.wpos);
  col = applyFog(col, dist);
  col = applyWaterFog(col, dist, F.sunDir.w);
  // alpha：到相机距离（水面据此做遮挡剔除与吸收厚度估算）
  return vec4<f32>(col, dist);
}
`;

  /* ---------- 实例化实体（卵石 / 贝壳 / 鱼 / 海草） ---------- */
  const INST = COMMON + /* wgsl */`
struct Shadow {
  lightVP : mat4x4<f32>,
  info    : vec4<f32>,
};
@group(1) @binding(0) var<uniform> SH : Shadow;
@group(1) @binding(1) var shadowMap : texture_depth_2d;
@group(1) @binding(2) var shadowSamp : sampler_comparison;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) wpos : vec3<f32>,
  @location(1) nrm  : vec3<f32>,
  @location(2) col  : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) ipos : vec3<f32>,
  @location(1) inrm : vec3<f32>,
  @location(2) icol : vec3<f32>,
  @location(3) m0 : vec4<f32>,
  @location(4) m1 : vec4<f32>,
  @location(5) m2 : vec4<f32>,
  @location(6) m3 : vec4<f32>,
  @location(7) icol2 : vec4<f32>
) -> VSOut {
  let M = mat4x4<f32>(m0, m1, m2, m3);
  let wp = M * vec4<f32>(ipos, 1.0);
  var o : VSOut;
  o.pos = F.viewProj * wp;
  o.wpos = wp.xyz;
  o.nrm = normalize((M * vec4<f32>(inrm, 0.0)).xyz);
  o.col = icol * icol2.rgb;
  return o;
}

fn shadowAt(wp : vec3<f32>, n : vec3<f32>) -> f32 {
  // 同上：保持统一控制流，禁止基于片元数据的早退
  let lp = SH.lightVP * vec4<f32>(wp + n * 0.05, 1.0);
  let lw = max(lp.w, 1e-5);
  let pc = lp.xyz / lw;
  let uv = vec2<f32>(pc.x * 0.5 + 0.5, 0.5 - pc.y * 0.5);
  let d = clamp(pc.z, 0.0, 1.0) - 0.0012;
  var s = 0.0;
  let texel = SH.info.y;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      s += textureSampleCompare(shadowMap, shadowSamp,
        uv + vec2<f32>(f32(x), f32(y)) * texel, d);
    }
  }
  let ok = f32(lp.w > 0.0)
         * f32(pc.z >= 0.0 && pc.z <= 1.0)
         * f32(all(abs(pc.xy) < vec2<f32>(1.0, 1.0)));
  return mix(1.0, s / 9.0, SH.info.x * ok);
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4<f32> {
  let N = normalize(i.nrm);
  let V = normalize(F.camPos.xyz - i.wpos);
  let L = normalize(F.sunDir.xyz);
  let H = normalize(L + V);
  let sh = shadowAt(i.wpos, N);
  let ndl = max(dot(N, L), 0.0);
  let sun = vec3<f32>(1.35, 1.24, 1.05) * ndl * sh;
  let up = N.y * 0.5 + 0.5;
  let amb = mix(vec3<f32>(0.30, 0.31, 0.33), skyColor(N) * 0.85, up) * 0.55;
  var col = i.col * (sun + amb);
  col += vec3<f32>(1.0, 0.96, 0.88) * pow(max(dot(N, H), 0.0), 22.0) * 0.25 * sh * ndl;
  let dist = length(F.camPos.xyz - i.wpos);
  col = applyFog(col, dist);
  col = applyWaterFog(col, dist, F.sunDir.w);
  // alpha：到相机距离（水面据此做遮挡剔除与吸收厚度估算）
  return vec4<f32>(col, dist);
}
`;

  /* ---------- 海面（Gerstner 位移 + 折射 + 反射 + 泡沫 + SSS） ---------- */
  const WATER = COMMON + /* wgsl */`
const NW : i32 = 7;
struct WaveBuf { w : array<vec4<f32>, 7> };

@group(1) @binding(0) var sceneTex : texture_2d<f32>;
@group(1) @binding(1) var samp : sampler;
@group(1) @binding(2) var<uniform> WB : WaveBuf;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) wpos : vec3<f32>,
  @location(1) nrm  : vec3<f32>,
  @location(2) waveH : f32,
};

@vertex
fn vs_main(@location(0) ipos : vec2<f32>) -> VSOut {
  let t = F.camPos.w;
  let p = F.waterO.xy + ipos;      // 极坐标网格跟随相机
  var y = 0.0;
  var dx = 0.0;
  var dz = 0.0;
  for (var i = 0; i < NW; i = i + 1) {
    let w = WB.w[i];
    let k = w.w;
    let c = sqrt(9.8 / k);
    let f = k * (w.x * p.x + w.y * p.y - c * t);
    let a = w.z / k * F.params.w;
    y += a * sin(f);
    let co = w.z * cos(f) * F.params.w;
    dx += co * w.x;
    dz += co * w.y;
  }
  let wp = vec3<f32>(p.x, y, p.y);
  var o : VSOut;
  o.pos = F.viewProj * vec4<f32>(wp, 1.0);
  o.wpos = wp;
  o.nrm = normalize(vec3<f32>(-dx, 1.0, -dz));
  o.waveH = y;
  return o;
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4<f32> {
  let t = F.camPos.w;
  let V = normalize(F.camPos.xyz - i.wpos);
  var N = normalize(i.nrm);

  // 近处细波纹（法线扰动），远处淡出避免摩尔纹
  let distV = length(F.camPos.xyz - i.wpos);
  let detailFade = 1.0 - smoothstep(6.0, 90.0, distV);
  let q = i.wpos.xz;
  let n1 = fbm(q * 0.85 + vec2<f32>(t * 0.35, t * 0.22), 3);
  let n2 = fbm(q * 2.10 - vec2<f32>(t * 0.55, t * 0.31), 3);
  N = normalize(N + vec3<f32>(n1 - 0.5, 0.0, n2 - 0.5) * 0.55 * detailFade);

  let fromBelow = dot(N, V) < 0.0;
  if (fromBelow) { N = -N; }

  let L = normalize(F.sunDir.xyz);
  var R = reflect(-V, N);
  R.y = abs(R.y) * 0.85 + 0.02;

  /* --- 折射：采样不透明场景色（alpha 通道存着到相机的距离） --- */
  let uv = i.pos.xy * F.screen.zw;
  let sceneD = textureSampleLevel(sceneTex, samp, uv, 0.0).a;   // 最近不透明表面距离
  let dWater = length(F.camPos.xyz - i.wpos);                    // 水面距离
  if (sceneD < dWater - 0.05) { discard; }                       // 前方有地形/物体遮挡
  var thick = sceneD - dWater;
  if (sceneD > 5000.0) { thick = 60.0; }                         // 只看到天空：按深水处理

  let off = N.xz * (0.045 * clamp(thick, 0.0, 1.2) + 0.006);
  let ruv = clamp(uv - off, vec2<f32>(0.001), vec2<f32>(0.999));
  var refr = textureSampleLevel(sceneTex, samp, ruv, 0.0).rgb;

  /* --- 吸收（Beer-Lambert，红光先被吃掉） --- */
  let sigma = vec3<f32>(0.62, 0.20, 0.14);
  let trans = exp(-sigma * thick * 1.15);
  let scatter = vec3<f32>(0.055, 0.30, 0.34) * (0.55 + 0.45 * max(dot(L, V), 0.0));
  var water = refr * trans + scatter * (1.0 - trans);

  /* --- 反射 --- */
  let fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  let refl = skyWithClouds(R, t);

  var col = mix(water, refl, clamp(fres, 0.0, 1.0));

  /* --- 太阳高光 --- */
  let H = normalize(L + V);
  col += vec3<f32>(1.0, 0.94, 0.82) * pow(max(dot(N, H), 0.0), 420.0) * 2.6;

  /* --- 次表面散射：浪尖透光 --- */
  let sss = pow(max(dot(V + L * 0.55, N), 0.0), 3.0) * smoothstep(-0.12, 0.62, i.waveH);
  col += vec3<f32>(0.06, 0.42, 0.38) * sss * 0.85;

  /* --- 白沫：浪峰 + 岸边 --- */
  let crest = smoothstep(0.72, 1.15, i.waveH) * (0.55 + 0.45 * fbm(q * 1.6 + vec2<f32>(t, -t), 3));
  let shore = smoothstep(0.85, 0.06, thick) * (0.6 + 0.4 * fbm(q * 2.4 - vec2<f32>(t * 0.7), 3));
  var foam = clamp(max(crest, shore), 0.0, 1.0);
  foam *= 1.0 - smoothstep(0.0, 0.35, -F.camPos.y);   // 在水下看不到表面白沫
  col = mix(col, vec3<f32>(0.95, 0.97, 0.98) * (0.75 + 0.35 * max(dot(N, L), 0.0)), foam * 0.9);

  /* --- 雾 --- */
  if (F.sunDir.w < 0.5) { col = applyFog(col, distV); }
  return vec4<f32>(col, 1.0);
}
`;

  /* ---------- 后处理：亮度提取 / 高斯模糊 / 合成 ---------- */
  const POST_BRIGHT = /* wgsl */`
struct PP { d : vec4<f32> };   // x 阈值, y 强度, z 未用, w 未用
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var<uniform> P : PP;

struct VSOut { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32> };

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var o : VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>((p[vi].x + 1.0) * 0.5, 1.0 - (p[vi].y + 1.0) * 0.5);
  return o;
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4<f32> {
  let c = textureSampleLevel(src, samp, i.uv, 0.0).rgb;
  let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  let k = max(l - P.d.x, 0.0) / max(l, 0.0001);
  return vec4<f32>(c * k, 1.0);
}
`;

  const POST_BLUR = /* wgsl */`
struct PP { d : vec4<f32> };   // xy 方向, zw 像素尺寸
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var<uniform> P : PP;

struct VSOut { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32> };

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var o : VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>((p[vi].x + 1.0) * 0.5, 1.0 - (p[vi].y + 1.0) * 0.5);
  return o;
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4<f32> {
  let step = P.d.xy * P.d.zw;
  var s = textureSampleLevel(src, samp, i.uv, 0.0).rgb * 0.2270270270;
  s += textureSampleLevel(src, samp, i.uv + step * 1.3846153846, 0.0).rgb * 0.3162162162;
  s += textureSampleLevel(src, samp, i.uv - step * 1.3846153846, 0.0).rgb * 0.3162162162;
  s += textureSampleLevel(src, samp, i.uv + step * 3.2307692308, 0.0).rgb * 0.0702702703;
  s += textureSampleLevel(src, samp, i.uv - step * 3.2307692308, 0.0).rgb * 0.0702702703;
  return vec4<f32>(s, 1.0);
}
`;

  const POST_COMP = /* wgsl */`
struct PP { d : vec4<f32> };  // x 曝光, y bloom强度, z 暗角, w 颗粒/时间
@group(0) @binding(0) var scene : texture_2d<f32>;
@group(0) @binding(1) var bloom : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;
@group(0) @binding(3) var<uniform> P : PP;

struct VSOut { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32> };

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var o : VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>((p[vi].x + 1.0) * 0.5, 1.0 - (p[vi].y + 1.0) * 0.5);
  return o;
}

/* ACES 近似色调映射 */
fn aces(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn srgb(c : vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

fn hash12(p : vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += vec3<f32>(dot(p3, p3.yzx + 33.33));
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(scene, samp, i.uv, 0.0).rgb;
  let b = textureSampleLevel(bloom, samp, i.uv, 0.0).rgb;
  c = c + b * P.d.y;
  c = c * P.d.x;
  c = aces(c);

  // 暗角
  let d = distance(i.uv, vec2<f32>(0.5));
  c *= 1.0 - P.d.z * smoothstep(0.42, 0.92, d);

  // 胶片颗粒
  let g = hash12(i.uv * vec2<f32>(1920.0, 1080.0) + vec2<f32>(P.d.w, P.d.w * 1.7)) - 0.5;
  c += g * 0.016;

  return vec4<f32>(srgb(c), 1.0);
}
`;

  /* ---------- 阴影：仅深度（实体 / 实例两套） ---------- */
  const SHADOW_DEPTH = COMMON + /* wgsl */`
struct Obj {
  model : mat4x4<f32>,
  tint  : vec4<f32>,
  m2    : vec4<f32>,
};
@group(1) @binding(0) var<uniform> O : Obj;

@vertex
fn vs_main(@location(0) ipos : vec3<f32>) -> @builtin(position) vec4<f32> {
  return F.viewProj * (O.model * vec4<f32>(ipos, 1.0));
}
`;

  const SHADOW_INST = COMMON + /* wgsl */`
@vertex
fn vs_main(
  @location(0) ipos : vec3<f32>,
  @location(3) m0 : vec4<f32>,
  @location(4) m1 : vec4<f32>,
  @location(5) m2 : vec4<f32>,
  @location(6) m3 : vec4<f32>
) -> @builtin(position) vec4<f32> {
  let M = mat4x4<f32>(m0, m1, m2, m3);
  return F.viewProj * (M * vec4<f32>(ipos, 1.0));
}
`;

  S.WGSL = { COMMON, SKY, SOLID, INST, WATER, SHADOW_DEPTH, SHADOW_INST, POST_BRIGHT, POST_BLUR, POST_COMP };
})();
