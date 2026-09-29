/* WGSL 语法静态校验（Node 侧，无需 GPU） */
const fs = require('fs');
const path = require('path');
const { WgslReflect } = require('C:/Users/922/.workbuddy/binaries/node/workspace/node_modules/wgsl_reflect/wgsl_reflect.module.js');

const root = path.join(__dirname, '..');
global.window = { Seaside: {} };
const files = ['js/shaders.js'];
for (const f of files) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  // 用函数包装执行浏览器端 IIFE
  new Function('window', code)(global.window);
}
const W = global.window.Seaside.WGSL;
let bad = 0;
for (const [name, src] of Object.entries(W)) {
  if (typeof src !== 'string') continue;
  try {
    const r = new WgslReflect(src);
    const entries = r.entry ? [...r.entry.vertex.map(e => e.name), ...r.entry.fragment.map(e => e.name)] : [];
    console.log(`OK   ${name}  入口: ${entries.join(', ') || '(无)'}`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
console.log(bad ? `\n发现 ${bad} 个着色器语法错误` : '\n全部着色器语法通过');
process.exit(bad ? 1 : 0);
