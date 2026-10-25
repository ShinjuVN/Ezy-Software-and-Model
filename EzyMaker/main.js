const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : __dirname;
let win = null;

function create() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1000, minHeight: 600, backgroundColor: '#1b1a21', title: 'Ezy Maker',
    icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, spellcheck: false }
  });
  win.loadFile('index.html');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
}

ipcMain.handle('save-file', async (e, defaultName, bytes, filterName, ext) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, Buffer.from(bytes)); return { ok: true, path: r.filePath }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.on('reveal', (e, p) => { if (typeof p === 'string') shell.showItemInFolder(p); });

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
