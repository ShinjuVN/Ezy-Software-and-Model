const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onCursor: f => ipcRenderer.on('cur', (e, v) => f(v)),
  onSettings: f => ipcRenderer.on('settings', (e, v) => f(v)),
  onLvl: f => ipcRenderer.on('lvl-on', (e, v) => f(v)),
  onModel: f => ipcRenderer.on('load-model', (e, v) => f(v)),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getModel: () => ipcRenderer.invoke('get-model'),
  micStatus: s => ipcRenderer.send('mic-status', s),
  level: v => ipcRenderer.send('level', v)
});
