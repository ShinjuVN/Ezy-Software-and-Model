const { app, BrowserWindow, ipcMain, screen, session, globalShortcut, shell, dialog } = require('electron');
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

// Nếu chưa có thư mục "model" (vd. mới chép file exe sang chỗ khác): tự tạo kèm file README.txt hướng dẫn.
// Chạy lúc khởi động và mỗi lần quét lại/mở thư mục, nên lỡ xoá thư mục khi app đang chạy cũng tự tạo lại.
const README_SRC = path.join(__dirname, 'model-readme.txt');
function ensureModelDir() {
  try {
    if (fs.existsSync(MODELS_DIR)) return false;
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  } catch (e) { return false; }
  let txt = 'Mỗi thư mục con trong thư mục này là một model (cần có model.json và thư mục assets).\nThêm model: dùng nút "Import model" trong Cài đặt (Win + F12) -> tab Model, hoặc tự giải nén thư mục model vào đây rồi bấm "Quét lại".\n';
  try { txt = fs.readFileSync(README_SRC, 'utf8'); } catch (e) { /* dùng bản rút gọn ở trên */ }
  try { fs.writeFileSync(path.join(MODELS_DIR, 'README.txt'), txt); } catch (e) {}
  return true;
}
ensureModelDir();

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
  // biểu cảm & emote (model format 2)
  const chIds = new Map(), emoteIds = new Set();
  if (r.expressions !== undefined) {
    const ex = r.expressions;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return '"expressions" phải là object dạng { "eyes": {...}, "mouth": {...} }';
    const chs = Object.keys(ex);
    if (chs.length > 8) return 'Tối đa 8 nhóm biểu cảm';
    for (const ch of chs) {
      const d = ex[ch];
      if (!ID_RE.test(ch) || ch === 'emote') return 'Tên nhóm biểu cảm sai: "' + ch + '" (chỉ chữ/số/_/- và không được đặt là "emote")';
      if (!d || typeof d !== 'object' || !Array.isArray(d.states) || !d.states.length || d.states.length > 32) return 'Nhóm biểu cảm "' + ch + '": cần "states" là mảng 1–32 phần tử';
      if (d.name !== undefined && typeof d.name !== 'string') return 'Nhóm biểu cảm "' + ch + '": "name" phải là chữ';
      const sids = new Set();
      for (const s of d.states) {
        if (!s || typeof s.id !== 'string' || !ID_RE.test(s.id) || sids.has(s.id)) return 'Nhóm "' + ch + '": id trạng thái sai hoặc trùng: ' + JSON.stringify(s && s.id);
        if (s.name !== undefined && typeof s.name !== 'string') return 'Nhóm "' + ch + '", trạng thái "' + s.id + '": "name" phải là chữ';
        sids.add(s.id);
      }
      if (typeof d.default !== 'string' || !sids.has(d.default)) return 'Nhóm "' + ch + '": "default" phải là id của một trạng thái trong "states"';
      chIds.set(ch, sids);
    }
  }
  if (r.emotes !== undefined) {
    if (!Array.isArray(r.emotes) || r.emotes.length > 32) return '"emotes" phải là mảng tối đa 32 phần tử';
    for (const e of r.emotes) {
      if (!e || typeof e.id !== 'string' || !ID_RE.test(e.id) || emoteIds.has(e.id)) return 'Emote có id sai hoặc trùng: ' + JSON.stringify(e && e.id);
      if (e.name !== undefined && typeof e.name !== 'string') return 'Emote "' + e.id + '": "name" phải là chữ';
      if (e.duration !== undefined && (!isNum(e.duration) || e.duration < 0 || e.duration > 600)) return 'Emote "' + e.id + '": "duration" phải là số giây từ 0 đến 600 (0 = bật cho tới khi tắt)';
      if (e.group !== undefined && (typeof e.group !== 'string' || !ID_RE.test(e.group))) return 'Emote "' + e.id + '": "group" sai';
      emoteIds.add(e.id);
    }
  }
  for (const s of sp) {
    if (s.when === undefined) continue;
    const w = s.when;
    if (!w || typeof w !== 'object' || Array.isArray(w)) return 'Sprite "' + s.id + '": "when" phải là object, ví dụ {"eyes":["happy"]}';
    for (const [k, v] of Object.entries(w)) {
      const arr = Array.isArray(v) ? v : [v];
      if (!arr.length || arr.length > 32 || arr.some(x => typeof x !== 'string')) return 'Sprite "' + s.id + '": giá trị của when.' + k + ' phải là chữ hoặc mảng chữ';
      if (k === 'emote') { if (arr.some(x => !emoteIds.has(x))) return 'Sprite "' + s.id + '": when.emote nhắc tới emote chưa khai báo trong "emotes"'; }
      else {
        const set = chIds.get(k);
        if (!set) return 'Sprite "' + s.id + '": nhóm biểu cảm "' + k + '" chưa khai báo trong "expressions"';
        if (arr.some(x => !set.has(x))) return 'Sprite "' + s.id + '": when.' + k + ' nhắc tới trạng thái không tồn tại';
      }
    }
  }
  return null;
}

