/* ====================================================================
   Panels — giao diện: danh sách layer / cây khớp / thuộc tính / xem thử / hộp thoại
   ==================================================================== */
const $ = s => document.querySelector(s);
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const EMPTY = Object.freeze({});
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, path, v) {
  const a = path.split('.'); let t = o;
  for (let i = 0; i < a.length - 1; i++) { if (typeof t[a[i]] !== 'object' || !t[a[i]]) t[a[i]] = {}; t = t[a[i]]; }
  if (v === undefined) delete t[a[a.length - 1]]; else t[a[a.length - 1]] = v;
  // dọn object rỗng
  for (let n = a.length - 1; n > 0; n--) { const parent = a.slice(0, n - 1).reduce((x, k) => x[k], o), key = a[n - 1]; if (parent[key] && !Object.keys(parent[key]).length) delete parent[key]; }
}

/* ---------- Biểu cảm & Emote: thao tác dữ liệu (đều đi qua App.commit nên hoàn tác được) ---------- */
const Face = {
  ex: () => (App.state.expressions = App.state.expressions || {}),
  em: () => (App.state.emotes = App.state.emotes || []),
  slug(name, used) { return RT.uniqueId((RT.sanitizeId(name).toLowerCase() || 'item'), used); },
  addChannel(name, id) {
    const ex = this.ex(), used = new Set([...Object.keys(ex), 'emote']); if (Object.keys(ex).length >= 8) { App.status('Tối đa 8 nhóm biểu cảm.', 'warn'); return; }
    const cid = id && !used.has(id) ? id : this.slug(name, used);
    ex[cid] = { name, default: 'normal', states: [{ id: 'normal', name: 'Bình thường' }] }; App.commit();
  },
  deleteChannel(ch) { delete this.ex()[ch]; for (const l of App.state.layers) if (l.when) { delete l.when[ch]; if (!Object.keys(l.when).length) delete l.when; } App.commit(); },
  addState(ch, name) {
    const d = this.ex()[ch]; if (d.states.length >= 32) { App.status('Tối đa 32 trạng thái mỗi nhóm.', 'warn'); return; }
    d.states.push({ id: this.slug(name, new Set(d.states.map(s => s.id))), name }); App.commit();
  },
  deleteState(ch, id) {
    const d = this.ex()[ch]; if (d.states.length <= 1) { App.status('Mỗi nhóm cần ít nhất một trạng thái.', 'warn'); return; }
    d.states = d.states.filter(s => s.id !== id); if (d.default === id) d.default = d.states[0].id;
    let n = 0; for (const l of App.state.layers) if (l.when && l.when[ch]) { l.when[ch] = [].concat(l.when[ch]).filter(x => x !== id); if (!l.when[ch].length) { delete l.when[ch]; n++; } if (!Object.keys(l.when).length) delete l.when; }
    App.commit(); if (n) App.status(n + ' layer chỉ gắn với trạng thái đã xoá nên giờ hiện ở mọi trạng thái — hãy kiểm tra lại.', 'warn');
  },
  addEmote(name) {
    const em = this.em(); if (em.length >= 32) { App.status('Tối đa 32 emote.', 'warn'); return; }
    em.push({ id: this.slug(name, new Set(em.map(e => e.id))), name, duration: 0 }); App.commit();
  },
  deleteEmote(id) {
    App.state.emotes = this.em().filter(e => e.id !== id);
    for (const l of App.state.layers) if (l.when && l.when.emote) { l.when.emote = [].concat(l.when.emote).filter(x => x !== id); if (!l.when.emote.length) delete l.when.emote; if (!Object.keys(l.when).length) delete l.when; }
    App.commit();
  },
  // gán layer đang chọn vào đúng một trạng thái của nhóm / một emote
  assign(ch, id) {
    const ls = App.selLayers(); if (!ls.length) { App.status('Hãy chọn layer trước (bấm trên canvas hoặc trong danh sách).', 'warn'); return; }
    for (const l of ls) { l.when = l.when || {}; l.when[ch] = [id]; } App.commit();
    App.status('Đã gán ' + ls.length + ' layer vào ' + (ch === 'emote' ? 'emote' : 'trạng thái') + ' "' + id + '".', 'ok');
  },
  select(ch, id) {
    const keys = App.state.layers.filter(l => l.when && [].concat(l.when[ch] || []).includes(id)).map(l => l.key);
    App.sel.layers = new Set(keys); App.sel.node = null; Panels.rtab = 'layer'; App.refresh();
    App.status(keys.length ? 'Đã chọn ' + keys.length + ' layer của "' + id + '".' : 'Chưa có layer nào gắn với "' + id + '".', keys.length ? 'ok' : 'warn');
  },
  count(ch, id) { return App.state.layers.filter(l => l.when && [].concat(l.when[ch] || []).includes(id)).length; }
};

