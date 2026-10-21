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
        (l.show || l.blink || l.vs) ? el('span', { class: 'fx', title: [l.show && 'hiện khi: ' + l.show, l.blink && 'chớp mắt', l.vs && 'co giãn theo giọng'].filter(Boolean).join(' • '), text: '✦' }) : null);
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
    out.push(el('h4', { text: 'Mức chuyển động (nhân chung — giống tab Tinh chỉnh của Ezy Tuber)' }),
      sl('Theo chuột', 0, 2.5, .05, () => p.look, v => { p.look = v; Preview.applyMasters(); }), sl('Nảy khi nói', 0, 2.5, .05, () => p.voice, v => { p.voice = v; Preview.applyMasters(); }),
      sl('Nhịp thở', 0, 3, .05, () => p.bre, v => { p.bre = v; Preview.applyMasters(); }), sl('Đung đưa tóc/tay/váy', 0, 2.5, .05, () => p.spr, v => { p.spr = v; Preview.applyMasters(); }));
    out.push(this.field('Nền xem thử', this.sel([['dark', 'Tối'], ['green', 'Xanh lá'], ['blue', 'Xanh dương'], ['pink', 'Hồng'], ['light', 'Sáng'], ['checker', 'Ca rô']], () => p.bg, v => { p.bg = v || 'dark'; Panels.renderRight(); })));
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
    const body = el('div', {}, el('p', { text: 'Nhập một model đã làm xong (từ Ezy Maker, từ AI, hoặc thư mục trong model/ của Ezy Tuber) để chỉnh sửa tiếp. Toàn bộ layer, khớp, chuyển động, thanh kéo và settings.json sẽ được giữ nguyên.' }),
      el('div', { class: 'btns', style: 'margin:12px 0' }, el('button', { class: 'pri', text: '📦 Chọn file .zip của model', onclick: () => { $('#modal').remove(); $('#fOpen').click(); } }),
        el('button', { class: 'pri', text: '📁 Chọn thư mục model', onclick: () => { $('#modal').remove(); $('#fDir').click(); } })),
      el('p', { class: 'dim', text: 'Mẹo: bạn cũng có thể kéo thả file .zip hoặc cả thư mục model thẳng vào cửa sổ. Thư mục model phải chứa model.json và thư mục assets.' }));
    this.modal('📂 Mở model để chỉnh sửa', body);
  },
  showReport(title, lines) { this.modal(title, el('ul', { class: 'rep' }, lines.map(t => el('li', { text: t })))); },
  async showGuide() {
    const prompt = await api.getPrompt();
    const step = (n, t, ...more) => el('div', { class: 'step' }, el('div', { class: 'n', text: n }), el('div', {}, el('b', { text: t }), ...more));
    const body = el('div', { class: 'guide' },
      el('p', { class: 'dim', text: 'Cách nhanh nhất để có model: dùng AI tách layer rồi rig tự động. Làm theo 5 bước:' }),
      step(1, 'Tách layer bằng See-through (Hugging Face)', el('p', {}, 'Mở See-through, tải lên ảnh nhân vật (ảnh vuông cho kết quả tốt nhất), bấm Submit, chờ khoảng 1–2 phút rồi tải file ', el('b', { text: 'PSD' }), ' về.'),
        el('div', { class: 'btns' }, el('button', { class: 'sm pri', text: '🌐 Mở See-through (Hugging Face)', onclick: () => api.openLink('seethrough') }), el('button', { class: 'sm', text: 'GitHub của See-through', onclick: () => api.openLink('github') }))),
      step(2, 'Xuất PSD thành từng file ảnh layer .png', el('p', {}, 'Mở PSD bằng Photoshop (hoặc Photopea / Krita / GIMP…) rồi xuất mỗi layer thành 1 file PNG. Ví dụ Photoshop: ', el('i', { text: 'File → Export → Layers to Files… → PNG-24' }), ' (tên menu có thể khác tuỳ phần mềm/phiên bản).'),
        el('ul', {}, el('li', {}, el('b', { text: 'Giữ nguyên kích thước canvas' }), ' cho mọi file (đừng bật “Trim/cắt gọn”) để giữ đúng vị trí từng layer.'), el('li', { text: 'Tên file nên có số thứ tự đầu (000_, 001_…) theo thứ tự chồng lớp từ dưới lên trên, và tên layer có nghĩa (face, neck, front hair…).' }))),
      step(3, 'Nén tất cả file PNG thành 1 file .zip', el('p', { text: '(Nếu có file layers.json đi kèm thì để chung vào zip.)' })),
      step(4, 'Gửi file zip cho AI kèm prompt bên dưới', el('p', { text: 'Dán prompt vào khung chat, đính kèm file zip, gửi. AI sẽ rig model và trả về 1 file zip chứa thư mục <tên model>/ đầy đủ.' })),
      step(5, 'Dùng model', el('p', {}, 'Giải nén thư mục <tên model> vào thư mục ', el('b', { text: 'model/' }), ' cạnh Ezy Tuber → Cài đặt → tab Model → “Quét lại”. Muốn chỉnh tiếp bằng kéo-thả: ở Ezy Maker bấm ', el('b', { text: '📂 Nhập model để chỉnh sửa' }), ' rồi chọn file zip (hoặc thư mục) đó.')),
      el('h4', { text: 'Prompt cho AI (đã gồm đầy đủ cách Ezy Tuber hoạt động)' }));
    const ta = el('textarea', { readonly: true, rows: 12, class: 'prompt' }); ta.value = prompt; body.append(ta);
    const copy = el('button', { class: 'sm pri', text: '📋 Sao chép prompt', onclick: () => { api.copy(ta.value); copy.textContent = '✔ Đã sao chép'; setTimeout(() => copy.textContent = '📋 Sao chép prompt', 1800); } });
    const save = el('button', { class: 'sm', text: '💾 Lưu prompt ra file .txt', onclick: async () => { const r = await api.saveText('prompt-rig-ezy-tuber.txt', ta.value); if (r.ok) App.status('Đã lưu prompt: ' + r.path, 'ok'); } });
    this.modal('📖 Hướng dẫn dùng AI để rig model', body, [copy, save]);
  }
};
