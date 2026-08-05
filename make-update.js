'use strict';
/* ============================================================
 * 生成一键更新资源包 update.json
 * 用法：node make-update.js [版本号]
 * 输出：update/update.json —— 上传到任意静态托管（GitHub Releases /
 *       自有服务器 / 网盘直链），再把直链填入 config.json 的 updateUrl。
 * 玩家在设置 → 一键更新 → 检查更新 → 重启生效。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const version = process.argv[2] || `1.0.${Date.now().toString(36)}`;
const outDir = path.join(__dirname, 'update');
fs.mkdirSync(outDir, { recursive: true });

/* 打包 public/**（前端界面）与 game/**（规则/词条池，重启后生效） */
function walk(dir, base) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(full, base));
    else if (f.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}
const files = {};
for (const rel of walk(path.join(__dirname, 'public'), path.join(__dirname, 'public'))) {
  if (rel.startsWith('audio/')) continue; // 音乐随 exe 分发，不进热更包
  files['public/' + rel] = fs.readFileSync(path.join(__dirname, 'public', rel)).toString('base64');
}
for (const rel of walk(path.join(__dirname, 'game'), path.join(__dirname, 'game'))) {
  files['game/' + rel] = fs.readFileSync(path.join(__dirname, 'game', rel)).toString('base64');
}

const pkg = {
  version,
  note: `仙途 · 苍玄界 前端资源更新 ${version}`,
  files,
};
fs.writeFileSync(path.join(outDir, 'update.json'), JSON.stringify(pkg), 'utf8');
console.log(`已生成 update/update.json（版本 ${version}，${Object.keys(files).length} 个文件，${(fs.statSync(path.join(outDir, 'update.json')).size / 1024).toFixed(1)} KB）`);
console.log('发布：把 update.json 放到任意静态托管，将直链填入 config.json 的 "updateUrl"。');