let MODELS = [];
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const defCfg = () => ({ name: '', hotkey: '', scale: 100, tune: {}, keys: {} });
// phím tắt biểu cảm/emote của model: { "expr:eyes:happy": "Control+Alt+1", "emote:heart": "...", "reset": "..." }
function cleanKeys(t) {
  const out = {};
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    let c = 0;
    for (const [k, v] of Object.entries(t)) { if (++c > 120) break; if (/^[A-Za-z0-9_:\-]{1,80}$/.test(k) && validAccel(v)) out[k] = v; }
  }
  return out;
}
function sanitizeCfg(p, cur) {
  const n = { ...cur };
  if (typeof p.name === 'string') n.name = cleanName(p.name);
  if (typeof p.hotkey === 'string' && (p.hotkey === '' || validAccel(p.hotkey))) n.hotkey = p.hotkey;
  if (isNum(p.scale)) n.scale = clamp(Math.round(p.scale), 30, 130);
  if (p.tune !== undefined) n.tune = cleanTune(p.tune);
  if (p.keys !== undefined) n.keys = cleanKeys(p.keys);
  return n;
}
function scanModels() {
  ensureModelDir();
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

/* ====================================================================
   Import model từ file .zip vào thư mục model/
   - Tự tìm thư mục chứa model.json trong zip (dù nằm sâu bao nhiêu lớp), chỉ lấy đúng thư mục đó, bỏ file thừa.
   - Một zip có nhiều model thì import hết. Kiểm tra hợp lệ trước khi đưa vào; trùng tên thì hỏi Giữ cả hai / Ghi đè / Bỏ qua.
   - Đọc zip bằng zlib có sẵn của Node (không cần thư viện ngoài), có chặn đường dẫn thoát thư mục và zip quá lớn.
   ==================================================================== */
const zlib = require('zlib');
const ZIP_MAX = { zip: 1024 * 1024 * 1024, file: 300 * 1024 * 1024, total: 1500 * 1024 * 1024, count: 20000 };
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;
function readZipDir(file) {
  const st = fs.statSync(file);
  if (st.size > ZIP_MAX.zip) throw new Error('file zip quá lớn');
  const buf = fs.readFileSync(file);
  let i = buf.length - 22; const lo = Math.max(0, buf.length - 22 - 65535);
  while (i >= lo && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < lo) throw new Error('không phải file zip hợp lệ');
  const total = buf.readUInt16LE(i + 10), cdOff = buf.readUInt32LE(i + 16);
  if (total === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('zip dạng Zip64 chưa được hỗ trợ');
  if (total > ZIP_MAX.count) throw new Error('zip có quá nhiều file');
  const entries = []; let p = cdOff;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip bị hỏng (mục lục lỗi)');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const nb = buf.subarray(p + 46, p + 46 + nlen), u8 = nb.toString('utf8');
    const name = (u8.includes('\uFFFD') ? nb.toString('latin1') : u8).replace(/\\/g, '/');
    entries.push({ name, dir: name.endsWith('/'), flags, method, csize, usize, lho });
    p += 46 + nlen + elen + clen;
  }
  return { buf, entries };
}
function zipData(z, e) {
  const { buf } = z, p = e.lho;
  if (e.flags & 1) throw new Error('zip có đặt mật khẩu');
  if (e.usize > ZIP_MAX.file) throw new Error('file "' + e.name + '" quá lớn');
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new Error('zip bị hỏng (mục "' + e.name + '")');
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28), raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: ZIP_MAX.file });
  throw new Error('kiểu nén của "' + e.name + '" chưa được hỗ trợ');
}
const safeFolderName = s => { let n = String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 60); if (/^[_.]/.test(n)) n = 'm' + n; return n || 'model'; };
const insideDir = (dir, target) => { const r = path.relative(dir, target); return r && !r.startsWith('..') && !path.isAbsolute(r); };
function uniqueModelName(name) { let n = name, i = 2; while (fs.existsSync(path.join(MODELS_DIR, n))) n = name + ' (' + i++ + ')'; return n; }
function msgBox(parent, opt) { return parent && !parent.isDestroyed() ? dialog.showMessageBox(parent, opt) : dialog.showMessageBox(opt); }

