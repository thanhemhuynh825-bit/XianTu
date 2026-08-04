'use strict';
/* 桌面桥：渲染进程 → 主进程（重启应用 / 打开文件夹） */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('xmu', {
  relaunch: () => ipcRenderer.send('app-relaunch'),
  openPath: (p) => ipcRenderer.send('open-path', p),
  isDesktop: true,
});