const Panels = {
  rtab: 'layer', ltab: 'layers', anchor: null, filter: '', dragKeys: null, dragNode: null,
  focus(tab) { if (tab) this.rtab = tab; },
  render() {
    const st = App.state; if (!st) return;
    $('#mname').value = st.name;
    $('#bUndo').disabled = App.hi <= 0; $('#bRedo').disabled = App.hi >= App.hist.length - 1;
    this.renderLayers(); this.renderNodes(); this.renderRight();
    $('#bMode').textContent = App.mode === 'preview' ? '✎ Quay lại chỉnh sửa' : '▶ Xem thử';
    document.querySelectorAll('#ltabs button').forEach(b => b.classList.toggle('on', b.dataset.t === this.ltab));
    $('#layersTab').hidden = this.ltab !== 'layers'; $('#nodesTab').hidden = this.ltab !== 'nodes';
  },

  /* ---------- danh sách layer ---------- */
  thumb(l) {
    const c = el('canvas', { width: 28, height: 28, class: 'thumb' }), im = App.imgs.get(l.key); if (!im) return c;
    const g = c.getContext('2d'), s = Math.min(28 / l.w, 28 / l.h); g.drawImage(im.cv, (28 - l.w * s) / 2, (28 - l.h * s) / 2, l.w * s, l.h * s); return c;
  },
  renderLayers() {
    const box = $('#layerList'), st = App.state, q = this.filter.toLowerCase(); box.replaceChildren();
    const L = st.layers; let shown = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i]; if (q && !(l.id + ' ' + (l.node || '')).toLowerCase().includes(q)) continue; shown++;
      const sel = App.sel.layers.has(l.key);
      const row = el('div', { class: 'item' + (sel ? ' sel' : '') + (l.visible ? '' : ' off'), draggable: true, 'data-key': l.key },
        el('button', { class: 'eye', title: 'Ẩn/hiện (layer ẩn sẽ không được xuất)', onclick: e => { e.stopPropagation(); l.visible = !l.visible; App.commit(); } }, l.visible ? '👁' : '—'),
        this.thumb(l), el('span', { class: 'nm', text: l.id }),
        l.node ? el('span', { class: 'badge', text: l.node, title: 'Gắn vào khớp ' + l.node }) : el('span', { class: 'badge none', text: 'đứng yên' }),
        (l.show || l.blink || l.vs || l.when) ? el('span', { class: 'fx', title: [l.show && 'hiện khi: ' + l.show, l.blink && 'chớp mắt', l.vs && 'co giãn theo giọng', l.when && 'điều kiện: ' + Object.entries(l.when).map(([k, v]) => k + '=' + [].concat(v).join('/')).join('; ')].filter(Boolean).join(' • '), text: '✦' }) : null);
      row.addEventListener('click', e => this.clickLayer(e, l));
      row.addEventListener('dragstart', e => { if (!App.sel.layers.has(l.key)) { App.sel.layers = new Set([l.key]); App.refresh(); } this.dragKeys = new Set(App.sel.layers); e.dataTransfer.setData('text/plain', 'layers'); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', e => { if (!this.dragKeys) return; e.preventDefault(); const r = row.getBoundingClientRect(), above = e.clientY < r.top + r.height / 2; this.clearMarks(); row.classList.add(above ? 'mark-above' : 'mark-below'); });
      row.addEventListener('dragleave', () => row.classList.remove('mark-above', 'mark-below'));
      row.addEventListener('drop', e => { e.preventDefault(); const r = row.getBoundingClientRect(); this.dropLayers(l.key, e.clientY < r.top + r.height / 2); });
      row.addEventListener('dragend', () => { this.dragKeys = null; this.clearMarks(); });
      box.append(row);
    }
    if (!shown) box.append(el('div', { class: 'empty', text: L.length ? 'Không có layer khớp bộ lọc.' : 'Chưa có layer. Kéo thả ảnh/zip/thư mục vào đây hoặc bấm “Nhập layer”.' }));
    $('#layerCount').textContent = L.length + ' layer' + (L.some(l => !l.visible) ? ' (' + L.filter(l => !l.visible).length + ' ẩn)' : '');
  },
  clearMarks() { document.querySelectorAll('.mark-above,.mark-below').forEach(x => x.classList.remove('mark-above', 'mark-below')); },
  clickLayer(e, l) {
    const order = App.state.layers.slice().reverse().filter(x => !this.filter || (x.id + ' ' + (x.node || '')).toLowerCase().includes(this.filter.toLowerCase()));
    if (e.shiftKey && this.anchor) {
      const a = order.findIndex(x => x.key === this.anchor), b = order.findIndex(x => x.key === l.key);
      if (a >= 0 && b >= 0) { const [i, j] = a < b ? [a, b] : [b, a]; App.sel.layers = new Set(order.slice(i, j + 1).map(x => x.key)); }
    } else if (e.ctrlKey || e.metaKey) { if (App.sel.layers.has(l.key)) App.sel.layers.delete(l.key); else App.sel.layers.add(l.key); this.anchor = l.key; }
    else { App.sel.layers = new Set([l.key]); this.anchor = l.key; }
    this.rtab = 'layer'; App.refresh();
  },
  dropLayers(targetKey, above) {
    const keys = this.dragKeys; this.dragKeys = null; this.clearMarks(); if (!keys || keys.has(targetKey)) return;
    const L = App.state.layers, block = L.filter(l => keys.has(l.key)), rest = L.filter(l => !keys.has(l.key)), idx = rest.findIndex(l => l.key === targetKey);
    rest.splice(above ? idx + 1 : idx, 0, ...block); // danh sách hiển thị đảo ngược: "phía trên" = chỉ số lớn hơn
    App.state.layers = rest; App.commit();
  },
  moveSel(how) {
    const L = App.state.layers, S = App.sel.layers; if (!S.size) return;
    if (how === 'top') App.state.layers = L.filter(l => !S.has(l.key)).concat(L.filter(l => S.has(l.key)));
    else if (how === 'bottom') App.state.layers = L.filter(l => S.has(l.key)).concat(L.filter(l => !S.has(l.key)));
    else if (how === 'up') { for (let i = L.length - 2; i >= 0; i--) if (S.has(L[i].key) && !S.has(L[i + 1].key)) [L[i], L[i + 1]] = [L[i + 1], L[i]]; }
    else if (how === 'down') { for (let i = 1; i < L.length; i++) if (S.has(L[i].key) && !S.has(L[i - 1].key)) [L[i], L[i - 1]] = [L[i - 1], L[i]]; }
    App.commit();
  },
  deleteSel() {
    const S = App.sel.layers; if (!S.size) return;
    App.state.layers = App.state.layers.filter(l => !S.has(l.key)); App.sel.layers = new Set(); App.commit();
  },
  toggleVis(v) { for (const l of App.selLayers()) l.visible = v === undefined ? !l.visible : v; App.commit(); },

  /* ---------- cây khớp ---------- */
  renderNodes() {
    const box = $('#nodeTree'), st = App.state; box.replaceChildren();
    const kids = p => st.nodes.filter(n => (n.parent || null) === p);
    const count = id => st.layers.filter(l => l.node === id).length;
    const row = (n, depth) => {
      const r = el('div', { class: 'item node' + (App.sel.node === n.id ? ' sel' : ''), draggable: true, style: 'padding-left:' + (8 + depth * 16) + 'px' },
        el('span', { class: 'nm', text: (depth ? '└ ' : '') + n.id }), el('span', { class: 'badge', text: count(n.id) + ' layer' }));
      r.addEventListener('click', () => { App.sel.node = n.id; App.sel.layers = new Set(); this.rtab = 'node'; App.refresh(); });
      r.addEventListener('dragstart', e => { this.dragNode = n.id; e.dataTransfer.setData('text/plain', 'node'); });
      r.addEventListener('dragover', e => { if (this.dragNode && this.dragNode !== n.id) { e.preventDefault(); r.classList.add('mark-in'); } });
      r.addEventListener('dragleave', () => r.classList.remove('mark-in'));
      r.addEventListener('drop', e => { e.preventDefault(); r.classList.remove('mark-in'); this.reparent(this.dragNode, n.id); });
      r.addEventListener('dragend', () => { this.dragNode = null; });
      box.append(r); for (const c of kids(n.id)) row(c, depth + 1);
    };
    for (const n of kids(null)) row(n, 0);
    // vòng lặp / mồ côi (phòng hờ)
    for (const n of st.nodes) if (n.parent && !st.nodes.some(m => m.id === n.parent)) row(n, 0);
    if (!st.nodes.length) box.append(el('div', { class: 'empty', text: 'Chưa có khớp. Bấm “Tạo khung xương tự động” hoặc “＋ Khớp mới”.' }));
    box.ondragover = e => { if (this.dragNode) e.preventDefault(); };
    box.ondrop = e => { if (e.target === box && this.dragNode) { e.preventDefault(); this.reparent(this.dragNode, null); } };
  },
  isDesc(id, anc) { // id có phải con cháu của anc không
    let n = App.node(id), guard = 0; while (n && n.parent && guard++ < 100) { if (n.parent === anc) return true; n = App.node(n.parent); } return false;
  },
  reparent(id, parent) {
    if (!id || id === parent || (parent && this.isDesc(parent, id))) { App.status('Không thể đặt khớp làm con của chính nó hoặc con cháu của nó.', 'warn'); return; }
    App.node(id).parent = parent || null; App.commit();
  },
  addNode() {
    const st = App.state, used = new Set(st.nodes.map(n => n.id)), id = RT.uniqueId('node', used), ls = App.selLayers(), b = ls.length ? RT.unionBox(ls) : RT.unionBox(st.layers.filter(l => l.visible)) || { x: 0, y: 0, w: 100, h: 100 };
    const n = { id, parent: App.sel.node && App.node(App.sel.node) ? App.sel.node : null, pivot: [Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2)] };
    st.nodes.push(n); for (const l of ls) l.node = id; App.sel.node = id; this.rtab = 'node'; this.ltab = 'nodes'; App.commit();
  },
  deleteNode() {
    const id = App.sel.node; if (!id) return; const st = App.state, n = App.node(id);
    for (const c of st.nodes) if (c.parent === id) c.parent = n.parent || null; for (const l of st.layers) if (l.node === id) l.node = null;
    st.nodes = st.nodes.filter(x => x.id !== id); App.sel.node = null; App.commit();
  },
  assign(nodeId) { const ls = App.selLayers(); if (!ls.length) { App.status('Hãy chọn layer trước (bấm trên canvas hoặc trong danh sách).', 'warn'); return; } for (const l of ls) l.node = nodeId || null; App.commit(); },

  /* ---------- bảng thuộc tính (bên phải) ---------- */
  updatePos() { const ls = App.selLayers(); if (ls.length === 1 && $('#fx')) { $('#fx').value = ls[0].x; $('#fy').value = ls[0].y; } },
  updatePivot() { const n = App.sel.node && App.node(App.sel.node); if (n && $('#px')) { $('#px').value = n.pivot[0]; $('#py').value = n.pivot[1]; } },
  field(label, input, hint) { return el('label', { class: 'f' }, el('span', { text: label }), input, hint ? el('small', { text: hint }) : null); },
  num(get, set, step, opts) {
    const i = el('input', { type: 'number', step: step || 1 }); const v = get(); i.value = v === undefined || v === '' ? '' : (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
    if (opts && opts.ph) i.placeholder = opts.ph;
    i.addEventListener('change', () => { const t = i.value.trim(); set(t === '' ? undefined : Number(t)); App.commit(); }); return i;
  },
  sel(options, get, set) {
    const s = el('select', {}, options.map(([v, t]) => el('option', { value: v, text: t }))); const cur = get(); s.value = cur === undefined ? '' : cur;
    if (s.value !== (cur === undefined ? '' : String(cur))) { s.append(el('option', { value: '' + cur, text: '' + cur })); s.value = '' + cur; }
    s.addEventListener('change', () => { set(s.value === '' ? undefined : s.value); App.commit(); }); return s;
  },
  renderRight() {
    const box = $('#inspector'); box.replaceChildren();
    document.querySelectorAll('#rtabs button').forEach(b => b.classList.toggle('on', b.dataset.t === this.rtab));
    $('#rtabs').hidden = App.mode === 'preview';
    if (App.mode === 'preview') { box.append(...this.previewControls()); return; }
    if (this.rtab === 'layer') box.append(...this.layerInspector());
    else if (this.rtab === 'node') box.append(...this.nodeInspector());
    else if (this.rtab === 'expr') box.append(...this.exprInspector());
    else box.append(...this.modelInspector());
  },
  layerInspector() {
    const ls = App.selLayers(), out = [];
    if (!ls.length) return [el('div', { class: 'empty', text: 'Chưa chọn layer nào.\n\n• Bấm vào hình nhân vật hoặc danh sách để chọn.\n• Ctrl/Shift + bấm hoặc kéo khung để chọn nhiều.\n• Kéo layer để di chuyển, phím mũi tên để chỉnh từng pixel.\n• Alt + bấm: chọn layer nằm bên dưới.' })];
    const one = ls.length === 1 ? ls[0] : null, common = (get) => { const v = ls.map(get); return v.every(x => JSON.stringify(x) === JSON.stringify(v[0])) ? v[0] : '__mixed'; };
    out.push(el('h3', { text: one ? 'Layer: ' + one.id : ls.length + ' layer đã chọn' }));
    if (one) {
      out.push(this.field('Tên (id)', (() => { const i = el('input', { type: 'text', value: one.id, maxlength: 40 }); i.addEventListener('change', () => { const used = App.usedIds(); used.delete(one.id); one.id = RT.uniqueId(RT.sanitizeId(i.value || one.id), used); App.commit(); }); return i; })()));
      out.push(el('div', { class: 'two' }, this.field('X', (() => { const i = this.num(() => one.x, v => { if (v !== undefined) one.x = Math.round(v); }); i.id = 'fx'; return i; })()), this.field('Y', (() => { const i = this.num(() => one.y, v => { if (v !== undefined) one.y = Math.round(v); }); i.id = 'fy'; return i; })())));
      out.push(el('small', { class: 'dim', text: 'Kích thước ' + one.w + '×' + one.h + ' px' }));
    }
    const nodeOpts = [['', '— đứng yên (không gắn khớp) —'], ...App.state.nodes.map(n => [n.id, n.id])];
    const nsel = el('select', {}, ...(common(l => l.node) === '__mixed' ? [el('option', { value: '__mixed', text: '(nhiều giá trị)' })] : []), nodeOpts.map(([v, t]) => el('option', { value: v, text: t })));
    nsel.value = common(l => l.node || '') === '__mixed' ? '__mixed' : (common(l => l.node || ''));
    nsel.addEventListener('change', () => { if (nsel.value !== '__mixed') this.assign(nsel.value); });
    out.push(this.field('Gắn vào khớp', nsel));
    const showSel = el('select', {}, ...(common(l => l.show || '') === '__mixed' ? [el('option', { value: '__mixed', text: '(nhiều giá trị)' })] : []),
      [['', 'Luôn hiện'], ['talk', 'Chỉ hiện khi đang nói'], ['!talk', 'Chỉ hiện khi KHÔNG nói'], ['emote', 'Chỉ hiện khi bật emote']].map(([v, t]) => el('option', { value: v, text: t })));
    showSel.value = common(l => l.show || '');
    showSel.addEventListener('change', () => { if (showSel.value === '__mixed') return; for (const l of ls) { if (showSel.value) l.show = showSel.value; else delete l.show; } App.commit(); });
    out.push(this.field('Điều kiện hiển thị', showSel));
    // chớp mắt
    out.push(el('h4', { text: 'Chớp mắt' }));
    const sq = el('input', { type: 'checkbox' }); sq.checked = ls.every(l => l.blink && l.blink.sq);
    sq.addEventListener('change', () => { for (const l of ls) { l.blink = l.blink || {}; if (sq.checked) l.blink.sq = 1; else delete l.blink.sq; if (!Object.keys(l.blink).length) delete l.blink; } App.commit(); });
    out.push(el('label', { class: 'chk' }, sq, ' Ép dẹt khi chớp (mắt)'));
    const dy = el('input', { type: 'number', step: 1, placeholder: '0' }); const dys = ls.map(l => l.blink && l.blink.dy || 0); dy.value = dys.every(v => v === dys[0]) && dys[0] ? dys[0] : '';
    dy.addEventListener('change', () => { const v = Number(dy.value); for (const l of ls) { l.blink = l.blink || {}; if (v) l.blink.dy = v; else delete l.blink.dy; if (!Object.keys(l.blink).length) delete l.blink; } App.commit(); });
    out.push(this.field('Hạ xuống khi chớp (px) — mi mắt', dy));
    // miệng mở
    out.push(el('h4', { text: 'Co giãn theo giọng nói (miệng mở)' }));
    const vs0 = ls.every(l => l.vs), vsc = el('input', { type: 'checkbox' }); vsc.checked = vs0;
    vsc.addEventListener('change', () => { for (const l of ls) { if (vsc.checked) l.vs = l.vs || { x: [.8, .3], y: [.35, .65], ox: .5, oy: 0 }; else delete l.vs; } App.commit(); });
    out.push(el('label', { class: 'chk' }, vsc, ' Bật co giãn theo âm lượng'));
    if (one && one.vs) {
      const v = one.vs, f = (label, get, set) => this.field(label, this.num(get, x => { if (x !== undefined) set(x); }, .05));
      out.push(el('div', { class: 'two' }, f('Ngang: nhỏ nhất', () => v.x[0], x => v.x[0] = x), f('Ngang: thêm khi to', () => v.x[1], x => v.x[1] = x)));
      out.push(el('div', { class: 'two' }, f('Dọc: nhỏ nhất', () => v.y[0], x => v.y[0] = x), f('Dọc: thêm khi to', () => v.y[1], x => v.y[1] = x)));
      out.push(el('div', { class: 'two' }, f('Gốc co giãn X (0–1)', () => v.ox, x => v.ox = x), f('Gốc co giãn Y (0–1)', () => v.oy, x => v.oy = x)));
    }
    // hiển thị theo biểu cảm / emote
    out.push(el('h4', { text: 'Hiển thị theo biểu cảm / emote' }));
    const ex = App.state.expressions || {}, ems = App.state.emotes || [];
    if (!Object.keys(ex).length && !ems.length) out.push(el('small', { class: 'dim', text: 'Chưa có nhóm biểu cảm hay emote. Tạo trong tab “Biểu cảm”.' }), el('button', { class: 'sm', text: '😀 Mở tab Biểu cảm', onclick: () => { this.rtab = 'expr'; this.renderRight(); } }));
    else {
      out.push(el('small', { class: 'dim', text: 'Không tick gì = luôn hiện. Tick các trạng thái mà layer này được phép hiện.' }));
      const toggle = (key, id, on) => { for (const l of ls) { l.when = l.when || {}; const a = [].concat(l.when[key] || []).filter(x => x !== id); if (on) a.push(id); if (a.length) l.when[key] = a; else delete l.when[key]; if (!Object.keys(l.when).length) delete l.when; } App.commit(); };
      const group = (title, key, items) => { out.push(el('div', { class: 'dim', text: title })); out.push(el('div', { class: 'chips' }, items.map(([id, nm]) => { const c = el('input', { type: 'checkbox' }); c.checked = ls.every(l => l.when && [].concat(l.when[key] || []).includes(id)); c.addEventListener('change', () => toggle(key, id, c.checked)); return el('label', { class: 'chip' }, c, ' ' + nm); }))); };
      for (const [ch, d] of Object.entries(ex)) group('Nhóm: ' + (d.name || ch), ch, d.states.map(s => [s.id, s.name || s.id]));
      if (ems.length) group('Emote', 'emote', ems.map(e => [e.id, e.name || e.id]));
    }
    // preset + thao tác
    out.push(el('h4', { text: 'Preset nhanh' }));
    const pre = (t, fn) => el('button', { class: 'sm', text: t, onclick: () => { for (const l of ls) fn(l); App.commit(); } });
    out.push(el('div', { class: 'btns' },
      pre('👁 Mắt', l => { l.blink = { sq: 1 }; }), pre('〰 Mi mắt', l => { l.blink = { dy: Math.max(2, Math.round(l.h * .45)) }; }),
      pre('👄 Miệng mở', l => { l.show = 'talk'; l.vs = { x: [.8, .3], y: [.35, .65], ox: .5, oy: 0 }; }), pre('😶 Miệng đóng', l => { l.show = '!talk'; }),
      pre('💬 Emote', l => { l.show = 'emote'; }), pre('✕ Xoá hiệu ứng', l => { delete l.show; delete l.blink; delete l.vs; })));
    out.push(el('div', { class: 'btns' }, el('button', { class: 'sm', text: 'Ẩn / hiện', onclick: () => this.toggleVis() }), el('button', { class: 'sm danger', text: '🗑 Xoá layer', onclick: () => this.deleteSel() })));
    return out;
  },
  nodeInspector() {
    const st = App.state, n = App.sel.node && App.node(App.sel.node), out = [];
    out.push(el('div', { class: 'btns' }, el('button', { class: 'sm', text: '＋ Khớp mới', onclick: () => this.addNode() })));
    if (!n) return [...out, el('div', { class: 'empty', text: 'Chưa chọn khớp.\n\nChọn trong cây khớp bên trái hoặc bấm vào chấm vàng trên canvas. Kéo chấm để đặt điểm xoay (pivot).' })];
    out.push(el('h3', { text: 'Khớp: ' + n.id }));
    out.push(this.field('Tên (id)', (() => { const i = el('input', { type: 'text', value: n.id, maxlength: 40 }); i.addEventListener('change', () => { const nid = RT.sanitizeId(i.value || n.id); if (nid === n.id) return; if (st.nodes.some(m => m.id === nid)) { App.status('Đã có khớp tên "' + nid + '".', 'warn'); i.value = n.id; return; }
      const old = n.id; for (const m of st.nodes) if (m.parent === old) m.parent = nid; for (const l of st.layers) if (l.node === old) l.node = nid;
      for (const m of st.nodes) for (const sp of [m.spring, m.springY]) if (sp && sp.src && sp.src.startsWith(old + '.')) sp.src = nid + sp.src.slice(old.length);
      n.id = nid; App.sel.node = nid; App.commit(); }); return i; })()));
    const par = el('select', {}, el('option', { value: '', text: '— không có (khớp gốc) —' }), st.nodes.filter(m => m.id !== n.id && !this.isDesc(m.id, n.id)).map(m => el('option', { value: m.id, text: m.id })));
    par.value = n.parent || ''; par.addEventListener('change', () => { n.parent = par.value || null; App.commit(); });
    out.push(this.field('Khớp cha', par));
    out.push(el('div', { class: 'two' }, this.field('Pivot X', (() => { const i = this.num(() => n.pivot[0], v => { if (v !== undefined) n.pivot[0] = Math.round(v); }); i.id = 'px'; return i; })()), this.field('Pivot Y', (() => { const i = this.num(() => n.pivot[1], v => { if (v !== undefined) n.pivot[1] = Math.round(v); }); i.id = 'py'; return i; })())));
    out.push(el('small', { class: 'dim', text: 'Kéo chấm trên canvas để đặt pivot (điểm xoay).' }));
    out.push(el('div', { class: 'btns' }, el('button', { class: 'sm', text: '⬇ Gắn layer đang chọn vào khớp này', onclick: () => this.assign(n.id) }),
      el('button', { class: 'sm', text: '☑ Chọn các layer của khớp', onclick: () => { App.sel.layers = new Set(st.layers.filter(l => l.node === n.id).map(l => l.key)); this.rtab = 'node'; App.refresh(); } }),
      el('button', { class: 'sm danger', text: '🗑 Xoá khớp', onclick: () => this.deleteNode() })));
    const P = (path, label, step) => this.field(label, this.num(() => getPath(n, path), v => setPath(n, path, v === undefined || !Number.isFinite(v) ? undefined : v), step));
    out.push(el('h4', { text: 'Góc xoay mặc định' }), P('rest.rot', 'Độ (dương = xoay thuận chiều kim đồng hồ) — dùng để nắn thẳng đầu', .5));
    out.push(el('h4', { text: 'Theo chuột (giá trị khi chuột lệch hết cỡ)' }), el('div', { class: 'three' }, P('look.x', 'Dịch X (px)', .1), P('look.y', 'Dịch Y (px)', .1), P('look.rot', 'Xoay (°)', .1)));
    out.push(el('h4', { text: 'Khi nói (âm lượng tối đa)' }), el('div', { class: 'two' }, P('voice.y', 'Dịch Y (px, âm = lên)', .1), P('voice.sy', 'Giãn dọc', .005)));
    out.push(el('h4', { text: 'Nhịp thở' }), el('div', { class: 'two' }, P('breath.y', 'Dịch Y (px)', .1), P('breath.sy', 'Giãn dọc', .0005)));
    const others = st.nodes.filter(m => m.id !== n.id);
    const springBlock = (key, title, srcOpts, defaults) => {
      const on = !!n[key], c = el('input', { type: 'checkbox' }); c.checked = on;
      c.addEventListener('change', () => { if (c.checked) n[key] = { ...defaults }; else delete n[key]; App.commit(); });
      out.push(el('h4', {}, el('label', { class: 'chk' }, c, ' ' + title)));
      if (!on) return;
      out.push(this.field('Bám theo tín hiệu', this.sel(srcOpts, () => n[key].src, v => n[key].src = v)));
      out.push(el('div', { class: 'two' }, P(key + '.gain', 'Độ mạnh', .05), P(key + '.amp', 'Hệ số tín hiệu', .1)));
      out.push(el('div', { class: 'two' }, P(key + '.k', 'Độ cứng (cao = lắc nhanh)', 1), P(key + '.c', 'Giảm chấn (cao = nhanh dừng)', .5)));
    };
    springBlock('spring', 'Lò xo xoay (đung đưa có quán tính)', [['lx', 'Chuột ngang (lx)'], ['ly', 'Chuột dọc (ly)'], ['lvl', 'Âm lượng (lvl)'], ...others.map(m => [m.id + '.rot', 'Góc xoay của ' + m.id])], { src: 'lx', amp: 3, gain: 1, k: 70, c: 7 });
    springBlock('springY', 'Lò xo dọc (nhún lên xuống)', [['ly', 'Chuột dọc (ly)'], ['lvl', 'Âm lượng (lvl)'], ...others.map(m => [m.id + '.ty', 'Dịch dọc của ' + m.id])], { src: others.some(m => m.id === 'head') ? 'head.ty' : 'ly', gain: .5, k: 70, c: 7 });
    return out;
  },
  exprInspector() {
    const st = App.state, ex = Face.ex(), ems = Face.em(), out = [];
    out.push(el('h3', { text: 'Biểu cảm & Emote' }));
    out.push(el('small', { class: 'dim', text: 'Mỗi nhóm (mắt, miệng…) có nhiều trạng thái; chỉ một trạng thái được chọn tại một thời điểm. Layer được gắn vào trạng thái thì chỉ hiện khi trạng thái đó đang chọn. Emote bật/tắt độc lập. Trong Ezy Tuber bạn gán phím tắt cho từng trạng thái và emote.' }));
    // lọc canvas
    const fv = Editor.face, on = el('input', { type: 'checkbox' }); on.checked = fv.on;
    on.addEventListener('change', () => { fv.on = on.checked; App.refresh(); });
    out.push(el('h4', { text: 'Xem trên canvas' }), el('label', { class: 'chk' }, on, ' Chỉ hiện layer đúng trạng thái đã chọn bên dưới (để thiết kế từng trạng thái)'));
    if (fv.on) {
      for (const [ch, d] of Object.entries(ex)) {
        const s = el('select', {}, el('option', { value: '', text: '— không lọc —' }), d.states.map(x => el('option', { value: x.id, text: x.name || x.id }))); s.value = fv.sel[ch] || '';
        s.addEventListener('change', () => { fv.sel[ch] = s.value; Editor.draw(); }); out.push(this.field((d.name || ch) + ':', s));
      }
      if (ems.length) out.push(el('div', { class: 'chips' }, ems.map(e => { const c = el('input', { type: 'checkbox' }); c.checked = fv.emotes.includes(e.id); c.addEventListener('change', () => { fv.emotes = fv.emotes.filter(x => x !== e.id); if (c.checked) fv.emotes.push(e.id); Editor.draw(); }); return el('label', { class: 'chip' }, c, ' ' + (e.name || e.id)); })));
    }
    // nhóm biểu cảm
    out.push(el('h4', { text: 'Nhóm biểu cảm' }), el('small', { class: 'dim', text: '★ = mặc định • số = layer đang gắn • ⬇ gán layer đang chọn vào trạng thái • ☑ chọn các layer của trạng thái • ✕ xoá' }));
    for (const [ch, d] of Object.entries(ex)) {
      const nm = el('input', { type: 'text', value: d.name || ch, maxlength: 30 }); nm.addEventListener('change', () => { d.name = nm.value.trim() || ch; App.commit(); });
      const card = el('div', { class: 'card' }, el('div', { class: 'two1' }, nm, el('button', { class: 'sm danger', title: 'Xoá nhóm', text: '🗑', onclick: () => { if (confirm('Xoá nhóm "' + (d.name || ch) + '"? Các layer gắn với nhóm này sẽ hiện ở mọi trạng thái.')) Face.deleteChannel(ch); } })));
      card.append(el('small', { class: 'dim', text: 'id: ' + ch }));
      for (const s of d.states) {
        const sn = el('input', { type: 'text', value: s.name || s.id, maxlength: 30 }); sn.addEventListener('change', () => { s.name = sn.value.trim() || s.id; App.commit(); });
        const isDef = d.default === s.id, n = Face.count(ch, s.id);
        card.append(el('div', { class: 'srow' }, el('button', { class: 'sm' + (isDef ? ' pri' : ''), title: isDef ? 'Trạng thái mặc định' : 'Đặt làm mặc định', text: isDef ? '★' : '☆', onclick: () => { d.default = s.id; App.commit(); } }), sn,
          el('span', { class: 'cnt', title: 'Số layer gắn với trạng thái này', text: String(n) }),
          el('button', { class: 'sm', title: 'Gán các layer đang chọn vào trạng thái này', text: '⬇', onclick: () => Face.assign(ch, s.id) }),
          el('button', { class: 'sm', title: 'Chọn các layer của trạng thái này', text: '☑', onclick: () => Face.select(ch, s.id) }),
          el('button', { class: 'sm danger', title: 'Xoá trạng thái', text: '✕', onclick: () => Face.deleteState(ch, s.id) })));
      }
      const add = el('input', { type: 'text', placeholder: 'Tên trạng thái mới (vd: Cười, Nhắm mắt)…', maxlength: 30 });
      const doAdd = () => { const t = add.value.trim(); if (t) Face.addState(ch, t); };
      add.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
      card.append(el('div', { class: 'srow' }, add, el('button', { class: 'sm', text: '＋', onclick: doAdd })));
      out.push(card);
    }
    out.push(el('div', { class: 'btns' }, el('button', { class: 'sm', text: '＋ Nhóm Mắt', onclick: () => Face.addChannel('Mắt', 'eyes') }), el('button', { class: 'sm', text: '＋ Nhóm Miệng', onclick: () => Face.addChannel('Miệng', 'mouth') }), el('button', { class: 'sm', text: '＋ Nhóm khác…', onclick: () => { const t = prompt('Tên nhóm biểu cảm (vd: Lông mày, Má hồng):'); if (t && t.trim()) Face.addChannel(t.trim()); } })));
    // emote
    out.push(el('h4', { text: 'Emote' }));
    for (const e of ems) {
      const nm = el('input', { type: 'text', value: e.name || e.id, maxlength: 30 }); nm.addEventListener('change', () => { e.name = nm.value.trim() || e.id; App.commit(); });
      const du = el('input', { type: 'number', min: 0, max: 600, step: 0.5, value: e.duration || 0, title: 'Tự tắt sau (giây). 0 = bật cho tới khi tắt' }); du.addEventListener('change', () => { e.duration = Math.max(0, Math.min(600, Number(du.value) || 0)); App.commit(); });
      const gr = el('input', { type: 'text', value: e.group || '', placeholder: 'nhóm', title: 'Cùng nhóm thì chỉ bật được một emote tại một thời điểm', maxlength: 20 }); gr.addEventListener('change', () => { const g = RT.sanitizeId(gr.value).toLowerCase(); if (gr.value.trim()) e.group = g; else delete e.group; App.commit(); });
      out.push(el('div', { class: 'card' }, el('div', { class: 'two1' }, nm, el('button', { class: 'sm danger', text: '🗑', title: 'Xoá emote', onclick: () => Face.deleteEmote(e.id) })),
        el('div', { class: 'srow' }, el('small', { class: 'dim', text: 'tự tắt (giây)' }), du, el('small', { class: 'dim', text: 'nhóm' }), gr, el('span', { class: 'cnt', title: 'Số layer', text: String(Face.count('emote', e.id)) })),
        el('div', { class: 'btns' }, el('button', { class: 'sm', text: '⬇ Gán layer đang chọn', onclick: () => Face.assign('emote', e.id) }), el('button', { class: 'sm', text: '☑ Chọn layer', onclick: () => Face.select('emote', e.id) }))));
    }
    const addE = el('input', { type: 'text', placeholder: 'Tên emote mới (vd: Trái tim, Mồ hôi)…', maxlength: 30 });
    const doAddE = () => { const t = addE.value.trim(); if (t) Face.addEmote(t); };
    addE.addEventListener('keydown', e => { if (e.key === 'Enter') doAddE(); });
    out.push(el('div', { class: 'srow' }, addE, el('button', { class: 'sm', text: '＋', onclick: doAddE })));
    return out;
  },
  modelInspector() {
    const st = App.state, out = [el('h3', { text: 'Model' })];
    const ni = el('input', { type: 'text', value: st.name, maxlength: 60 }); ni.addEventListener('change', () => { st.name = ni.value.trim() || 'Model'; App.commit(); });
    out.push(this.field('Tên model (cũng là tên thư mục khi xuất)', ni));
    out.push(this.field('Định dạng ảnh khi xuất', this.sel([['png', 'PNG (chính xác, file lớn hơn)'], ['webp', 'WebP chất lượng cao (nhỏ hơn)']], () => st.fmt, v => st.fmt = v || 'png')));
    const at = el('input', { type: 'checkbox' }); at.checked = st.autoTune; at.addEventListener('change', () => { st.autoTune = at.checked; App.commit(); });
    out.push(el('label', { class: 'chk' }, at, ' Tự sinh thanh kéo tinh chỉnh từ các khớp'));
    out.push(el('small', { class: 'dim', text: st.tune ? 'Model này có sẵn danh sách thanh kéo (' + st.tune.length + '). Bỏ chọn = giữ nguyên danh sách đó (tự bỏ thanh trỏ tới khớp đã xoá); chọn = sinh lại từ các khớp hiện có, nên thêm/đổi khớp thì nên chọn.' : 'Bỏ chọn nếu không muốn có thanh kéo tinh chỉnh trong Ezy Tuber.' }));
    out.push(el('h4', { text: 'Khung xuất (crop)' }));
    const ca = el('input', { type: 'checkbox' }); ca.checked = st.cropAuto !== false;
    ca.addEventListener('change', () => { st.cropAuto = ca.checked; if (!ca.checked) st.crop = { ...Editor.crop() }; App.commit(); });
    out.push(el('label', { class: 'chk' }, ca, ' Tự tính theo layer + lề'));
    if (st.cropAuto !== false) out.push(el('div', { class: 'two' }, this.field('Lề trên (px)', this.num(() => st.margin.top, v => { if (v !== undefined) st.margin.top = Math.max(0, v); })), this.field('Lề hai bên (px)', this.num(() => st.margin.side, v => { if (v !== undefined) st.margin.side = Math.max(0, v); }))),
      el('small', { class: 'dim', text: 'Lề trên giúp đầu không bị cắt khi nảy lên; lề hai bên cho tóc/tay áo đung đưa.' }));
    else { const c = st.crop || Editor.crop(); out.push(el('div', { class: 'two' }, ...['x', 'y', 'w', 'h'].map(k => this.field(k.toUpperCase(), this.num(() => c[k], v => { if (v !== undefined) { st.crop = { ...c, [k]: Math.round(v) }; } }))))); }
    const c = Editor.crop(); out.push(el('small', { class: 'dim', text: 'Khung hiện tại: ' + c.w + '×' + c.h + ' (x=' + c.x + ', y=' + c.y + ')' }));
    out.push(el('h4', { text: 'Thống kê' }), el('small', { class: 'dim', text: st.layers.filter(l => l.visible).length + ' layer sẽ xuất • ' + st.nodes.length + ' khớp • canvas gốc ' + st.canvas.w + '×' + st.canvas.h }));
    return out;
  },

  /* ---------- điều khiển Xem thử ---------- */
  previewControls() {
    const p = Preview.p, out = [el('h3', { text: 'Xem thử' }), el('small', { class: 'dim', text: 'Di chuột trong khung để model nhìn theo chuột — giống hệt khi chạy trong Ezy Tuber.' })];
    const sl = (label, min, max, step, get, set) => { const v = el('span', { class: 'val', text: String(get()) }); const i = el('input', { type: 'range', min, max, step }); i.value = get(); i.addEventListener('input', () => { set(+i.value); v.textContent = i.value; }); return el('label', { class: 'f' }, el('span', {}, label, ' ', v), i); };
    const ck = (label, get, set) => { const i = el('input', { type: 'checkbox' }); i.checked = get(); i.addEventListener('change', () => set(i.checked)); return el('label', { class: 'chk' }, i, ' ' + label); };
    out.push(el('h4', { text: 'Giả lập giọng nói & biểu cảm' }), sl('Âm lượng (nói)', 0, 1, .05, () => p.lvl, v => p.lvl = v), ck('Tự nói liên tục', () => p.auto, v => p.auto = v), ck('Bật emote', () => p.emote, v => p.emote = v), ck('Tự chớp mắt', () => p.blink, v => p.blink = v),
      el('div', { class: 'btns' }, el('button', { class: 'sm', text: '👁 Chớp ngay', onclick: () => Preview.blinkNow_() })));
    const fx = Object.entries(App.state.expressions || {}).filter(([, d]) => d.states.length), ems = App.state.emotes || [];
    if (fx.length || ems.length) {
      out.push(el('h4', { text: 'Biểu cảm & Emote' }));
      for (const [ch, d] of fx) { const s = el('select', {}, d.states.map(x => el('option', { value: x.id, text: x.name || x.id }))); s.value = p.face.sel[ch] || d.default; s.addEventListener('change', () => { p.face.sel[ch] = s.value; }); out.push(this.field((d.name || ch) + ':', s)); }
      if (ems.length) out.push(el('div', { class: 'chips' }, ems.map(e => { const c = el('input', { type: 'checkbox' }); c.checked = p.face.emotes.includes(e.id); c.addEventListener('change', () => { p.face.emotes = p.face.emotes.filter(x => x !== e.id); if (c.checked) p.face.emotes.push(e.id); }); return el('label', { class: 'chip' }, c, ' ' + (e.name || e.id)); })));
    }
    out.push(el('h4', { text: 'Mức chuyển động (nhân chung — giống tab Tinh chỉnh của Ezy Tuber)' }),
      sl('Theo chuột', 0, 2.5, .05, () => p.look, v => { p.look = v; Preview.applyMasters(); }), sl('Nảy khi nói', 0, 2.5, .05, () => p.voice, v => { p.voice = v; Preview.applyMasters(); }),
      sl('Nhịp thở', 0, 3, .05, () => p.bre, v => { p.bre = v; Preview.applyMasters(); }), sl('Đung đưa tóc/tay/váy', 0, 2.5, .05, () => p.spr, v => { p.spr = v; Preview.applyMasters(); }));
    out.push(el('h4', { text: 'Nền xem thử' }));
    out.push(this.field('Màu nền', this.sel([['dark', 'Tối'], ['green', 'Xanh lá'], ['blue', 'Xanh dương'], ['pink', 'Hồng'], ['light', 'Sáng'], ['checker', 'Ca rô'], ['image', '🖼 Ảnh từ máy…']], () => p.bg, v => {
      if (v === 'image' && !Preview.bgImg) { p.bg = 'dark'; $('#fBg').click(); } else p.bg = v || 'dark'; Panels.renderRight(); })));
    out.push(el('div', { class: 'btns' }, el('button', { class: 'sm', text: '🖼 Chọn ảnh nền từ máy…', onclick: () => $('#fBg').click() }),
      Preview.bgImg ? el('button', { class: 'sm danger', text: '✕ Bỏ ảnh nền', onclick: () => { Preview.clearBg(); Panels.renderRight(); } }) : null));
    if (Preview.bgImg) {
      out.push(el('small', { class: 'dim', text: 'Ảnh nền: ' + Preview.bgName + ' (' + Preview.bgImg.width + '×' + Preview.bgImg.height + ')' }));
      out.push(this.field('Cách đặt ảnh', this.sel([['cover', 'Phủ kín khung (cắt bớt phần thừa)'], ['contain', 'Vừa khung (có viền đen)']], () => p.bgFit, v => { p.bgFit = v || 'cover'; })));
    } else out.push(el('small', { class: 'dim', text: 'Có thể kéo thả file ảnh vào khung xem thử để làm nền. Ảnh nền chỉ để xem thử, không đưa vào model.' }));
    return out;
  },

  /* ---------- hộp thoại ---------- */
  modal(title, body, buttons) {
    const old = $('#modal'); if (old) old.remove();
    const close = () => { const m = $('#modal'); if (m) m.remove(); };
    const m = el('div', { id: 'modal', onclick: e => { if (e.target.id === 'modal') close(); } }, el('div', { class: 'dlg' }, el('div', { class: 'dh' }, el('b', { text: title }), el('button', { class: 'x', text: '✕', onclick: close })), el('div', { class: 'db' }, body), el('div', { class: 'df' }, ...(buttons || []), el('button', { class: 'sm', text: 'Đóng', onclick: close }))));
    document.body.append(m); return m;
  },
  openModelDialog() {
    const body = el('div', {}, el('p', { text: 'Nhập một model đã làm xong (từ Ezy Maker hoặc thư mục trong model/ của Ezy Tuber) để chỉnh sửa tiếp. Toàn bộ layer, khớp, chuyển động, thanh kéo và settings.json sẽ được giữ nguyên.' }),
      el('div', { class: 'btns', style: 'margin:12px 0' }, el('button', { class: 'pri', text: '📦 Chọn file .zip của model', onclick: () => { $('#modal').remove(); $('#fOpen').click(); } }),
        el('button', { class: 'pri', text: '📁 Chọn thư mục model', onclick: () => { $('#modal').remove(); $('#fDir').click(); } })),
      el('p', { class: 'dim', text: 'Mẹo: bạn cũng có thể kéo thả file .zip hoặc cả thư mục model thẳng vào cửa sổ. Thư mục model phải chứa model.json và thư mục assets.' }));
    this.modal('📂 Mở model để chỉnh sửa', body);
  },
  showReport(title, lines) { this.modal(title, el('ul', { class: 'rep' }, lines.map(t => el('li', { text: t })))); }
};
