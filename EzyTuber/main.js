const { app, BrowserWindow, ipcMain, screen, session, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Giữ animation chạy khi cửa sổ bị che / không focus (quan trọng cho OBS).
// CalculateNativeWinOcclusion: Chromium mặc định NGỪNG vẽ cửa sổ bị cửa sổ khác che hoàn toàn -> tắt đi.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/* ====================================================================
   Thư mục dữ liệu: nằm CẠNH file .exe (bản portable) hoặc cạnh mã nguồn khi chạy thử.
     <thư mục gốc>/config.json        cài đặt chung
     <thư mục gốc>/model/<tên>/...    mỗi model một thư mục
   Nếu thư mục đó không ghi được (vd. cài vào Program Files) thì dùng thư mục dữ liệu của app.
   ==================================================================== */
function pickBase() {
  const cands = [];
  if (process.env.EZY_HOME) cands.push(process.env.EZY_HOME);
  cands.push(app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : __dirname);
  for (const c of cands) {
    try { fs.mkdirSync(c, { recursive: true }); fs.accessSync(c, fs.constants.W_OK); return c; } catch (e) {}
  }
  return app.getPath('userData');
}
const BASE = pickBase();
const MODELS_DIR = path.join(BASE, 'model');
const CFG_FILE = path.join(BASE, 'config.json');
try { fs.mkdirSync(MODELS_DIR, { recursive: true }); } catch (e) {}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/* ---------- Cài đặt chung (config.json) ---------- */
const DEF = { mic: false, sens: 14, emote: false, spk: false, bg: 'transparent', top: false, fps: 30, gpuOff: false, breath: 2,
  hotkeySettings: 'Super+F12', currentModel: '', win: null };
const FPS = [15, 20, 30, 60];
const BGS = ['#00b140', '#0047bb', '#ff00ff', '#2b2833', '#f2efe9', 'transparent'];
const FALLBACK_HK = 'Control+Alt+F12'; // phím dự phòng mở Cài đặt, phòng khi Windows từ chối phím Win
let S = { ...DEF };

/* ---------- Phím tắt: kiểm tra định dạng (khớp với trình bắt phím trong settings.html) ---------- */
const KEY_RE = '(?:[A-Z0-9]|F(?:[1-9]|1\\d|2[0-4])|num[0-9]|numadd|numsub|nummult|numdiv|numdec|Up|Down|Left|Right|Space|Return|Tab|Delete|Insert|Home|End|PageUp|PageDown|[-=,./;\'\\[\\]\\\\`])';
const ACCEL_RE = new RegExp('^(Control\\+)?(Alt\\+)?(Shift\\+)?(Super\\+)?(' + KEY_RE + ')$');
function validAccel(a) {
  if (typeof a !== 'string' || a.length > 40) return false;
  const m = ACCEL_RE.exec(a);
  if (!m) return false;
  const hasMod = !!(m[1] || m[2] || m[3] || m[4]);
  return hasMod || /^F\d+$/.test(m[5]); // phím thường phải kèm Ctrl/Alt/Shift/Win, riêng F1–F24 được đứng một mình
}

function cleanName(v) { return String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60); }
function cleanTune(t) {
  const out = {};
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    let c = 0;
    for (const [k, v] of Object.entries(t)) {
      if (++c > 120) break;
      if (/^[A-Za-z0-9_]{1,40}$/.test(k) && isNum(v) && Math.abs(v) <= 1000) out[k] = v;
    }
  }
  return out;
}
function sanitizeGlobal(p, cur) {
  const n = { ...cur };
  for (const k of ['mic', 'emote', 'spk', 'top', 'gpuOff']) if (typeof p[k] === 'boolean') n[k] = p[k];
  if (isNum(p.sens)) n.sens = clamp(p.sens, 2, 40);
  if (BGS.includes(p.bg)) n.bg = p.bg;
  if (FPS.includes(p.fps)) n.fps = p.fps;
  if ([0, 1, 2].includes(p.breath)) n.breath = p.breath;
  return n;
}
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8').replace(/^\uFEFF/, ''));
    S = sanitizeGlobal(raw, { ...DEF });
    if (typeof raw.hotkeySettings === 'string' && (raw.hotkeySettings === '' || validAccel(raw.hotkeySettings))) S.hotkeySettings = raw.hotkeySettings;
    if (typeof raw.currentModel === 'string') S.currentModel = raw.currentModel;
    if (raw.win && isNum(raw.win.x) && isNum(raw.win.y)) S.win = { x: Math.round(raw.win.x), y: Math.round(raw.win.y) };
  } catch (e) { S = { ...DEF }; }
}
// Đọc cấu hình TRƯỚC khi app sẵn sàng để áp dụng được tuỳ chọn tắt GPU (phải đặt trước app.ready)
loadConfig();
if (S.gpuOff) app.disableHardwareAcceleration();
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