async function importOneZip(zipFile, parent, rep) {
  const base = path.basename(zipFile);
  let z; try { z = readZipDir(zipFile); } catch (e) { rep.errors.push(base + ': ' + e.message); return; }
  const files = z.entries.filter(e => !e.dir && !JUNK_RE.test(e.name));
  const mjs = files.filter(e => /(^|\/)model\.json$/i.test(e.name));
  if (!mjs.length) { rep.errors.push(base + ': không tìm thấy model.json — đây không phải file zip của một model.'); return; }
  let roots = [...new Set(mjs.map(e => e.name.slice(0, e.name.length - 'model.json'.length)))];
  roots = roots.filter(r => !roots.some(o => o !== r && r.startsWith(o))); // chỉ giữ thư mục ngoài cùng (model lồng trong model là không có)
  for (const root of roots) {
    const rawName = root ? root.replace(/\/$/, '').split('/').pop() : base.replace(/\.zip$/i, '');
    const name = safeFolderName(rawName), label = '"' + name + '"' + (roots.length > 1 ? ' (trong ' + base + ')' : '');
    const sel = files.filter(e => e.name.startsWith(root));
    const tmp = path.join(MODELS_DIR, '.import-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
    try {
      if (sel.length > ZIP_MAX.count) throw new Error('quá nhiều file');
      let sum = 0;
      for (const e of sel) {
        const rel = e.name.slice(root.length);
        if (!rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel) || /^[A-Za-z]:/.test(rel) || rel.includes('\u0000')) throw new Error('đường dẫn không an toàn trong zip: ' + e.name);
        sum += e.usize; if (sum > ZIP_MAX.total) throw new Error('dung lượng giải nén quá lớn');
        const dest = path.join(tmp, ...rel.split('/'));
        if (!insideDir(tmp, dest)) throw new Error('đường dẫn không an toàn trong zip: ' + e.name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, zipData(z, e));
      }
      let rig; try { rig = readJSON(path.join(tmp, 'model.json')); } catch (e) { throw new Error('model.json bị lỗi cú pháp: ' + e.message); }
      const err = validateModel(rig, tmp); if (err) throw new Error(err);
      // trùng tên với model đã có
      let target = path.join(MODELS_DIR, name), finalName = name;
      if (fs.existsSync(target)) {
        const r = await msgBox(parent, { type: 'question', title: 'Model đã tồn tại', message: 'Đã có model "' + name + '" trong thư mục model.', detail: 'Bạn muốn làm gì với bản mới?',
          buttons: ['Giữ cả hai (đổi tên bản mới)', 'Ghi đè (giữ phím tắt, cỡ, tinh chỉnh cũ)', 'Bỏ qua'], defaultId: 0, cancelId: 2, noLink: true });
        if (r.response === 2) { fs.rmSync(tmp, { recursive: true, force: true }); rep.skipped.push(label + ' (đã có sẵn)'); continue; }
        if (r.response === 1) {
          try { fs.copyFileSync(path.join(target, 'settings.json'), path.join(tmp, 'settings.json')); } catch (e) { /* bản cũ chưa có settings.json */ }
          fs.rmSync(target, { recursive: true, force: true });
        } else { finalName = uniqueModelName(name); target = path.join(MODELS_DIR, finalName); }
      }
      fs.renameSync(tmp, target);
      rep.imported.push({ id: finalName, name: (rig.name && String(rig.name).trim()) || finalName });
    } catch (e) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e2) {}
      rep.errors.push('Model ' + label + ': ' + e.message);
    }
  }
}
let importing = false;
async function importModels(paths) {
  const rep = { imported: [], errors: [], skipped: [], canceled: false };
  if (importing) { rep.errors.push('Đang import, vui lòng đợi xong.'); return rep; }
  importing = true;
  try {
    ensureModelDir();
    const parent = sw && !sw.isDestroyed() ? sw : win;
    if (!Array.isArray(paths) || !paths.length) {
      const r = await (parent ? dialog.showOpenDialog(parent, { title: 'Chọn file zip của model', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Model (.zip)', extensions: ['zip'] }] })
        : dialog.showOpenDialog({ title: 'Chọn file zip của model', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Model (.zip)', extensions: ['zip'] }] }));
      if (r.canceled || !r.filePaths.length) { rep.canceled = true; return rep; }
      paths = r.filePaths;
    }
    for (const p of paths.filter(x => typeof x === 'string').slice(0, 20)) {
      if (!/\.zip$/i.test(p)) { rep.errors.push(path.basename(p) + ': không phải file .zip'); continue; }
      await importOneZip(p, parent, rep);
    }
    if (rep.imported.length) rescan();
  } catch (e) { rep.errors.push(e.message); }
  finally { importing = false; }
  return rep;
}

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
  win.webContents.send('face-state', faceView());
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
    face: faceView(), keys: m ? m.cfg.keys : {}, modelsDir: MODELS_DIR, baseDir: BASE };
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
   Biểu cảm khuôn mặt (mắt, miệng...) và emote — trạng thái nằm ở đây vì phím tắt toàn cục ở đây
   - Mỗi nhóm biểu cảm có đúng 1 trạng thái đang chọn. Bấm phím của trạng thái đang bật = quay về mặc định.
   - Emote bật/tắt độc lập; có thể tự tắt sau "duration" giây; cùng "group" thì chỉ bật một cái.
   ==================================================================== */
let face = { sel: {}, emotes: new Set() };
const emoteTimers = new Map();
function actionsOf(m) {
  if (!m || !m.ok) return [];
  const out = [], ex = m.rig.expressions || {};
  for (const [ch, d] of Object.entries(ex)) for (const s of d.states) out.push({ key: 'expr:' + ch + ':' + s.id, type: 'expr', ch, id: s.id, label: (d.name || ch) + ': ' + (s.name || s.id) });
  for (const e of m.rig.emotes || []) out.push({ key: 'emote:' + e.id, type: 'emote', id: e.id, label: 'Emote: ' + (e.name || e.id) });
  if (out.length) out.push({ key: 'reset', type: 'reset', label: 'Đặt lại biểu cảm và tắt hết emote' });
  return out;
}
const faceView = () => ({ sel: { ...face.sel }, emotes: [...face.emotes] });
function sendFace() {
  if (win && !win.isDestroyed()) win.webContents.send('face-state', faceView());
  pushState();
}
function faceReset(send) {
  for (const t of emoteTimers.values()) clearTimeout(t);
  emoteTimers.clear();
  face = { sel: {}, emotes: new Set() };
  const m = curModel(), ex = m && m.rig.expressions;
  if (ex) for (const [ch, d] of Object.entries(ex)) face.sel[ch] = d.default;
  if (send) sendFace();
}
function setExpr(ch, id, toggle) {
  const m = curModel(), d = m && m.rig.expressions && m.rig.expressions[ch];
  if (!d || !d.states.some(s => s.id === id)) return;
  face.sel[ch] = (toggle && face.sel[ch] === id) ? d.default : id;
  sendFace();
}
function emoteOff(id) { face.emotes.delete(id); clearTimeout(emoteTimers.get(id)); emoteTimers.delete(id); }
function toggleEmote(id) {
  const m = curModel(), list = (m && m.rig.emotes) || [], e = list.find(x => x.id === id);
  if (!e) return;
  if (face.emotes.has(id)) emoteOff(id);
  else {
    if (e.group) for (const o of list) if (o.id !== id && o.group === e.group && face.emotes.has(o.id)) emoteOff(o.id);
    face.emotes.add(id);
    if (e.duration > 0) emoteTimers.set(id, setTimeout(() => { emoteOff(id); sendFace(); }, e.duration * 1000));
  }
  sendFace();
}
function runAction(a) {
  if (a.type === 'expr') setExpr(a.ch, a.id, true); // phím tắt: bấm lại để về mặc định
  else if (a.type === 'emote') toggleEmote(a.id);
  else if (a.type === 'reset') faceReset(true);
}

/* ====================================================================
   Phím tắt toàn cục: mở Cài đặt + chuyển sang từng model
   ==================================================================== */
let hkErrors = {};
function bindings() {
  const b = [];
  if (S.hotkeySettings) b.push({ accel: S.hotkeySettings, key: 'settings', label: 'Mở Cài đặt', run: toggleSettings });
  b.push({ accel: FALLBACK_HK, key: 'fallback', label: 'Mở Cài đặt (dự phòng)', run: toggleSettings });
  for (const m of MODELS) if (m.ok && m.cfg.hotkey) b.push({ accel: m.cfg.hotkey, key: 'model:' + m.id, label: 'Model "' + modelName(m) + '"', run: () => switchModel(m.id) });
  const cm = curModel();
  if (cm) for (const a of actionsOf(cm)) { const acc = cm.cfg.keys[a.key]; if (acc) b.push({ accel: acc, key: 'act:' + a.key, label: a.label, run: () => runAction(a) }); }
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
  else if (key.startsWith('act:')) {
    const m = curModel(), ak = key.slice(4);
    if (!m || !actionsOf(m).some(a => a.key === ak)) return { ok: false, error: 'Không tìm thấy thao tác' };
    prev = m.cfg.keys[ak] || '';
    apply = v => { if (v) m.cfg.keys[ak] = v; else delete m.cfg.keys[ak]; saveSoon(m); };
  }
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
  if (S.currentModel === id) return true; // đang dùng model này rồi: giữ nguyên biểu cảm hiện tại
  S.currentModel = id; saveSoon();
  faceReset(); registerAll(); // phím biểu cảm/emote là của từng model
  sendModel(); pushState();
  return true;
}
function rescan() {
  flushAll();
  const before = S.currentModel;
  scanModels(); curModel(); faceReset(); registerAll();
  sendModel(); pushState();
  return before;
}

/* ====================================================================
   IPC
   ==================================================================== */
function setupIpc() {
  ipcMain.handle('get-model', () => { const m = curModel(); return m ? modelPayload(m) : null; });
  ipcMain.handle('get-settings', () => view());
  ipcMain.handle('get-face', () => faceView());
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
  ipcMain.on('open-models-folder', () => { ensureModelDir(); shell.openPath(MODELS_DIR); });
  ipcMain.handle('import-model', (e, paths) => importModels(paths));
  ipcMain.handle('model-rename', (e, id, name) => {
    const m = MODELS.find(x => x.id === id);
    if (!m || typeof name !== 'string') return { ok: false };
    m.cfg.name = cleanName(name); saveSoon(m); registerAll(); // nhãn trong thông báo lỗi phím dùng tên mới
    if (m.id === S.currentModel && win && !win.isDestroyed()) win.webContents.send('settings', view());
    pushState();
    return { ok: true };
  });
  ipcMain.handle('model-hotkey', (e, id, accel) => (typeof id === 'string' && typeof accel === 'string') ? setHotkey('model:' + id, accel) : { ok: false, error: 'Sai tham số' });
  ipcMain.on('face-set', (e, a) => {
    if (!a || typeof a !== 'object') return;
    if (a.type === 'expr' && typeof a.ch === 'string' && typeof a.id === 'string') setExpr(a.ch, a.id, false);
    else if (a.type === 'emote' && typeof a.id === 'string') toggleEmote(a.id);
    else if (a.type === 'reset') faceReset(true);
  });
  ipcMain.handle('action-hotkey', (e, k, accel) => (typeof k === 'string' && typeof accel === 'string') ? setHotkey('act:' + k, accel) : { ok: false, error: 'Sai tham số' });
  ipcMain.handle('settings-hotkey', (e, accel) => typeof accel === 'string' ? setHotkey('settings', accel) : { ok: false, error: 'Sai tham số' });
  // Khi đang bắt phím: gỡ hết phím tắt toàn cục để tổ hợp phím đến được cửa sổ Cài đặt (nếu không, phím đang gán sẽ kích hoạt hành động thay vì được ghi nhận)
  ipcMain.on('hotkey-capture', (e, on) => { if (on) globalShortcut.unregisterAll(); else registerAll(); });
}

app.whenReady().then(() => {
  if (!gotLock) return; // bản chạy thứ hai: chỉ báo bản đầu mở Settings rồi thoát
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media');
  scanModels(); curModel(); faceReset();
  setupIpc();
  create();
  registerAll();
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); flushAll(); });
app.on('window-all-closed', () => app.quit());
