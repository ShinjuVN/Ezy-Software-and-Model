const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  set: p => ipcRenderer.send('set-settings', p),
  onState: f => ipcRenderer.on('state', (e, v) => f(v)),
  onMic: f => ipcRenderer.on('mic-state', (e, v) => f(v)),
  onLevel: f => ipcRenderer.on('level', (e, v) => f(v)),
  quit: () => ipcRenderer.send('quit'),
  switchModel: id => ipcRenderer.send('switch-model', id),
  rescan: () => ipcRenderer.send('rescan-models'),
  openFolder: () => ipcRenderer.send('open-models-folder'),
  faceSet: a => ipcRenderer.send('face-set', a),
  setActionHotkey: (k, accel) => ipcRenderer.invoke('action-hotkey', k, accel),
  importModels: paths => ipcRenderer.invoke('import-model', paths),
  pathOf: f => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  renameModel: (id, name) => ipcRenderer.invoke('model-rename', id, name),
  setModelHotkey: (id, accel) => ipcRenderer.invoke('model-hotkey', id, accel),
  setSettingsHotkey: accel => ipcRenderer.invoke('settings-hotkey', accel),
  hotkeyCapture: on => ipcRenderer.send('hotkey-capture', !!on)
});