/* ====================================================================
   Model: mỗi thư mục con của model/ là một model (bỏ qua thư mục bắt đầu bằng "_" hoặc ".")
     model.json     khung xương: crop, nodes, sprites, tune   (xem model/README.txt)
     settings.json  cài đặt riêng của model: name, hotkey, scale, tune  (tự tạo khi cần)
     assets/...     ảnh layer, emo, miệng mở...
   ==================================================================== */
const ID_RE = /^[A-Za-z0-9_\-]{1,40}$/;
const MASTERS = ['look', 'voice', 'breath', 'spring', 'range', 'follow', 'vfollow'];
const BAD_SEG = new Set(['__proto__', 'constructor', 'prototype']);
const safeRel = p => typeof p === 'string' && p.length > 0 && p.length < 260 && !/^([A-Za-z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes('..');

function validateModel(r, dir) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'model.json phải là một object { ... }';
  const c = r.crop;
  if (!c || ![c.x, c.y, c.w, c.h].every(isNum) || c.w <= 0 || c.h <= 0) return 'Thiếu hoặc sai "crop": cần {"x":..,"y":..,"w":..,"h":..} (w, h > 0)';
  const nodes = r.nodes === undefined ? [] : r.nodes;
  if (!Array.isArray(nodes)) return '"nodes" phải là một mảng';
  const ids = new Set();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || !ID_RE.test(n.id)) return 'Có khớp (node) với "id" sai — chỉ dùng chữ, số, _ và - : ' + JSON.stringify(n && n.id);
    if (ids.has(n.id)) return 'Trùng id khớp: "' + n.id + '"';
    if (n.parent != null && !ids.has(n.parent)) return 'Khớp "' + n.id + '": cha "' + n.parent + '" không tồn tại hoặc nằm phía sau (cha phải đứng trước con trong "nodes")';
    if (!Array.isArray(n.pivot) || n.pivot.length !== 2 || !n.pivot.every(isNum)) return 'Khớp "' + n.id + '": thiếu "pivot" dạng [x, y]';
    ids.add(n.id);
  }
  const sp = r.sprites;
  if (!Array.isArray(sp) || !sp.length) return 'Thiếu "sprites" (danh sách layer ảnh)';
  const sids = new Set();
  for (const s of sp) {
    if (!s || typeof s.id !== 'string' || !ID_RE.test(s.id)) return 'Có sprite với "id" sai — chỉ dùng chữ, số, _ và - : ' + JSON.stringify(s && s.id);
    if (sids.has(s.id)) return 'Trùng id sprite: "' + s.id + '"';
    sids.add(s.id);
    if (!safeRel(s.src)) return 'Sprite "' + s.id + '": đường dẫn "src" phải là đường dẫn tương đối trong thư mục model (không có ..)';
    if (![s.x, s.y, s.w, s.h].every(isNum) || s.w <= 0 || s.h <= 0) return 'Sprite "' + s.id + '": cần x, y, w, h là số (w, h > 0)';
    if (s.node != null && !ids.has(s.node)) return 'Sprite "' + s.id + '": khớp "' + s.node + '" không tồn tại';
    if (!fs.existsSync(path.join(dir, s.src))) return 'Không tìm thấy file ảnh của sprite "' + s.id + '": ' + s.src;
  }
  if (r.tune !== undefined) {
    if (!Array.isArray(r.tune)) return '"tune" phải là một mảng';
    const ks = new Set();
    for (const d of r.tune) {
      if (!d || typeof d.k !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(d.k)) return 'Thanh kéo có "k" sai: ' + JSON.stringify(d && d.k);
      if (ks.has(d.k)) return 'Trùng "k" của thanh kéo: ' + d.k;
      ks.add(d.k);
      if (typeof d.label !== 'string' || typeof d.group !== 'string') return 'Thanh kéo "' + d.k + '": cần "label" và "group" là chữ';
      if (![d.min, d.max, d.step].every(isNum) || d.step <= 0 || d.max <= d.min) return 'Thanh kéo "' + d.k + '": cần min < max và step > 0';
      if (d.g !== undefined) {
        if (!MASTERS.includes(d.g) || !isNum(d.def)) return 'Thanh kéo "' + d.k + '": "g" phải là một trong ' + MASTERS.join('/') + ' và có "def" là số';
      } else {
        if (!Array.isArray(d.set) || !d.set.length) return 'Thanh kéo "' + d.k + '": thiếu "set" (danh sách đường dẫn thông số)';
        for (const p of d.set) {
          const a = typeof p === 'string' ? p.split('.') : [];
          if (a.length < 2 || a.length > 4 || a.some(x => !/^[A-Za-z0-9_\-]+$/.test(x) || BAD_SEG.has(x)) || !ids.has(a[0]))
            return 'Thanh kéo "' + d.k + '": đường dẫn "' + p + '" không hợp lệ (dạng khớp.nhóm.thuộc_tính, khớp phải tồn tại)';
        }
      }
    }
  }
  return null;
}

