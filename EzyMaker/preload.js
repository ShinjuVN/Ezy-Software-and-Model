const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  saveFile: (name, bytes, filterName, ext) => ipcRenderer.invoke('save-file', name, bytes, filterName, ext),
  reveal: p => ipcRenderer.send('reveal', p)
});
