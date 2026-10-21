const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Chỉ cho phép mở các link này bằng trình duyệt ngoài
const LINKS = {
  seethrough: 'https://huggingface.co/spaces/24yearsold/see-through-demo',
  github: 'https://github.com/shitagaki-lab/see-through'
};
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

ipcMain.handle('get-prompt', () => {
  // prompt.txt cạnh app: người dùng có thể tự sửa nếu muốn
  for (const p of [path.join(BASE, 'prompt.txt'), path.join(__dirname, 'prompt.txt')]) { try { return fs.readFileSync(p, 'utf8'); } catch (e) {} }
  return '(Không tìm thấy prompt.txt)';
});
ipcMain.handle('open-link', (e, key) => { if (LINKS[key]) { shell.openExternal(LINKS[key]); return true; } return false; });
ipcMain.handle('save-file', async (e, defaultName, bytes, filterName, ext) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, Buffer.from(bytes)); return { ok: true, path: r.filePath }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('save-text', async (e, defaultName, text) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: 'Văn bản', extensions: ['txt'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, text, 'utf8'); return { ok: true, path: r.filePath }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.on('reveal', (e, p) => { if (typeof p === 'string') shell.showItemInFolder(p); });

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