let MODELS = [];
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const defCfg = () => ({ name: '', hotkey: '', scale: 100, tune: {} });
function sanitizeCfg(p, cur) {
  const n = { ...cur };
  if (typeof p.name === 'string') n.name = cleanName(p.name);
  if (typeof p.hotkey === 'string' && (p.hotkey === '' || validAccel(p.hotkey))) n.hotkey = p.hotkey;
  if (isNum(p.scale)) n.scale = clamp(Math.round(p.scale), 30, 130);
  if (p.tune !== undefined) n.tune = cleanTune(p.tune);
  return n;
}
function scanModels() {
  let names = [];
  try { names = fs.readdirSync(MODELS_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && !/^[_.]/.test(d.name)).map(d => d.name); } catch (e) {}
  names.sort((a, b) => a.localeCompare(b, 'vi'));
  MODELS = names.map(id => {
    const dir = path.join(MODELS_DIR, id), m = { id, dir, ok: false, error: '', rig: null, cfg: defCfg(), dirty: false };
    try { m.cfg = sanitizeCfg(readJSON(path.join(dir, 'settings.json')), m.cfg); } catch (e) { /* chưa có settings.json: dùng mặc định */ }
    try {
      const rig = readJSON(path.join(dir, 'model.json')), err = validateModel(rig, dir);
      if (err) m.error = err; else { m.rig = rig; m.ok = true; }
    } catch (e) { m.error = e.code === 'ENOENT' ? 'Thiếu file model.json' : 'model.json bị lỗi cú pháp: ' + e.message; }
    return m;
  });
}
const modelName = m => m.cfg.name || (m.rig && typeof m.rig.name === 'string' && m.rig.name.trim()) || m.id;
const modelInfo = m => ({ id: m.id, name: modelName(m), hotkey: m.cfg.hotkey, ok: m.ok, error: m.error });
function curModel() {
  let m = MODELS.find(x => x.id === S.currentModel && x.ok);
  if (!m) { m = MODELS.find(x => x.ok) || null; S.currentModel = m ? m.id : ''; }
  return m;
}
const modelPayload = m => ({ id: m.id, name: modelName(m), baseUrl: pathToFileURL(m.dir).href + '/', rig: m.rig, rev: Date.now() });

