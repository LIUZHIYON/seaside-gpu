/* 非 GPU 逻辑冒烟测试：地形 / 波浪 / 道具 / 船 / 玩家 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

global.window = { Seaside: {}, addEventListener() {} };
global.document = {
  addEventListener() {},
  getElementById: () => null,
  createElement: () => ({ getContext: () => null })
};
global.performance = { now: () => 0 };

const files = ['math.js', 'noise.js', 'waves.js', 'terrain.js', 'geom.js', 'props.js', 'boat.js', 'player.js'];
for (const f of files) {
  const code = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  new Function('window', 'document', 'performance', code)(global.window, global.document, global.performance);
}
const S = global.window.Seaside;

let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log('OK   ' + msg + (extra ? '  ' + extra : ''));
  else { fails++; console.log('FAIL ' + msg + (extra ? '  ' + extra : '')); }
}

// 地形
const t0 = Date.now();
const terr = S.buildTerrainMesh(64);
ok(terr.verts.length === 65 * 65 * 9, '地形顶点数', terr.verts.length / 9 + ' 顶点, ' + terr.idx.length / 3 + ' 三角形, ' + (Date.now() - t0) + 'ms');
ok(terr.idx.length === 64 * 64 * 6, '地形索引数');

// 高度与波浪
const hBeach = S.terrainHeight(0, -10), hSea = S.terrainHeight(0, 100);
ok(hBeach > 0, '陆地高度 > 0', hBeach.toFixed(2));
ok(hSea < -3, '深海高度 < -3', hSea.toFixed(2));
ok(Math.abs(S.waveHeight(0, 0, 0)) < 3, '波浪高度合理', S.waveHeight(3, 7, 1.5).toFixed(3));

// 道具
const P = S.Props;
const cases = [
  ['棕榈', () => P.palmMesh(-20, -5, 1, 1)],
  ['阔叶树', () => P.treeMesh(-40, -30, 2, 1.2)],
  ['礁石', () => P.rockMesh(-46, 46, 3, 3, true)],
  ['浮木', () => P.driftMesh(10, -4, 5)],
  ['草丛', () => P.grassMesh(0, -20, 6, false)],
  ['海草', () => P.grassMesh(0, 40, 7, true)],
  ['螃蟹', () => P.crabMesh()],
  ['海鸥', () => P.birdMesh()],
  ['鱼', () => P.fishMesh()],
  ['卵石', () => P.pebbleMesh()],
  ['贝壳', () => P.shellMesh()],
  ['木栈桥', () => P.pierMesh(-52, 2, 64)]
];
for (const [name, fn] of cases) {
  try {
    const d = fn().data();
    ok(d.verts.length > 0 && d.idx.length > 0, '道具 ' + name,
      (d.verts.length / 9) + ' 顶点 / ' + (d.idx.length / 3) + ' 面');
  } catch (e) { ok(false, '道具 ' + name, e.message); }
}

// 船
const parts = S.initBoat();
ok(parts.hull.idx.length > 0, '船体', (parts.hull.verts.length / 9) + ' 顶点 / ' + (parts.hull.idx.length / 3) + ' 面');
ok(parts.oarL.idx.length > 0 && parts.oarR.idx.length > 0, '双桨');
const bm = S.boatMatrix(new Float32Array(16));
ok(Math.abs(bm[12] - S.boat.x) < 1e-5, '船体矩阵平移正确', 'x=' + bm[12].toFixed(2));
const om = S.oarMatrix(new Float32Array(16), bm, 1);
ok(isFinite(om[12]) && isFinite(om[13]), '桨矩阵有效', 'pos=(' + om[12].toFixed(2) + ',' + om[13].toFixed(2) + ')');

// 玩家
S.keys = { KeyW: true };
const before = S.player.pos.slice();
for (let i = 0; i < 60; i++) S.updatePlayer(1 / 60, i / 60);
const moved = Math.hypot(S.player.pos[0] - before[0], S.player.pos[2] - before[2]);
ok(moved > 1, '前进位移', moved.toFixed(2) + ' 米/秒');
ok(isFinite(S.player.pos[1]), '玩家高度有效', S.player.pos[1].toFixed(2));

console.log(fails ? `\n${fails} 项失败` : '\n冒烟测试全部通过');
process.exit(fails ? 1 : 0);
