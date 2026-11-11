const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pvz', {
  getCfg: () => ipcRenderer.invoke('getCfg'),
  setCfg: c => ipcRenderer.invoke('setCfg', c),
  pickFolder: w => ipcRenderer.invoke('pickFolder', w),
  openFolder: p => ipcRenderer.invoke('openFolder', p),
  nav: w => ipcRenderer.invoke('nav', w),
  start: c => ipcRenderer.invoke('start', c),
  stop: () => ipcRenderer.invoke('stop'),
  checkUpdate: () => ipcRenderer.invoke('checkUpdate'),
  version: () => ipcRenderer.invoke('version'),
  onStatus: cb => ipcRenderer.on('status', (_e, s) => cb(s)),
  onUrl: cb => ipcRenderer.on('url', (_e, s) => cb(s))
});