/* ---------- Lưu file (gom lại, không ghi liên tục khi kéo thanh) ---------- */
let saveTimer = null;
function writeJSON(f, o) { try { fs.writeFileSync(f, JSON.stringify(o, null, 1)); } catch (e) { console.log('Không ghi được', f, e.message); } }
function flushAll() {
  clearTimeout(saveTimer); saveTimer = null;
  writeJSON(CFG_FILE, S);
  for (const m of MODELS) if (m.dirty) { m.dirty = false; writeJSON(path.join(m.dir, 'settings.json'), m.cfg); }
}
function saveSoon(m) { if (m) m.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flushAll, 400); }

/* ---------- Cài đặt gửi cho cửa sổ model: chung + phần riêng của model đang dùng ---------- */
function view() {
  const m = curModel(), { win: _w, ...g } = S;
  return { ...g, scale: m ? m.cfg.scale : 100, tune: m ? m.cfg.tune : {} };
}

/* ====================================================================
   Cửa sổ model
   ==================================================================== */
let win = null, sw = null, appliedKey = null, appliedTop = null;
let micState = { on: false, error: '' };

function sizeFor(m) {
  const scale = m ? m.cfg.scale : 100, c = m ? m.rig.crop : { w: 380, h: 900 };
  const h = Math.round(900 * clamp(scale / 100, 0.3, 1.5));
  return { w: Math.max(120, Math.round(h * c.w / c.h)), h };
}
function applyWindow() {
  if (!win || win.isDestroyed()) return;
  const { w, h } = sizeFor(curModel()), key = w + 'x' + h;
  if (key !== appliedKey) {
    appliedKey = key;
    const b = win.getBounds();
    if (b.width !== w || b.height !== h) {
      // đổi cỡ: giữ nguyên tâm ngang và mép dưới (chân model đứng yên một chỗ)
      const wa = screen.getDisplayMatching(b).workArea;
      win.setBounds({ x: Math.round(b.x + b.width / 2 - w / 2), y: Math.max(wa.y, b.y + b.height - h), width: w, height: h });
    }
  }
  if (S.top !== appliedTop) { appliedTop = S.top; win.setAlwaysOnTop(!!S.top, 'screen-saver'); }
}
function sendModel() {
  if (!win || win.isDestroyed()) return;
  const m = curModel();
  win.webContents.send('load-model', m ? modelPayload(m) : null);
  applyWindow();
  win.webContents.send('settings', view());
}
function pushState() { if (sw && !sw.isDestroyed()) sw.webContents.send('state', fullState()); }

function create() {
  const m = curModel(), { w, h } = sizeFor(m);
  const opt = { width: w, height: h, useContentSize: true, transparent: true, frame: false, resizable: false,
    hasShadow: false, backgroundColor: '#00000000', title: 'Ezy Tuber', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false, spellcheck: false } };
  if (S.win) { // khôi phục vị trí lần trước nếu vẫn nằm trong một màn hình
    const px = S.win.x + w / 2, py = S.win.y + 40;
    if (screen.getAllDisplays().some(d => px >= d.bounds.x && px < d.bounds.x + d.bounds.width && py >= d.bounds.y && py < d.bounds.y + d.bounds.height)) { opt.x = S.win.x; opt.y = S.win.y; }
  }
  win = new BrowserWindow(opt);
  appliedKey = w + 'x' + h;
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => { appliedTop = null; applyWindow(); });
  let mt = null;
  win.on('move', () => { clearTimeout(mt); mt = setTimeout(() => { if (win && !win.isDestroyed()) { const b = win.getBounds(); S.win = { x: b.x, y: b.y }; saveSoon(); } }, 500); });
  // Theo dõi chuột trên TOÀN màn hình (kể cả khi đang chơi game).
  // 30 lần/giây và CHỈ gửi IPC khi chuột/cửa sổ thật sự thay đổi vị trí.
  let lastKey = '';
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds();
    const key = p.x + ',' + p.y + ',' + b.x + ',' + b.y + ',' + b.width + ',' + b.height;
    if (key === lastKey) return;
    lastKey = key;
    const d = screen.getDisplayMatching(b).bounds;
    win.webContents.send('cur', {
      x: (p.x - (b.x + b.width / 2)) / (d.width / 2.2),
      y: (p.y - (b.y + b.height * 0.25)) / (d.height / 2.2)
    });
  }, 33);
}

