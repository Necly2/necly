const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pvz', {
  getCfg: () => ipcRenderer.invoke('getCfg'),
  setCfg: c => ipcRenderer.invoke('setCfg', c),
  pickFolder: w => ipcRenderer.invoke('pickFolder', w),
  openFolder: p => ipcRenderer.invoke('openFolder', p),
  nav: w => ipcRenderer.invoke('nav', w),
  start: c => ipcRenderer.invoke('start', c),
  stop: () => ipcRenderer.invoke('stop'),
  bwOrder: () => ipcRenderer.invoke('bwOrder'),
  ozonScan: () => ipcRenderer.invoke('ozonScan'),
  ozonStart: p => ipcRenderer.invoke('ozonStart', p),
  ozonStop: () => ipcRenderer.invoke('ozonStop'),
  ozonState: () => ipcRenderer.invoke('ozonState'),
  onOzonStatus: cb => ipcRenderer.on('ozonStatus', (_e, s) => cb(s)),
  onOzonDone: cb => ipcRenderer.on('ozonDone', (_e, s) => cb(s)),
  checkUpdate: () => ipcRenderer.invoke('checkUpdate'),
  version: () => ipcRenderer.invoke('version'),
  onStatus: cb => ipcRenderer.on('status', (_e, s) => cb(s)),
  onUrl: cb => ipcRenderer.on('url', (_e, s) => cb(s))
});
