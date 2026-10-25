/* ====================================================================
   Ezy Maker — lõi: trạng thái dự án, hoàn tác, nhập / xuất
   Ảnh layer lưu riêng trong App.imgs (key -> {cv, alpha}); state chỉ chứa dữ liệu nhẹ nên chụp snapshot rất rẻ.
   ==================================================================== */
const RT = RigTools;
const App = {
  state: null, imgs: new Map(), sel: { layers: new Set(), node: null },
  hist: [], hi: -1, mode: 'edit', keyN: 0, busy: false,
  newState() {
    return { name: 'Model mới', canvas: { w: 1024, h: 1024 }, layers: [], nodes: [], expressions: {}, emotes: [], tune: null, crop: null, cropAuto: true,
      margin: { top: 28, side: 20 }, autoTune: true, fmt: 'png' };
  },
  layer: key => App.state.layers.find(l => l.key === key),
  node: id => App.state.nodes.find(n => n.id === id),
  selLayers() { return App.state.layers.filter(l => App.sel.layers.has(l.key)); },
  status(msg, kind) { const el = document.getElementById('status'); if (!el) return; el.textContent = msg; el.className = kind || ''; },
  refresh() { if (typeof Panels !== 'undefined') Panels.render(); if (typeof Editor !== 'undefined') Editor.draw(); },

  /* ---------- Hoàn tác ---------- */
  snap() { return JSON.stringify(App.state); },
  commit() {
    const s = App.snap(); if (App.hist[App.hi] === s) return;
    App.hist = App.hist.slice(0, App.hi + 1); App.hist.push(s); if (App.hist.length > 120) App.hist.shift(); App.hi = App.hist.length - 1;
    App.refresh();
  },
  restore(i) {
    App.hi = i; App.state = JSON.parse(App.hist[i]);
    const keys = new Set(App.state.layers.map(l => l.key));
    App.sel.layers = new Set([...App.sel.layers].filter(k => keys.has(k)));
    if (App.sel.node && !App.node(App.sel.node)) App.sel.node = null;
    App.refresh();
  },
  undo() { if (App.hi > 0) App.restore(App.hi - 1); },
  redo() { if (App.hi < App.hist.length - 1) App.restore(App.hi + 1); },
  reset(state) { App.state = state || App.newState(); App.imgs = App.state.layers.length ? App.imgs : new Map(); App.sel = { layers: new Set(), node: null }; App.hist = []; App.hi = -1; App.commit(); },

  /* ---------- Xử lý ảnh ---------- */
  async blobToCanvas(blob) {
    const bmp = await createImageBitmap(blob), c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close(); return c;
  },
  // cắt gọn theo vùng có pixel (alpha>0); trả về null nếu layer trống
  cropAlpha(c) {
    const W = c.width, H = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) { const row = y * W * 4; for (let x = 0; x < W; x++) if (d[row + x * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(c, x0, y0, w, h, 0, 0, w, h);
    const data = cx.getImageData(0, 0, w, h).data, alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return { cv, alpha, x: x0, y: y0, w, h };
  },
  usedIds() { return new Set(App.state.layers.map(l => l.id)); },
  addLayer(cr, o) { // cr = kết quả cropAlpha
    const key = 'k' + (++App.keyN), id = RT.uniqueId(RT.sanitizeId(o.name), App.usedIds());
    App.imgs.set(key, { cv: cr.cv, alpha: cr.alpha });
    const l = { key, id, srcName: o.name, x: o.x, y: o.y, w: cr.w, h: cr.h, node: null, visible: o.visible !== false };
    App.state.layers.push(l); return l;
  },
  fitCanvasToLayers() {
    const c = App.state.canvas;
    for (const l of App.state.layers) { c.w = Math.max(c.w, l.x + l.w); c.h = Math.max(c.h, l.y + l.h); }
  },

  /* ---------- Nhập ---------- */
  async expand(files) {
    const flat = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.path)) {
        const z = await JSZip.loadAsync(f.blob);
        for (const [p, e] of Object.entries(z.files)) { if (e.dir || /(^|\/)(__MACOSX|\.)/.test(p)) continue; flat.push({ path: p, blob: await e.async('blob'), zip: f.path.split('/').pop() }); }
      } else flat.push(f);
    }
    return flat;
  },
  async importFiles(files) {
    if (App.busy) return; App.busy = true;
    try {
      const flat = await App.expand(files);
      const mjs = flat.filter(f => /(^|\/)model\.json$/i.test(f.path));
      if (mjs.length === 1) await App.openModelFiles(flat, mjs[0]);
      else if (mjs.length > 1) await App.chooseModel(flat, mjs);
      else await App.importLayers(flat);
    } catch (e) { console.error(e); App.status('Lỗi khi nhập: ' + e.message, 'err'); }
    App.busy = false;
  },
  async importLayers(flat) {
    const base = p => p.split('/').pop(), isImg = p => /\.(png|webp)$/i.test(p);
    let imgs = flat.filter(f => isImg(f.path)), lj = null;
    const ljf = flat.find(f => /(^|\/)layers\.json$/i.test(f.path));
    if (ljf) { try { lj = JSON.parse((await ljf.blob.text()).replace(/^\uFEFF/, '')); } catch (e) { App.status('layers.json bị lỗi cú pháp — bỏ qua, dùng thứ tự theo tên file', 'warn'); } }
    if (!imgs.length) { App.status('Không thấy file ảnh .png/.webp nào để nhập.', 'warn'); return; }
    let entries; // [{f, name, left, top, width, height, visible}]
    if (lj && Array.isArray(lj.layers)) {
      entries = [];
      for (const e of lj.layers) { const f = imgs.find(x => x.path === e.file || base(x.path) === base(String(e.file || ''))); if (f) entries.push({ f, name: e.name || base(f.path), left: e.left, top: e.top, width: e.width, height: e.height, visible: e.visible }); }
      for (const f of imgs) if (!entries.some(e => e.f === f)) entries.push({ f, name: base(f.path) }); // file không có trong layers.json: thêm lên trên cùng
    } else entries = imgs.sort((a, b) => RT.natural(a.path, b.path)).map(f => ({ f, name: base(f.path) }));
    const st = App.state, first = !st.layers.length;
    if (first && lj && lj.width > 0 && lj.height > 0) st.canvas = { w: lj.width, h: lj.height };
    let skipped = 0, warnPos = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]; App.status('Đang nhập layer ' + (i + 1) + '/' + entries.length + '…');
      const full = await App.blobToCanvas(e.f.blob);
      if (first && i === 0 && !(lj && lj.width > 0)) st.canvas = { w: full.width, h: full.height };
      const cr = App.cropAlpha(full); if (!cr) { skipped++; continue; }
      let ox = 0, oy = 0;
      const isFull = full.width === st.canvas.w && full.height === st.canvas.h;
      if (!isFull) { // ảnh đã bị cắt: cần toạ độ từ layers.json
        if (isFinite(e.left) && isFinite(e.top) && full.width === e.width && full.height === e.height) { ox = e.left; oy = e.top; } else warnPos++;
      }
      App.addLayer(cr, { name: e.name, x: ox + cr.x, y: oy + cr.y, visible: e.visible });
    }
    App.fitCanvasToLayers();
    if (first && st.name === 'Model mới') { const z = flat.find(f => f.zip), folder = (flat.find(f => f.path.includes('/')) || { path: '' }).path.split('/')[0], g = folder || (z ? z.zip.replace(/\.zip$/i, '') : ''); if (g) st.name = g.slice(0, 60); }
    App.commit();
    if (typeof Editor !== 'undefined') Editor.fit();
    let msg = 'Đã nhập ' + (entries.length - skipped) + ' layer.' + (skipped ? ' (' + skipped + ' layer trống bị bỏ qua)' : '');
    if (warnPos) msg += ' ⚠ ' + warnPos + ' ảnh có kích thước khác canvas và không có vị trí — được đặt ở góc trên trái. Hãy xuất layer KHÔNG cắt (cùng kích thước canvas) hoặc kèm layers.json.';
    App.status(msg + (first ? ' Bấm 🧩 "Tạo khung xương tự động" để bắt đầu.' : ''), warnPos ? 'warn' : 'ok');
  },
  chooseModel(flat, mjs) {
    const body = el('div', {}, el('p', { class: 'dim', text: 'Tìm thấy ' + mjs.length + ' model. Chọn model cần mở để chỉnh sửa:' }),
      ...mjs.map(m => { const dir = m.path.includes('/') ? m.path.slice(0, m.path.lastIndexOf('/')) : '(gốc)'; return el('div', { class: 'btns', style: 'margin:6px 0' }, el('button', { class: 'pri', text: '📂 ' + dir, onclick: () => { $('#modal').remove(); App.busy = true; App.openModelFiles(flat, m).finally(() => App.busy = false); } })); }));
    Panels.modal('Chọn model để mở', body);
  },
  async openModelFiles(flat, mj) {
    if (App.state.layers.length && !confirm('Mở model sẽ thay thế dự án hiện tại (chưa xuất sẽ mất). Tiếp tục?')) return;
    const norm = p => p.replace(/\\/g, '/').toLowerCase(), dir = mj.path.includes('/') ? mj.path.slice(0, mj.path.lastIndexOf('/') + 1) : '';
    const inDir = flat.filter(f => norm(f.path).startsWith(norm(dir))), byPath = new Map(inDir.map(f => [norm(f.path), f]));
    let rig; try { rig = JSON.parse((await mj.blob.text()).replace(/^\uFEFF/, '')); } catch (e) { App.status('model.json bị lỗi cú pháp: ' + e.message, 'err'); return; }
    if (!rig || !Array.isArray(rig.sprites)) { App.status('model.json không hợp lệ: thiếu "sprites".', 'err'); return; }
    const st = App.newState(); App.imgs = new Map();
    // settings.json của model (phím chuyển, cỡ, giá trị thanh kéo, tên) được giữ nguyên khi xuất lại
    const sf = byPath.get(norm(dir + 'settings.json')); let cfg = null;
    if (sf) { try { cfg = JSON.parse((await sf.blob.text()).replace(/^\uFEFF/, '')); } catch (e) { /* bỏ qua */ } }
    st.settings = cfg && typeof cfg === 'object' ? { hotkey: typeof cfg.hotkey === 'string' ? cfg.hotkey : '', scale: Number.isFinite(cfg.scale) ? cfg.scale : 100, tune: cfg.tune && typeof cfg.tune === 'object' ? cfg.tune : {}, keys: cfg.keys && typeof cfg.keys === 'object' ? cfg.keys : {} } : null;
    st.name = (cfg && typeof cfg.name === 'string' && cfg.name.trim()) || rig.name || (dir ? dir.split('/')[0] : 'Model');
    st.crop = rig.crop && Number.isFinite(rig.crop.w) ? rig.crop : null; st.cropAuto = !st.crop;
    st.tune = Array.isArray(rig.tune) ? rig.tune : null; st.autoTune = !st.tune; // model có sẵn danh sách thanh kéo -> giữ nguyên
    st.expressions = rig.expressions && typeof rig.expressions === 'object' ? JSON.parse(JSON.stringify(rig.expressions)) : {};
    st.emotes = Array.isArray(rig.emotes) ? JSON.parse(JSON.stringify(rig.emotes)) : [];
    st.nodes = (rig.nodes || []).map(n => { const o = { id: n.id, parent: n.parent || null, pivot: n.pivot.slice() }; for (const f of ['rest', 'look', 'voice', 'breath', 'spring', 'springY']) if (n[f]) o[f] = JSON.parse(JSON.stringify(n[f])); return o; });
    let miss = 0;
    for (let i = 0; i < rig.sprites.length; i++) {
      const s = rig.sprites[i]; App.status('Đang mở model: layer ' + (i + 1) + '/' + rig.sprites.length + '…');
      const f = byPath.get(norm(dir + String(s.src).replace(/\\/g, '/'))); if (!f) { miss++; continue; }
      const cv = await App.blobToCanvas(f.blob), cr = App.cropAlpha(cv); if (!cr) { miss++; continue; }
      const key = 'k' + (++App.keyN); App.imgs.set(key, { cv: cr.cv, alpha: cr.alpha });
      st.layers.push({ key, id: s.id, srcName: s.id, x: s.x + cr.x, y: s.y + cr.y, w: cr.w, h: cr.h, node: s.node || null, visible: true,
        ...(s.show ? { show: s.show } : {}), ...(s.blink ? { blink: s.blink } : {}), ...(s.vs ? { vs: s.vs } : {}), ...(s.when ? { when: JSON.parse(JSON.stringify(s.when)) } : {}) });
    }
    if (!st.layers.length) { App.status('Không tìm thấy ảnh nào của model (kiểm tra thư mục assets).', 'err'); return; }
    // layer trỏ tới khớp không tồn tại -> bỏ liên kết
    const ids = new Set(st.nodes.map(n => n.id)); for (const l of st.layers) if (l.node && !ids.has(l.node)) l.node = null;
    App.state = st; App.fitCanvasToLayers();
    App.sel = { layers: new Set(), node: null }; App.hist = []; App.hi = -1; App.commit();
    if (typeof Editor !== 'undefined') Editor.fit();
    App.status('✔ Đã mở model "' + st.name + '": ' + st.layers.length + ' layer, ' + st.nodes.length + ' khớp' + (st.tune ? ', ' + st.tune.length + ' thanh kéo (được giữ nguyên)' : '') + '.' + (miss ? ' ⚠ ' + miss + ' layer thiếu ảnh nên bị bỏ qua.' : '') + ' Chỉnh sửa xong bấm 📦 Xuất zip.', miss ? 'warn' : 'ok');
  },

  /* ---------- Tự rig & kiểm tra ---------- */
  autoRig() {
    if (!App.state.layers.length) { App.status('Hãy nhập layer trước.', 'warn'); return; }
    if (App.state.nodes.length && !confirm('Tạo lại khung xương sẽ xoá khớp và thiết lập chuyển động hiện có. Tiếp tục?')) return;
    const { report } = RT.autoRig(App.state, App.imgs);
    App.state.cropAuto = true; App.commit();
    if (typeof Panels !== 'undefined') Panels.showReport('Kết quả tự rig', report);
    App.status('Đã tạo khung xương tự động. Bấm ▶ Xem thử để kiểm tra.', 'ok');
  },
  findCovered() {
    const st = App.state, cov = RT.coverage(st.layers, App.imgs, st.canvas.w, st.canvas.h);
    const hit = st.layers.filter(l => l.visible && cov[l.key] === 0);
    App.sel.layers = new Set(hit.map(l => l.key)); App.sel.node = null; App.refresh();
    App.status(hit.length ? 'Đã chọn ' + hit.length + ' layer bị che hoàn toàn: ' + hit.map(l => l.id).join(', ') + '. Bấm "Ẩn" hoặc Delete nếu không cần.' : 'Không có layer nào bị che hoàn toàn.', hit.length ? 'warn' : 'ok');
  },

  /* ---------- Xuất ---------- */
  canvasBlob(cv, fmt) { return new Promise(r => cv.toBlob(r, fmt === 'webp' ? 'image/webp' : 'image/png', 0.95)); },
  async buildZip() {
    const st = App.state, ext = st.fmt === 'webp' ? 'webp' : 'png';
    const model = RT.buildModel(st, { autoTune: st.autoTune, ext });
    const err = RT.validateModel(model, () => true); if (err) throw new Error(err);
    const folder = RT.safeFolderName(st.name), zip = new JSZip(), root = zip.folder(folder);
    root.file('model.json', JSON.stringify(model, null, 1));
    const cfg = st.settings || {}; root.file('settings.json', JSON.stringify({ name: st.name, hotkey: cfg.hotkey || '', scale: cfg.scale || 100, tune: cfg.tune || {}, keys: cfg.keys || {} }, null, 1));
    const vis = st.layers.filter(l => l.visible);
    for (let i = 0; i < vis.length; i++) {
      App.status('Đang nén layer ' + (i + 1) + '/' + vis.length + '…');
      root.file(model.sprites[i].src, await App.canvasBlob(App.imgs.get(vis[i].key).cv, ext));
    }
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { bytes, folder, model };
  },
  async exportZip() {
    if (App.busy) return;
    if (!App.state.layers.some(l => l.visible)) { App.status('Chưa có layer nào để xuất.', 'warn'); return; }
    App.busy = true;
    try {
      const { bytes, folder, model } = await App.buildZip();
      const r = await api.saveFile(folder + '.zip', bytes, 'Zip', 'zip');
      if (r.ok) { App.status('✔ Đã xuất ' + r.path + ' — giải nén thư mục "' + folder + '" vào thư mục model của Ezy Tuber. (' + model.sprites.length + ' layer, ' + model.nodes.length + ' khớp, ' + model.tune.length + ' thanh kéo' + (model.expressions ? ', ' + Object.keys(model.expressions).length + ' nhóm biểu cảm' : '') + (model.emotes ? ', ' + model.emotes.length + ' emote' : '') + ')', 'ok'); App.lastExport = r.path; }
      else if (r.error) App.status('Không lưu được file: ' + r.error, 'err'); else App.status('Đã huỷ xuất.', '');
    } catch (e) { console.error(e); App.status('Không xuất được: ' + e.message, 'err'); }
    App.busy = false;
  }
};

/* ---------- Đọc dữ liệu kéo-thả (file + thư mục) ---------- */
async function readEntry(entry, path) {
  if (entry.isFile) return new Promise(res => entry.file(f => res([{ path: path + entry.name, blob: f }]), () => res([])));
  if (entry.isDirectory) {
    const rd = entry.createReader(); let all = [];
    for (;;) { const es = await new Promise(r => rd.readEntries(r, () => r([]))); if (!es.length) break; all = all.concat(es); }
    const out = []; for (const e of all) out.push(...await readEntry(e, path + entry.name + '/')); return out;
  }
  return [];
}
async function filesFromDrop(dt) {
  const out = [], items = [...(dt.items || [])].filter(i => i.kind === 'file');
  if (items.length && items[0].webkitGetAsEntry) { const ents = items.map(i => i.webkitGetAsEntry()).filter(Boolean); for (const e of ents) out.push(...await readEntry(e, '')); }
  if (!out.length) for (const f of dt.files) out.push({ path: f.name, blob: f }); // phương án dự phòng khi trình duyệt không trả về entry
  return out;
}
function filesFromInput(inp) { return [...inp.files].map(f => ({ path: f.webkitRelativePath || f.name, blob: f })); }