/* ====================================================================
   Cửa sổ Cài đặt
   ==================================================================== */
function fullState() {
  const m = curModel();
  return { settings: view(), mic: micState, models: MODELS.map(modelInfo), current: m ? m.id : '',
    model: m ? { id: m.id, name: modelName(m), rig: m.rig } : null,
    hotkeys: { settings: S.hotkeySettings, fallback: FALLBACK_HK, errors: hkErrors },
    modelsDir: MODELS_DIR, baseDir: BASE };
}
function openSettings() {
  if (sw && !sw.isDestroyed()) { sw.show(); sw.focus(); return; }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const W = 480, H = Math.min(800, d.height - 20);
  sw = new BrowserWindow({
    width: W, height: H, x: Math.round(d.x + (d.width - W) / 2), y: Math.round(d.y + (d.height - H) / 2),
    title: 'Ezy Tuber - Cài đặt', icon: path.join(__dirname, 'icon.png'),
    resizable: true, minWidth: 420, minHeight: 420, minimizable: false, maximizable: false, autoHideMenuBar: true, backgroundColor: '#24222b',
    webPreferences: { preload: path.join(__dirname, 'preload-settings.js'), contextIsolation: true, spellcheck: false }
  });
  sw.setMenuBarVisibility(false);
  sw.setAlwaysOnTop(true, 'screen-saver'); // nổi lên trên cả cửa sổ model / game
  sw.loadFile('settings.html');
  // Chỉ khi cửa sổ Settings đang mở, cửa sổ model mới gửi mức mic về (tiết kiệm IPC)
  if (win && !win.isDestroyed()) win.webContents.send('lvl-on', true);
  sw.on('closed', () => {
    sw = null; flushAll(); registerAll(); // đóng giữa lúc đang bắt phím -> đăng ký lại phím tắt
    if (win && !win.isDestroyed()) win.webContents.send('lvl-on', false);
  });
}
function toggleSettings() { if (sw && !sw.isDestroyed()) sw.close(); else openSettings(); }
app.on('second-instance', openSettings);

/* ====================================================================
   Phím tắt toàn cục: mở Cài đặt + chuyển sang từng model
   ==================================================================== */
let hkErrors = {};
function bindings() {
  const b = [];
  if (S.hotkeySettings) b.push({ accel: S.hotkeySettings, key: 'settings', label: 'Mở Cài đặt', run: toggleSettings });
  b.push({ accel: FALLBACK_HK, key: 'fallback', label: 'Mở Cài đặt (dự phòng)', run: toggleSettings });
  for (const m of MODELS) if (m.ok && m.cfg.hotkey) b.push({ accel: m.cfg.hotkey, key: 'model:' + m.id, label: 'Model "' + modelName(m) + '"', run: () => switchModel(m.id) });
  return b;
}
function registerAll() {
  globalShortcut.unregisterAll();
  const res = {}, seen = new Set();
  for (const b of bindings()) {
    const k = b.accel.toLowerCase();
    if (seen.has(k)) { if (b.key !== 'fallback') res[b.key] = 'Trùng phím với mục khác'; continue; }
    seen.add(k);
    let ok = false;
    try { ok = globalShortcut.register(b.accel, b.run); } catch (e) {}
    if (!ok && b.key !== 'fallback') res[b.key] = 'Không đăng ký được (phím đang bị chương trình khác giữ)';
  }
  hkErrors = res;
  return res;
}
// Đặt phím cho một mục; trả về {ok} hoặc {ok:false,error}
function setHotkey(key, accel) {
  if (accel !== '' && !validAccel(accel)) return { ok: false, error: 'Tổ hợp phím không hợp lệ' };
  if (accel) {
    const other = bindings().find(b => b.key !== key && b.accel.toLowerCase() === accel.toLowerCase());
    if (other) return { ok: false, error: 'Trùng với: ' + other.label };
  }
  let prev, apply;
  if (key === 'settings') { prev = S.hotkeySettings; apply = v => { S.hotkeySettings = v; saveSoon(); }; }
  else { const m = MODELS.find(x => 'model:' + x.id === key); if (!m) return { ok: false, error: 'Không tìm thấy model' }; prev = m.cfg.hotkey; apply = v => { m.cfg.hotkey = v; saveSoon(m); }; }
  apply(accel);
  const res = registerAll();
  if (accel && res[key]) { apply(prev); registerAll(); return { ok: false, error: res[key] }; }
  pushState();
  return { ok: true };
}

