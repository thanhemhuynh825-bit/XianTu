'use strict';

/* ============================================================
 * 仙途 · 苍玄界 — 桌面版主进程
 * 内置本地服务器 + 原生窗口，一键运行，无需浏览器
 * ============================================================ */

const { app, BrowserWindow, shell, Menu, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

/* 数据目录必须在 require server.js 之前设置（server 模块顶层读取存档路径） */
app.setName('仙途');
const DATA_DIR = path.join(app.getPath('userData'), 'data');
process.env.XMUD_DATA_DIR = DATA_DIR;
process.env.XMUD_CONFIG_DIR = DATA_DIR;
const RES_DIR = path.join(app.getPath('userData'), 'update');
process.env.XMUD_RES_DIR = RES_DIR;

/* 旧版名「仙途苍玄界」的存档迁移（改名后不丢档） */
(function migrateLegacyData() {
  try {
    const legacy = path.join(app.getPath('userData').replace(/仙途[\\/]?$/, ''), '仙途苍玄界', 'data');
    if (legacy !== DATA_DIR && fs.existsSync(legacy) && !fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
      fs.cpSync(legacy, DATA_DIR, { recursive: true });
      log('已迁移旧存档 →', DATA_DIR);
    }
  } catch (e) { log('legacy migrate failed:', e.message); }
})();

const { startServer } = require('../server.js');

/* 启动日志（排查用） */
const LOG = process.env.XMUD_LOG || (() => { try { return path.join(app.getPath('userData'), 'launch.log'); } catch { return ''; } })();
function log(...a) {
  try { if (LOG) fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${a.join(' ')}\n`, 'utf8'); } catch { /* ignore */ }
}
process.on('uncaughtException', e => log('UNCAUGHT:', e && e.stack || e));
process.on('unhandledRejection', e => log('UNHANDLED:', e && e.stack || e));

/* 端口占用时自动换可用端口 */
function getFreePort(preferred) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => {
      const s2 = net.createServer();
      s2.listen(0, '127.0.0.1', () => { const p = s2.address().port; s2.close(() => resolve(p)); });
    });
    probe.listen(preferred, '127.0.0.1', () => { probe.close(() => resolve(preferred)); });
  });
}

app.setName('仙途苍玄界');

app.whenReady().then(async () => {
  log('app ready, start server...');
  try {
    /* 首次运行：把内置 config.json 复制到数据目录（玩家可自行修改模型/温度等）；
     * 智能合并：内置配置的 updateUrl 非空而本地为空时，自动补齐（一键更新开箱即用） */
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const extConfig = path.join(DATA_DIR, 'config.json');
    try {
      if (!fs.existsSync(extConfig)) {
        fs.copyFileSync(path.join(__dirname, '..', 'config.json'), extConfig);
      } else {
        const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
        const local = JSON.parse(fs.readFileSync(extConfig, 'utf8'));
        let changed = false;
        if (bundled.updateUrl && !local.updateUrl) {
          local.updateUrl = bundled.updateUrl;
          changed = true;
          log('updateUrl 已自动配置:', local.updateUrl);
        }
        /* 讯飞语音配置：内置有而本地缺时自动补齐（新功能开箱即用） */
        if (bundled.stt && !local.stt) {
          local.stt = bundled.stt;
          changed = true;
          log('讯飞语音配置已自动补齐');
        }
        if (changed) fs.writeFileSync(extConfig, JSON.stringify(local, null, 2), 'utf8');
      }
    } catch (e) { log('config init failed:', e.message); }

    const port = await getFreePort(8787);
    log('server port:', port);
    const { server } = startServer(port);
    log('server started');

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      title: '仙途',
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      backgroundColor: '#0d0b09',
      show: false, // 防白屏：就绪后再显示
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    /* 语音输入：允许麦克风权限（讯飞/内置语音识别用） */
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'media');
    });
    win.setMenuBarVisibility(false);
    Menu.setApplicationMenu(null);
    win.loadURL(`http://127.0.0.1:${port}`);
    win.once('ready-to-show', () => { win.show(); log('window shown'); });
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    win.on('closed', () => app.quit());
  } catch (e) {
    log('STARTUP ERROR:', e && e.stack || e);
  }
});

/* 重启应用（热更后一键生效） */
ipcMain.on('app-relaunch', () => {
  log('relaunch requested');
  app.relaunch();
  app.exit(0);
});
/* 打开文件夹（下载目录定位） */
ipcMain.on('open-path', (_e, p) => {
  try { shell.showItemInFolder(String(p)); } catch (e) { log('open-path failed:', e.message); }
});

app.on('window-all-closed', () => app.quit());
