/* ====================================================================
   RigEngine — tính pose cho model.json. CÙNG CÔNG THỨC với render() trong index.html của Ezy Tuber,
   để "Xem thử" trong Ezy Maker giống hệt khi chạy thật. Không đụng DOM: chỉ trả về ma trận cho từng sprite.
   ==================================================================== */
(function (root) {
  const MG_DEF = { look: 1, voice: 1, breath: 1, spring: 1, range: 1, follow: .15, vfollow: .4 };
  const ID = [1, 0, 0, 1, 0, 0], BAD = new Set(['__proto__', 'constructor', 'prototype']);
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const qn = (v, k) => Math.round(v / k) * k;
  const f2 = n => n.toFixed(2);

  class RigEngine {
    constructor(rig) { this.setModel(rig); }
    setModel(rig) {
      this.rig = JSON.parse(JSON.stringify(rig));
      this.V = this.rig.crop;
      this.nodes = (this.rig.nodes || []).map(n => ({ ...n, cur: { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1 }, M: null, st: { init: 0, x: 0, v: 0, y: 0, vy: 0 } }));
      this.nid = {}; this.nodes.forEach(n => this.nid[n.id] = n);
      this.sprites = this.rig.sprites.map(o => ({ ...o, n: o.node ? this.nid[o.node] : null }));
      this.MG = { ...MG_DEF };
      this.tune = this.rig.tune || [];
      this.tune.forEach(d => { if (!d.g) d.def = +((this.pathGet(d.set[0]) * (d.sign || 1)) || 0).toFixed(4); });
      this.applyTune({});
      this.setBreath(2);
      this.S = 1; this.ox = 0; this.oy = 0; this.busy = false;
    }
    setBreath(v) { this.BR = [0, 6, 12][v] ?? 12; this.QP = v == 1 ? .5 : .25; this.QS = v == 1 ? .001 : .0005; this.SNQ = v == 1 ? 2 : 4; }
    pathOk(a) { return a.length >= 2 && a.every(x => !BAD.has(x)) && this.nid[a[0]]; }
    pathGet(p) { const a = p.split('.'); if (!this.pathOk(a)) return; let o = this.nid[a[0]]; for (let i = 1; i < a.length && o; i++) o = o[a[i]]; return o; }
    pathSet(p, v) {
      const a = p.split('.'); if (!this.pathOk(a)) return; let o = this.nid[a[0]];
      for (let i = 1; i < a.length - 1; i++) { const nx = o[a[i]]; if (nx !== undefined && (typeof nx !== 'object' || nx === null)) return; o = nx || (o[a[i]] = {}); }
      o[a[a.length - 1]] = v;
    }
    applyTune(t) {
      for (const d of this.tune) {
        const v = t && Number.isFinite(t[d.k]) ? t[d.k] : d.def;
        if (d.g) this.MG[d.g] = v; else for (const p of d.set) this.pathSet(p, v * (d.sign || 1));
      }
    }
    // W,H = kích thước vùng vẽ (px). Căn giữa ngang, sát đỉnh — giống cửa sổ của Ezy Tuber.
    layout(W, H) {
      const V = this.V; this.S = Math.min(H / V.h, W / V.w); const S = this.S;
      this.ox = (W - V.w * S) / 2; this.oy = 0;
      for (const o of this.sprites) { o.l = (o.x - V.x) * S; o.t = (o.y - V.y) * S; }
      for (const n of this.nodes) { n.px = (n.pivot[0] - V.x) * S; n.py = (n.pivot[1] - V.y) * S; }
    }
    sigOf(name, lx, ly, lq) {
      if (name == 'lx') return lx; if (name == 'ly') return ly; if (name == 'lvl') return lq;
      const [a, b] = name.split('.'); return this.nid[a] ? this.nid[a].cur[b] || 0 : 0;
    }
    spring(st, kx, kv, target, k, c, dt) {
      if (!st.init) { st[kx] = target; st[kv] = 0; }
      let x = st[kx], v = st[kv]; const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
      for (let i = 0; i < n; i++) { v += (-k * (x - target) - c * v) * h; x += v * h; }
      st[kx] = x; st[kv] = v; return Math.abs(v) > .02 || Math.abs(x - target) > .01;
    }
    /* inp = { lx, ly, lvl, tb (thời gian cho nhịp thở), blink (0..1), talk, emote }
       Trả về mảng: { id, visible, css:'matrix(...)', m:[a,b,c,d,e,f] } theo thứ tự sprite (cũng là thứ tự chồng lớp) */
    render(inp, dt) {
      const { lx, ly, lvl, tb, blink, talk, emote } = inp, MG = this.MG, S = this.S;
      const lq = Math.round(lvl * 20) / 20, sn = this.BR ? Math.round(Math.sin(tb * 2) * this.SNQ) / this.SNQ : 0; let busy = false;
      for (const n of this.nodes) {
        let tx = 0, ty = 0, rot = n.rest ? n.rest.rot || 0 : 0, sx = 1, sy = 1; const st = n.st;
        if (n.look) { tx += (n.look.x || 0) * lx * MG.look; ty += (n.look.y || 0) * ly * MG.look; rot += (n.look.rot || 0) * lx * MG.look; }
        if (n.voice) { ty += (n.voice.y || 0) * lq * MG.voice; sy *= 1 + (n.voice.sy || 0) * lq * MG.voice; }
        if (n.breath) { ty += (n.breath.y || 0) * sn * MG.breath; sy *= 1 + (n.breath.sy || 0) * sn * MG.breath; }
        n.cur.ty = ty; n.cur.rot = rot;
        if (n.spring) { const p = n.spring, s = this.sigOf(p.src, lx, ly, lq) * (p.amp || 1); busy = this.spring(st, 'x', 'v', s, p.k, p.c, dt) || busy; rot += (p.gain || 1) * MG.spring * (st.x - s); }
        if (n.springY) { const p = n.springY, s = this.sigOf(p.src, lx, ly, lq) * (p.amp || 1); busy = this.spring(st, 'y', 'vy', s, p.k, p.c, dt) || busy; ty += (p.gain || 1) * MG.spring * (st.y - s); }
        st.init = 1;
        const c = n.cur; c.rot = qn(rot, .05); c.tx = qn(tx, this.QP); c.ty = qn(ty, this.QP); c.sx = qn(sx, this.QS); c.sy = qn(sy, this.QS);
        const r = c.rot * Math.PI / 180, cs = Math.cos(r), sn_ = Math.sin(r), a = cs * c.sx, b = sn_ * c.sx, cc = -sn_ * c.sy, d = cs * c.sy,
          e = n.px + c.tx * S - (a * n.px + cc * n.py), f = n.py + c.ty * S - (b * n.px + d * n.py);
        n.M = mul(n.parent ? this.nid[n.parent].M : ID, [a, b, cc, d, e, f]);
      }
      const out = [];
      for (const o of this.sprites) {
        let visible = true;
        if (o.show) visible = o.show == 'talk' ? !!talk : o.show == '!talk' ? !talk : o.show == 'emote' ? !!emote : true;
        let M = o.n ? o.n.M : ID;
        if (o.n) {
          if (o.blink && blink) { const v = blink, cy = o.t + o.h * S / 2, k = o.blink.sq ? 1 - .92 * v : 1; M = mul(M, [1, 0, 0, k, 0, cy * (1 - k) + (o.blink.dy || 0) * v * S]); }
          if (o.vs) { const kx = o.vs.x[0] + lq * o.vs.x[1], ky = o.vs.y[0] + lq * o.vs.y[1], cx = o.l + o.w * S * o.vs.ox, cy = o.t + o.h * S * o.vs.oy; M = mul(M, [kx, 0, 0, ky, cx * (1 - kx), cy * (1 - ky)]); }
        }
        const m = o.n ? [M[0], M[1], M[2], M[3], M[0] * o.l + M[2] * o.t + M[4], M[1] * o.l + M[3] * o.t + M[5]] : [1, 0, 0, 1, o.l, o.t];
        out.push({ id: o.id, visible, m, css: `matrix(${m[0].toFixed(4)},${m[1].toFixed(4)},${m[2].toFixed(4)},${m[3].toFixed(4)},${f2(m[4])},${f2(m[5])})` });
      }
      this.busy = busy;
      return out;
    }
  }
  RigEngine.MG_DEF = MG_DEF;
  if (typeof module !== 'undefined' && module.exports) module.exports = RigEngine; else root.RigEngine = RigEngine;
})(typeof window !== 'undefined' ? window : globalThis);
