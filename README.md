# 听海 · Seaside Breeze（WebGPU 重写版）

一个**手写 WebGPU 渲染管线**的海边自由探索模拟页面。零第三方依赖（不使用 Three.js / Babylon 等任何图形库），从 `navigator.gpu` 到 WGSL 着色器、从 Gerstner 波到 Bloom 后处理，全部自己实现。

> CMIT 参赛作品 · 需 **Chrome / Edge 113+**（或任意支持 WebGPU 的浏览器）

---

## 运行

双击 `index.html` 即可（脚本为普通 `<script>` 加载，非 ES Module，无需本地服务器）。

若浏览器不支持 WebGPU，页面会显示明确的降级提示。

---

## 操作

| 操作 | 按键 |
| --- | --- |
| 移动 | `W` `A` `S` `D` |
| 360° 环视 | **拖动鼠标**（无需指针锁定，iframe 内也可用） |
| 疾跑 / 跳跃 | `Shift` / `Space` |
| 游泳上浮 / 下潜 | `Space` / `Shift`+`C` |
| 登船 / 离船 | `E` |
| 驾船前进 / 转向 | `W` `S` / `A` `D` |
| 音乐 / 辉光 / 阴影 | `M` / `B` / `P` |
| 帮助 / 全屏 | `H` / 工具栏按钮 |

场景：西边有 60 m 木栈桥（带栏杆），东边有小岛与礁石，岸边有棕榈、海草、贝壳、螃蟹，海上有飞鸟，水下有鱼群。

---

## 文件结构

```
seaside-gpu/
├─ index.html            入口（HUD / 开始界面 / 脚本装载顺序）
├─ css/style.css         HUD、开始卡片、水下色调、暗角
└─ js/
   ├─ math.js            mat4 / vec3（列主序，WebGPU 深度范围 [0,1]）
   ├─ noise.js           hash / value noise / fBm / 确定性 rng
   ├─ waves.js           7 组 Gerstner 波参数，JS 与 WGSL 共用同一份数据
   ├─ terrain.js         地形高度场 + 顶点着色 + 网格烘焙
   ├─ geom.js            程序化几何库（box/cyl/sphere/torus/quad + 法线重算）
   ├─ gpu.js             WebGPU 设备/缓冲/管线封装，含错误捕获
   ├─ shaders.js         全部 WGSL：天空、实体、实例化、水面、阴影、后处理
   ├─ props.js           棕榈、树、礁石、栈桥、海草、螃蟹、飞鸟、鱼、贝壳
   ├─ boat.js            放样船体 + 船桨 + 物理（俯仰/横滚限幅）
   ├─ player.js          第一人称控制：行走/游泳/驾船，支持拖动环视
   ├─ audio.js           Web Audio 程序化轻音乐与海浪环境声
   ├─ ui.js              HUD、提示、面板开关
   └─ main.js            渲染器装配、帧循环、通道编码、自检探针
tools/
   ├─ check-wgsl.js      用 wgsl_reflect 静态校验全部着色器
   └─ smoke.js           Node 冒烟测试（地形/波浪/道具/船/玩家）
```

---

## 渲染管线（每帧）

1. **阴影通道** — 2048² `depth32float`，正交光矩阵，实体与实例化各一条管线，`depthBias` 防 acne
2. **天空 + 不透明场景** → HDR `rgba16float`
   - 天空：全屏三角形，`invViewProj` 反投影出视线方向，程序化瑞利渐变 + 域扭曲双层 fBm 云
   - 把**线性距离写入 alpha 通道**，水面折射时用来做遮挡判断
3. **场景 A → B 拷贝** — 供水面采样（读取上一份不透明场景）
4. **水面通道** — 屏幕空间折射
   - **极坐标网格** 118×128，近密远疏，半径 300 m，跟随相机
   - 顶点着色器做 7 波 Gerstner 位移与法线解析求导
   - 片元：`discard` 掉被地形遮挡的像素，Beer–Lambert 吸收算水体厚度，Fresnel 混合反射/折射，波峰次表面散射
5. **Bloom** — 亮部提取 → 半分辨率可分离高斯（H/V）→ 合成
6. **合成** — ACES tonemap + 暗角 + 胶片颗粒 + sRGB 编码

---

## 关键技术点

- **零依赖**：没有 `import`，全部挂在 `window.Seaside` 命名空间下，支持 `file://` 直开
- **统一控制流**：WGSL 的 `textureSampleCompare` 只允许在 uniform control flow 中调用，因此阴影函数 `shadowAt()` 内**不能有任何基于片元数据的分支/早退**，越界与开关一律用 0/1 权重在末尾统一处理
- **管线/通道附件必须严格匹配**：带深度附件的 RenderPass 中，天空管线也必须声明同样的 `depthStencil` 状态
- **屏幕空间折射**：不透明场景先把线性距离存进 alpha，水面按 `sceneD < dWater - 0.05` 剔除被地形挡住的片元，避免水下地形"透穿"水面
- **水下表现**：相机入水后由 `sunDir.w` 标记驱动，天空背景整体替换为水体色（朝上渐亮），实体叠加水下雾，UI 叠加青色滤镜，音频切到水下低通
- **共享波参数**：`S.WAVE_GPU` 以 `vec4<f32>` 数组形式同时供 JS（物理/浮力）与 WGSL（顶点位移）使用，保证船与水面完全贴合

---

## 自检

页面启动后会自动做一次**像素回读自检**（`S.probe()`），把 HDR 场景纹素读回 CPU 计算平均亮度与平均 RGB；若接近全黑会在界面上给出警告。手动触发：`window.Seaside.probeNow()`。

静态校验与冒烟测试：

```bash
node tools/check-wgsl.js   # 全部着色器语法与入口点校验
node tools/smoke.js        # 地形/波浪/道具/船/玩家逻辑
```

---

## 已知限制

- 需要支持 WebGPU 的浏览器；Firefox / Safari 旧版本不支持
- 水面折射是屏幕空间的，极近处相机切到水下时会有短暂过渡
- 阴影贴图覆盖以相机为中心的区域，远处岛屿边缘阴影会逐渐淡出
