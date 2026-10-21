const { contextBridge, ipcRenderer, clipboard } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getPrompt: () => ipcRenderer.invoke('get-prompt'),
  openLink: k => ipcRenderer.invoke('open-link', k),
  saveFile: (name, bytes, filterName, ext) => ipcRenderer.invoke('save-file', name, bytes, filterName, ext),
  saveText: (name, text) => ipcRenderer.invoke('save-text', name, text),
  reveal: p => ipcRenderer.send('reveal', p),
  copy: t => clipboard.writeText(String(t))
});