/* ====================================================================
   Đổi model
   ==================================================================== */
function switchModel(id) {
  const m = MODELS.find(x => x.id === id && x.ok);
  if (!m) return false;
  if (S.currentModel !== id) { S.currentModel = id; saveSoon(); }
  sendModel(); pushState();
  return true;
}
function rescan() {
  flushAll();
  const before = S.currentModel;
  scanModels(); curModel(); registerAll();
  sendModel(); pushState();
  return before;
}

/* ====================================================================
   IPC
   ==================================================================== */
function setupIpc() {
  ipcMain.handle('get-model', () => { const m = curModel(); return m ? modelPayload(m) : null; });
  ipcMain.handle('get-settings', () => view());
  ipcMain.handle('get-state', () => fullState());
  ipcMain.on('set-settings', (e, p) => {
    if (!p || typeof p !== 'object') return;
    S = sanitizeGlobal(p, S);
    const m = curModel();
    if (m && ('scale' in p || 'tune' in p)) { m.cfg = sanitizeCfg({ scale: p.scale, tune: p.tune }, m.cfg); saveSoon(m); }
    saveSoon(); applyWindow();
    if (win && !win.isDestroyed()) win.webContents.send('settings', view());
  });
  ipcMain.on('mic-status', (e, s) => {
    micState = { on: !!(s && s.on), error: (s && s.error) || '' };
    if (s && s.error && S.mic) { S.mic = false; saveSoon(); }
    if (sw && !sw.isDestroyed()) sw.webContents.send('mic-state', micState);
  });
  ipcMain.on('level', (e, v) => { if (sw && !sw.isDestroyed()) sw.webContents.send('level', v); });
  ipcMain.on('quit', () => { flushAll(); app.quit(); });

  ipcMain.on('switch-model', (e, id) => { if (typeof id === 'string') switchModel(id); });
  ipcMain.on('rescan-models', () => { rescan(); });
  ipcMain.on('open-models-folder', () => { shell.openPath(MODELS_DIR); });
  ipcMain.handle('model-rename', (e, id, name) => {
    const m = MODELS.find(x => x.id === id);
    if (!m || typeof name !== 'string') return { ok: false };
    m.cfg.name = cleanName(name); saveSoon(m); registerAll(); // nhãn trong thông báo lỗi phím dùng tên mới
    if (m.id === S.currentModel && win && !win.isDestroyed()) win.webContents.send('settings', view());
    pushState();
    return { ok: true };
  });
  ipcMain.handle('model-hotkey', (e, id, accel) => (typeof id === 'string' && typeof accel === 'string') ? setHotkey('model:' + id, accel) : { ok: false, error: 'Sai tham số' });
  ipcMain.handle('settings-hotkey', (e, accel) => typeof accel === 'string' ? setHotkey('settings', accel) : { ok: false, error: 'Sai tham số' });
  // Khi đang bắt phím: gỡ hết phím tắt toàn cục để tổ hợp phím đến được cửa sổ Cài đặt (nếu không, phím đang gán sẽ kích hoạt hành động thay vì được ghi nhận)
  ipcMain.on('hotkey-capture', (e, on) => { if (on) globalShortcut.unregisterAll(); else registerAll(); });
}

app.whenReady().then(() => {
  if (!gotLock) return; // bản chạy thứ hai: chỉ báo bản đầu mở Settings rồi thoát
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media');
  scanModels(); curModel();
  setupIpc();
  create();
  registerAll();
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); flushAll(); });
app.on('window-all-closed', () => app.quit());
