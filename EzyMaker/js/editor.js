/* ====================================================================
   Editor (canvas soạn thảo) + Preview (xem thử có chuyển động)
   ==================================================================== */
const Editor = {
  cv: null, ctx: null, zoom: 1, panX: 0, panY: 0, dpr: 1, showNodes: true, showCrop: true, isolate: false,
  space: false, drag: null, band: null, hoverNode: null,
  face: { on: false, sel: {}, emotes: [] }, // lọc canvas theo biểu cảm/emote để thiết kế từng trạng thái
  faceShown(l) {
    if (!this.face.on || !l.when) return true;
    for (const k in l.when) { const v = l.when[k], arr = Array.isArray(v) ? v : [v];
      if (k === 'emote') { if (!arr.some(x => this.face.emotes.includes(x))) return false; }
      else if (this.face.sel[k] && !arr.includes(this.face.sel[k])) return false; }
    return true;
  },
  init(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.resize();
  },
  resize() {
    const p = this.cv.parentElement; this.dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.max(10, Math.round(p.clientWidth * this.dpr)); this.cv.height = Math.max(10, Math.round(p.clientHeight * this.dpr));
    this.cv.style.width = p.clientWidth + 'px'; this.cv.style.height = p.clientHeight + 'px';
    if (App.mode === 'preview') Preview.layoutDirty = true; else this.draw();
  },
  get W() { return this.cv.width / this.dpr; }, get H() { return this.cv.height / this.dpr; },
  toCanvas(sx, sy) { return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom]; },
  toScreen(x, y) { return [x * this.zoom + this.panX, y * this.zoom + this.panY]; },
  pos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; },
  fit() {
    if (!this.cv) return;
    const st = App.state, b = RT.unionBox(st.layers.filter(l => l.visible)) || { x: 0, y: 0, w: st.canvas.w, h: st.canvas.h };
    const pad = 40, z = Math.min((this.W - pad * 2) / b.w, (this.H - pad * 2) / b.h);
    this.zoom = Math.max(.05, Math.min(8, z)); this.panX = (this.W - b.w * this.zoom) / 2 - b.x * this.zoom; this.panY = (this.H - b.h * this.zoom) / 2 - b.y * this.zoom;
    this.draw();
  },
  setZoom(z, cx, cy) {
    z = Math.max(.05, Math.min(16, z)); if (cx === undefined) { cx = this.W / 2; cy = this.H / 2; }
    const [x, y] = this.toCanvas(cx, cy); this.zoom = z; this.panX = cx - x * z; this.panY = cy - y * z; this.draw();
  },
  wheel(e) { e.preventDefault(); const [sx, sy] = this.pos(e); this.setZoom(this.zoom * Math.pow(1.0015, -e.deltaY), sx, sy); },

  /* ----- vẽ ----- */
  crop() { const st = App.state; return st.cropAuto === false && st.crop ? st.crop : RT.autoCrop(st.layers, st.margin); },
  draw() {
    if (!this.cv || App.mode === 'preview' || !App.state) return;
    const { ctx, dpr } = this, W = this.W, H = this.H, st = App.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#25232c'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(this.panX, this.panY); ctx.scale(this.zoom, this.zoom);
    // nền ca rô của canvas gốc
    ctx.fillStyle = '#34313d'; ctx.fillRect(0, 0, st.canvas.w, st.canvas.h);
    ctx.fillStyle = '#3b3846'; const T = 16;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, st.canvas.w, st.canvas.h); ctx.clip();
    for (let y = 0; y < st.canvas.h; y += T) for (let x = (y / T) % 2 ? 0 : T; x < st.canvas.w; x += T * 2) ctx.fillRect(x, y, T, T);
    ctx.restore();
    ctx.imageSmoothingEnabled = this.zoom < 3;
    const dim = this.isolate && App.sel.layers.size;
    for (const l of st.layers) {
      if (!l.visible) continue; const im = App.imgs.get(l.key); if (!im) continue;
      ctx.globalAlpha = dim && !App.sel.layers.has(l.key) ? .2 : 1; if (!this.faceShown(l)) ctx.globalAlpha = Math.min(ctx.globalAlpha, .07);
      ctx.drawImage(im.cv, l.x, l.y);
    }
    ctx.globalAlpha = 1; ctx.restore();
    // khung xuất
    if (this.showCrop && st.layers.some(l => l.visible)) {
      const c = this.crop(), [x, y] = this.toScreen(c.x, c.y);
      ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = '#6fe39a'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, c.w * this.zoom, c.h * this.zoom);
      ctx.setLineDash([]); ctx.fillStyle = '#6fe39a'; ctx.font = '11px system-ui'; ctx.fillText('khung xuất ' + c.w + '×' + c.h, x + 4, y - 5); ctx.restore();
    }
    // layer đang chọn
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.5;
    for (const l of App.selLayers()) { const [x, y] = this.toScreen(l.x, l.y); ctx.strokeRect(x + .5, y + .5, l.w * this.zoom, l.h * this.zoom); }
    // khớp
    if (this.showNodes) {
      ctx.lineWidth = 1;
      for (const n of st.nodes) { const p = n.parent && App.node(n.parent); if (!p) continue; const [x1, y1] = this.toScreen(...p.pivot), [x2, y2] = this.toScreen(...n.pivot); ctx.strokeStyle = '#ffffff66'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
      ctx.font = '11px system-ui';
      for (const n of st.nodes) {
        const [x, y] = this.toScreen(...n.pivot), sel = App.sel.node === n.id;
        ctx.beginPath(); ctx.arc(x, y, sel ? 7 : 5, 0, 6.2832); ctx.fillStyle = sel ? '#ff7a7a' : '#ffd866'; ctx.fill(); ctx.strokeStyle = '#000b'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.strokeStyle = sel ? '#ff7a7a' : '#ffd86699'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#000c'; ctx.fillText(n.id, x + 9, y - 7); ctx.fillStyle = sel ? '#ffb0b0' : '#ffe9a8'; ctx.fillText(n.id, x + 8, y - 8);
      }
    }
    // khung chọn
    if (this.band) { const b = this.band; ctx.fillStyle = '#4aa3ff22'; ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeRect(b.x0 + .5, b.y0 + .5, b.x1 - b.x0, b.y1 - b.y0); }
  },

  /* ----- chọn / kéo ----- */
  nodeAt(sx, sy) {
    if (!this.showNodes) return null; let best = null, bd = 10;
    for (const n of App.state.nodes) { const [x, y] = this.toScreen(...n.pivot), d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = n.id; } }
    return best;
  },
  layersAt(x, y) { // từ trên xuống dưới
    const out = [], L = App.state.layers;
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i]; if (!l.visible || !this.faceShown(l) || x < l.x || y < l.y || x >= l.x + l.w || y >= l.y + l.h) continue;
      const im = App.imgs.get(l.key); if (im && im.alpha[Math.floor(y - l.y) * l.w + Math.floor(x - l.x)] > 16) out.push(l);
    }
    return out;
  },
  down(e) {
    if (App.mode === 'preview') return;
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* sự kiện tổng hợp / con trỏ đã nhả */ } const [sx, sy] = this.pos(e), mod = e.shiftKey || e.ctrlKey || e.metaKey;
    if (e.button === 1 || e.button === 2 || this.space) { this.drag = { type: 'pan', sx, sy, px: this.panX, py: this.panY }; this.cv.style.cursor = 'grabbing'; return; }
    if (e.button !== 0) return;
    const nid = this.nodeAt(sx, sy);
    if (nid) { App.sel.node = nid; Panels.focus('node'); this.drag = { type: 'pivot', id: nid, moved: false }; App.refresh(); return; }
    const [x, y] = this.toCanvas(sx, sy), hits = this.layersAt(x, y);
    if (hits.length) {
      let pick = hits[0];
      if (e.altKey && hits.length > 1) { const cur = hits.findIndex(l => App.sel.layers.has(l.key)); pick = hits[(cur + 1) % hits.length]; } // Alt+click: chọn lớp bên dưới
      let collapse = false;
      if (mod) { if (App.sel.layers.has(pick.key)) App.sel.layers.delete(pick.key); else App.sel.layers.add(pick.key); }
      else if (!App.sel.layers.has(pick.key)) App.sel.layers = new Set([pick.key]);
      else collapse = App.sel.layers.size > 1 ? pick.key : false; // bấm vào layer đã chọn trong nhóm: nếu không kéo thì thu về 1 layer
      Panels.focus('layer'); App.refresh();
      const starts = App.selLayers().map(l => [l, l.x, l.y]);
      this.drag = { type: 'move', sx, sy, starts, moved: false, collapse };
    } else {
      if (!mod) { App.sel.layers = new Set(); App.sel.node = null; }
      this.drag = { type: 'band', add: mod, base: new Set(App.sel.layers) }; this.band = { x0: sx, y0: sy, x1: sx, y1: sy }; App.refresh();
    }
  },
  move(e) {
    const [sx, sy] = this.pos(e), d = this.drag;
    if (App.mode === 'preview') { Preview.mouse(sx, sy); return; }
    if (!d) { const n = this.nodeAt(sx, sy); this.cv.style.cursor = this.space ? 'grab' : n ? 'crosshair' : 'default'; return; }
    if (d.type === 'pan') { this.panX = d.px + sx - d.sx; this.panY = d.py + sy - d.sy; this.draw(); }
    else if (d.type === 'move') {
      const dx = Math.round((sx - d.sx) / this.zoom), dy = Math.round((sy - d.sy) / this.zoom);
      if (!d.moved && (Math.abs(sx - d.sx) > 3 || Math.abs(sy - d.sy) > 3)) d.moved = true;
      if (d.moved) { for (const [l, x, y] of d.starts) { l.x = x + dx; l.y = y + dy; } this.draw(); Panels.updatePos(); }
    } else if (d.type === 'pivot') {
      const n = App.node(d.id), [x, y] = this.toCanvas(sx, sy); n.pivot = [Math.round(x), Math.round(y)]; d.moved = true; this.draw(); Panels.updatePivot();
    } else if (d.type === 'band') {
      const b = this.band; b.x1 = sx; b.y1 = sy;
      const [ax, ay] = this.toCanvas(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)), [bx, by] = this.toCanvas(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
      const set = new Set(d.base);
      for (const l of App.state.layers) if (l.visible && l.x < bx && l.x + l.w > ax && l.y < by && l.y + l.h > ay) set.add(l.key);
      App.sel.layers = set; this.draw();
    }
  },
  up(e) {
    const d = this.drag; this.drag = null; this.cv.style.cursor = this.space ? 'grab' : 'default';
    if (!d) return;
    if (d.type === 'move') { if (d.moved) App.commit(); else if (d.collapse) { App.sel.layers = new Set([d.collapse]); App.refresh(); } }
    else if (d.type === 'pivot') { if (d.moved) App.commit(); }
    else if (d.type === 'band') { this.band = null; Panels.focus(App.sel.layers.size ? 'layer' : undefined); App.refresh(); }
  },
  nudge(dx, dy) {
    const ls = App.selLayers(); if (App.sel.node && !ls.length) { const n = App.node(App.sel.node); n.pivot = [n.pivot[0] + dx, n.pivot[1] + dy]; }
    else for (const l of ls) { l.x += dx; l.y += dy; }
    App.commit();
  }
};

