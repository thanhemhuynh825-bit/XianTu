'use strict';
/* electron-builder afterPack：打包后自动为 exe 应用「仙」字图标与版本信息；并从分发产物中剥离 apiKey（防泄露） */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function (context) {
  try {
    const { appOutDir, packager } = context;
    const exePath = path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
    const rcedit = path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
    const icon = path.join(__dirname, '..', 'build', 'icon.ico');
    console.log('[afterPack] exe:', exePath);
    console.log('[afterPack] rcedit 存在:', fs.existsSync(rcedit), '| icon 存在:', fs.existsSync(icon));
    if (!fs.existsSync(exePath) || !fs.existsSync(rcedit) || !fs.existsSync(icon)) return;
    const { status, stderr } = spawnSync(rcedit, [
      exePath,
      '--set-icon', icon,
      '--set-version-string', 'ProductName', '仙途',
      '--set-version-string', 'FileDescription', '仙途 - AI 实时演绎修仙文字世界',
      '--set-version-string', 'CompanyName', '仙途',
    ], { encoding: 'utf8' });
    if (status !== 0) {
      console.warn('[afterPack] rcedit 失败:', stderr || `exit ${status}`);
    } else {
      console.log('[afterPack] ✓ 图标已应用', exePath);
    }

    /* 安全：从分发产物 app.asar 中剥离 apiKey（本机密钥不随 EXE 外发） */
    try {
      const asar = require('@electron/asar');
      const asarPath = path.join(appOutDir, 'resources', 'app.asar');
      if (fs.existsSync(asarPath)) {
        const tmp = path.join(appOutDir, 'resources', 'app-strip');
        fs.rmSync(tmp, { recursive: true, force: true });
        asar.extractAll(asarPath, tmp);
        const cfgPath = path.join(tmp, 'config.json');
        if (fs.existsSync(cfgPath)) {
          const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
          if (j.apiKey) {
            j.apiKey = '';
            fs.writeFileSync(cfgPath, JSON.stringify(j, null, 2), 'utf8');
            console.log('[afterPack] 已剥离 apiKey（防泄露）');
          } else {
            console.log('[afterPack] apiKey 为空，无需剥离');
          }
        }
        await asar.createPackage(tmp, asarPath);
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn('[afterPack] 剥离 apiKey 失败（忽略）:', e.message);
    }
  } catch (e) {
    console.warn('[afterPack] 异常:', e.message);
  }
};