/* ====================================================================
   Preview — chạy engine thật (cùng công thức Ezy Tuber) trên canvas
   ==================================================================== */
const Preview = {
  eng: null, running: false, raf: 0, last: 0, layoutDirty: true, imgOf: {},
  bgImg: null, bgName: '',
  p: { lvl: 0, auto: false, emote: false, blink: true, breath: 2, bg: 'dark', bgFit: 'cover', mx: null, my: null,
    look: 1, voice: 1, bre: 1, spr: 1 },
  lx: 0, ly: 0, lvl: 0, blinkAt: 1500, blinkStart: 0, blinkEnd: 0, blinkNow: false,
  start() {
    const st = App.state;
    const model = RT.buildModel(st, { autoTune: true, srcOf: l => l.key });
    this.eng = new RigEngine(model); this.eng.setBreath(this.p.breath);
    this.p.face = { sel: {}, emotes: [] }; for (const [ch, d] of Object.entries(model.expressions || {})) this.p.face.sel[ch] = d.default;
    this.imgOf = {}; for (const s of model.sprites) this.imgOf[s.id] = App.imgs.get(s.src).cv;
    this.layoutDirty = true; this.lx = this.ly = this.lvl = 0; this.last = performance.now(); this.running = true;
    this.applyMasters(); cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(t => this.frame(t));
  },
  stop() { this.running = false; cancelAnimationFrame(this.raf); },
  async setBgFile(file) { // ảnh nền xem thử chọn từ máy (không đưa vào model)
    try { const bmp = await createImageBitmap(file); if (this.bgImg && this.bgImg.close) this.bgImg.close(); this.bgImg = bmp; this.bgName = file.name || 'ảnh'; this.p.bg = 'image'; App.status('Đã đặt ảnh nền xem thử: ' + this.bgName, 'ok'); }
    catch (e) { App.status('Không đọc được ảnh nền: ' + e.message, 'err'); }
  },
  clearBg() { if (this.bgImg && this.bgImg.close) this.bgImg.close(); this.bgImg = null; this.bgName = ''; if (this.p.bg === 'image') this.p.bg = 'dark'; },
  applyMasters() { if (!this.eng) return; const M = this.eng.MG, p = this.p; M.look = p.look; M.voice = p.voice; M.breath = p.bre; M.spring = p.spr; },
  mouse(sx, sy) { this.p.mx = sx; this.p.my = sy; },
  blinkNow_() { this.blinkStart = performance.now(); this.blinkEnd = this.blinkStart + 140; },
  frame(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(t => this.frame(t));
    const E = Editor, eng = this.eng, dt = Math.min(.1, (now - this.last) / 1000); this.last = now; const t = now / 1000;
    const W = E.W, H = E.H;
    if (this.layoutDirty) { eng.layout(W, H); this.layoutDirty = false; }
    const p = this.p, MG = eng.MG;
    // chuột → lx, ly (cùng cách tính với Ezy Tuber: lệch so với tâm cửa sổ, chia 2.2 chiều)
    const tx = p.mx === null ? 0 : Math.max(-1, Math.min(1, ((p.mx - W / 2) / (W / 2.2)) * MG.range)), ty = p.my === null ? 0 : Math.max(-1, Math.min(1, ((p.my - H * .25) / (H / 2.2)) * MG.range));
    const k = 1 - Math.pow(1 - MG.follow, dt * 60); this.lx += (tx - this.lx) * k; this.ly += (ty - this.ly) * k;
    const raw = p.auto ? .5 + Math.sin(t * 7) * .35 * Math.sin(t * 2.3) : p.lvl;
    this.lvl += (raw - this.lvl) * (1 - Math.pow(1 - MG.vfollow, dt * 60)); this.lvl = Math.max(0, Math.min(1, this.lvl));
    if (p.blink && now > this.blinkAt) { this.blinkStart = now; this.blinkEnd = now + 140; this.blinkAt = now + 2000 + Math.random() * 3500; }
    let bv = 0; if (now < this.blinkEnd) { const q = (now - this.blinkStart) / 140; bv = Math.round((q < .4 ? q / .4 : (1 - q) / .6) * 4) / 4; }
    const out = eng.render({ lx: this.lx, ly: this.ly, lvl: this.lvl, tb: t, blink: bv, talk: this.lvl > .1, emote: p.emote, face: p.face }, dt);
    // vẽ
    const ctx = E.ctx, dpr = E.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = { dark: '#25232c', green: '#00b140', blue: '#0047bb', light: '#f2efe9', pink: '#ff00ff' }[p.bg];
    if (p.bg === 'image' && this.bgImg) { // ảnh nền: phủ kín (cắt bớt) hoặc vừa khung (có viền đen)
      const im = this.bgImg, k = (p.bgFit === 'contain' ? Math.min : Math.max)(W / im.width, H / im.height), dw = im.width * k, dh = im.height * k;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); } else {
      ctx.fillStyle = '#555'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#666';
      for (let y = 0; y < H; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < W; x += 32) ctx.fillRect(x, y, 16, 16);
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const S = eng.S;
    for (let i = 0; i < out.length; i++) {
      const o = out[i]; if (!o.visible) continue; const s = eng.sprites[i], m = o.m;
      ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * (m[4] + eng.ox), dpr * (m[5] + eng.oy));
      ctx.drawImage(this.imgOf[s.id], 0, 0, s.w * S, s.h * S);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
};
