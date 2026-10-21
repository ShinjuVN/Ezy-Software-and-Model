/* ====================================================================
   RigTools — các hàm thuần (không đụng DOM) cho Ezy Maker:
   đặt id, nhận diện vai trò layer, tự dựng khung xương, tìm layer bị che, sinh thanh kéo, dựng + kiểm tra model.json
   ==================================================================== */
(function (root) {
  const ID_RE = /^[A-Za-z0-9_\-]{1,40}$/;
  const strip = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r3 = v => Math.round(v * 1000) / 1000;
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

  /* ---------- id / tên ---------- */
  function sanitizeId(name) {
    const s = strip(name).replace(/\.[A-Za-z0-9]{2,4}$/, '');
    let rest = s.replace(/^\d+[\s_\-.]*/, '');
    if (!rest) rest = 'layer' + s.replace(/\D/g, '');
    rest = rest.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'layer';
    return rest.slice(0, 40);
  }
  function uniqueId(base, used) {
    let id = base, i = 2;
    while (used.has(id)) { const suf = '_' + i++; id = base.slice(0, 40 - suf.length) + suf; }
    used.add(id); return id;
  }
  const safeFolderName = name => (String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 60)) || 'model';

  /* ---------- nhận diện vai trò layer từ tên ---------- */
  function roleOf(raw) {
    const n = strip(raw).toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/^\d+[\s_\-.]*/, '').replace(/[_\-.]+/g, ' ').trim();
    let side = null;
    const m = n.match(/(?:^| )(l|left|r|right)(?: |$)/);
    if (m) side = m[1][0] === 'l' ? 'l' : 'r';
    const has = re => re.test(n);
    let role;
    if (has(/eye ?white|sclera/)) role = 'eyewhite';
    else if (has(/lash|eyelid/)) role = 'lash';
    else if (has(/brow/)) role = 'brow';
    else if (has(/irid|iris|pupil|eyeball|^eyes?( |$)/)) role = 'iris';
    else if (has(/mouth|lip|teeth|tongue/)) role = has(/open/) ? 'mouthOpen' : 'mouth';
    else if (has(/\bears?\b/)) role = 'ear';
    else if (has(/bubble|emote|balloon|\bemo\b/)) role = 'bubble';
    else if (has(/(back|rear).*hair|hair.*(back|rear)/)) role = 'hairBack';
    else if (has(/hair|bang|fringe/)) role = 'hairFront';
    else if (has(/neck|throat/)) role = 'neck';
    else if (has(/(back|rear).*(bottom|skirt|pant)|(bottom|skirt|pant).*(back|rear)/)) role = 'bottomBack';
    else if (has(/bottom|skirt|pant|short/)) role = 'bottom';
    else if (has(/hand|arm|sleeve|glove/)) role = 'arm';
    else if (has(/headwear|hat|ribbon|horn|accessor|headband|halo|hairpin/)) role = 'headacc';
    else if (has(/face|head/)) role = 'face';
    else if (has(/leg|thigh|sock|stock|tight/)) role = 'legs';
    else if (has(/foot|shoe|boot|sneaker/)) role = 'foot';
    else if (has(/top|shirt|jacket|cloth|body|torso|dress|coat|wear/)) role = 'top';
    else role = 'other';
    return { role, side };
  }

  /* ---------- layer bị che hoàn toàn bởi các layer phía trên ---------- */
  // trả về { key: tỉ lệ pixel nhìn thấy (0..1) }
  function coverage(layers, imgs, W, H) {
    const cover = new Float32Array(W * H), res = {};
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i], im = imgs.get(l.key);
      if (!l.visible || !im) continue;
      let own = 0, vis = 0;
      for (let yy = 0; yy < l.h; yy++) {
        const Y = l.y + yy; if (Y < 0 || Y >= H) continue;
        for (let xx = 0; xx < l.w; xx++) {
          const X = l.x + xx; if (X < 0 || X >= W) continue;
          const a = im.alpha[yy * l.w + xx] / 255; if (a <= 0) continue;
          const ci = Y * W + X;
          if (a > .3) { own++; if (cover[ci] < .5) vis++; }
          cover[ci] = 1 - (1 - cover[ci]) * (1 - a);
        }
      }
      res[l.key] = own ? vis / own : 0;
    }
    return res;
  }

  /* ---------- vùng bao & crop ---------- */
  function unionBox(layers) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of layers) { x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x + l.w); y1 = Math.max(y1, l.y + l.h); }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function autoCrop(layers, margin) {
    const b = unionBox(layers.filter(l => l.visible)); if (!b) return { x: 0, y: 0, w: 100, h: 100 };
    return { x: Math.round(b.x - margin.side), y: Math.round(b.y - margin.top), w: Math.round(b.w + margin.side * 2), h: Math.round(b.h + margin.top) };
  }

  /* ---------- Giá trị chuyển động mặc định (lấy từ model Moe đã chạy tốt), tỉ lệ theo chiều cao nhân vật ---------- */
  const REF_H = 996;
  function defaults(k, hasHead) {
    const hs = hasHead ? 'head.rot' : null;
    return {
      torso: { look: { rot: .8, x: 1.5 * k }, voice: { y: -2.5 * k }, breath: { y: -.6 * k, sy: .004 } },
      neck: { look: { rot: 1.2, x: .8 * k } },
      head: { look: { rot: 3.5, x: 2.4 * k, y: 4 * k }, voice: { y: -1.5 * k }, breath: { y: -.8 * k } },
      hair_back: hs ? { spring: { src: hs, gain: 1.3, k: 70, c: 7 }, springY: { src: 'head.ty', gain: .5, k: 70, c: 7 } } : { spring: { src: 'lx', amp: 3, gain: 1.3, k: 70, c: 7 } },
      hair_front: hs ? { spring: { src: hs, gain: .6, k: 100, c: 9 }, springY: { src: 'head.ty', gain: .6, k: 100, c: 9 } } : { spring: { src: 'lx', amp: 3, gain: .6, k: 100, c: 9 } },
      eye: { look: { x: 1.8 * k, y: 3 * k } },
      brow: { look: { x: 1 * k, y: 2.5 * k }, voice: { y: -1.2 * k } },
      mouth: { look: { x: .9 * k, y: 1.8 * k } },
      arm: { spring: { src: 'lx', amp: 4, gain: 1, k: 60, c: 6 } },
      skirt: { spring: { src: 'lx', amp: 3, gain: .6, k: 70, c: 7 } }
    };
  }
  const VS_MOUTH = () => ({ x: [.8, .3], y: [.35, .65], ox: .5, oy: 0 });

  /* ---------- TỰ DỰNG KHUNG XƯƠNG ----------
     Đọc vai trò từ tên layer, tạo khớp + gắn layer + đặt pivot + gán chuyển động mặc định.
     Trả về { report:[...] } và sửa trực tiếp state.nodes / state.layers. */
  function autoRig(state, imgs) {
    const report = [], L = state.layers;
    const roles = {}; // key -> {role, side}
    for (const l of L) roles[l.key] = roleOf(l.srcName || l.id);
    const by = r => L.filter(l => l.visible && roles[l.key].role === r);
    const all = L.filter(l => l.visible);
    const U = unionBox(all); if (!U) return { report: ['Chưa có layer nào.'] };
    const k = clamp(U.h / REF_H, .15, 4), midX = U.x + U.w / 2;
    const cx = l => l.x + l.w / 2, cy = l => l.y + l.h / 2;
    const sideOf = l => roles[l.key].side || (cx(l) > midX ? 'r' : 'l'); // L/R chỉ là nhãn để ghép cặp: theo hậu tố -l/-r của tên layer nếu có, không thì theo vị trí trên màn hình
    const bbox = ls => ls.length ? unionBox(ls) : null;
    const D = defaults(k, true);

    // 1) ẩn layer bị che hoàn toàn (trừ lông mày/tai để phòng tóc đung đưa làm lộ ra)
    const cov = coverage(L, imgs, state.canvas.w, state.canvas.h), hidden = [];
    for (const l of L) if (l.visible && cov[l.key] === 0 && !['brow', 'ear'].includes(roles[l.key].role)) { l.visible = false; hidden.push(l.id); }
    if (hidden.length) report.push('Đã ẩn ' + hidden.length + ' layer bị che hoàn toàn (không bao giờ nhìn thấy): ' + hidden.join(', ') + '. Bật lại trong danh sách nếu cần.');

    // 2) reset rig cũ
    state.nodes = []; for (const l of L) { l.node = null; delete l.show; delete l.blink; delete l.vs; }
    const nodes = state.nodes, get = id => nodes.find(n => n.id === id);
    const mk = (id, parent, pivot, extra) => { nodes.push({ id, parent: parent || null, pivot: [Math.round(pivot[0]), Math.round(pivot[1])], ...JSON.parse(JSON.stringify(extra || {})) }); return id; };

    const top = bbox(by('top')), bottom = bbox(by('bottom')), neck = bbox(by('neck')), face = bbox(by('face'));
    const heads = ['face', 'ear', 'headacc', 'hairBack', 'hairFront', 'iris', 'lash', 'brow', 'mouth', 'mouthOpen', 'bubble', 'eyewhite'].flatMap(by);
    // torso
    let torso = null;
    if (top || bottom || by('arm').length || neck) {
      const ref = top || bottom || neck;
      const py = bottom ? bottom.y + bottom.h * .6 : (top ? top.y + top.h * .85 : ref.y + ref.h);
      torso = mk('torso', null, [cx(ref), py], D.torso);
    }
    // neck
    let neckId = null;
    if (neck) neckId = mk('neck', torso, [neck.x + neck.w / 2, neck.y + neck.h * .83], D.neck);
    // head
    let head = null;
    if (heads.length) {
      const hb = face || bbox(heads), px = neck ? neck.x + neck.w / 2 : hb.x + hb.w / 2;
      head = mk('head', neckId || torso, [px, hb.y + hb.h + 4], D.head);
      // nắn thẳng đầu: đo độ nghiêng từ đường nối hai mắt
      const irs = by('iris').concat(by('eyewhite').length ? [] : []);
      if (irs.length >= 2) {
        const a = [...irs].sort((p, q) => cx(p) - cx(q)), p = a[0], q = a[a.length - 1];
        const ang = Math.atan2(cy(q) - cy(p), cx(q) - cx(p)) * 180 / Math.PI;
        if (Math.abs(ang) > 1.5) { get('head').rest = { rot: clamp(Math.round(-ang * .9 * 2) / 2, -20, 20) }; report.push('Ảnh gốc nghiêng đầu khoảng ' + ang.toFixed(1) + '° → đặt "góc nghiêng mặc định" của đầu = ' + get('head').rest.rot + '° để đầu thẳng (chỉnh lại trong tab Khớp nếu cần).'); }
      }
    }
    const par = head || torso;
    // tóc
    const hb = bbox(by('hairBack')), hf = bbox(by('hairFront'));
    if (hb) mk('hair_back', par, [hb.x + hb.w / 2, hb.y + hb.h * .15], head ? D.hair_back : defaults(k, false).hair_back);
    if (hf) mk('hair_front', par, [hf.x + hf.w / 2, hf.y + hf.h * .15], head ? D.hair_front : defaults(k, false).hair_front);
    // mắt / lông mày / miệng theo bên màn hình
    const nodeFor = {};
    const sideNode = (role, prefix, extra) => {
      for (const l of by(role)) {
        const s = sideOf(l), id = prefix + (s === 'l' ? 'L' : 'R');
        if (!get(id)) {
          const grp = by(role).filter(x => sideOf(x) === s), b = bbox(grp);
          mk(id, par, [b.x + b.w / 2, b.y + b.h / 2], extra);
        }
        nodeFor[l.key] = id;
      }
    };
    sideNode('iris', 'eye', D.eye); sideNode('eyewhite', 'eye', D.eye);
    sideNode('lash', 'eye', D.eye);
    // mắt/mi chưa có iris cùng bên: pivot theo chính nó (đã được sideNode tạo)
    sideNode('brow', 'brow', D.brow);
    const mouths = by('mouth').concat(by('mouthOpen'));
    if (mouths.length) { const b = bbox(by('mouth').length ? by('mouth') : mouths); mk('mouth', par, [b.x + b.w / 2, b.y + b.h / 2], D.mouth); }
    // tay
    for (const l of by('arm')) {
      const s = sideOf(l), id = 'arm' + (s === 'l' ? 'L' : 'R');
      if (!get(id)) { const b = bbox(by('arm').filter(x => sideOf(x) === s)); const inward = (b.x + b.w / 2) > midX ? -1 : 1; mk(id, torso, [b.x + b.w / 2 + inward * b.w * .16, b.y + b.h * .04], D.arm); }
      nodeFor[l.key] = id;
    }
    // váy
    const sk = bbox(by('bottom').concat(by('bottomBack')));
    if (sk) mk('skirt', torso, [sk.x + sk.w / 2, sk.y + sk.h * .06], D.skirt);

    // 3) gắn layer vào khớp + hiệu ứng sprite
    const irisByNode = {}; for (const l of by('iris')) irisByNode[nodeFor[l.key]] = l;
    const hasOpen = by('mouthOpen').length > 0;
    for (const l of all.filter(l => l.visible)) {
      const { role } = roles[l.key];
      let node = null;
      switch (role) {
        case 'hairBack': node = hb ? 'hair_back' : null; break;
        case 'hairFront': node = hf ? 'hair_front' : null; break;
        case 'face': case 'ear': case 'headacc': node = head; break;
        case 'iris': case 'eyewhite': case 'lash': case 'brow': node = nodeFor[l.key] || null; break;
        case 'mouth': case 'mouthOpen': node = get('mouth') ? 'mouth' : null; break;
        case 'bubble': node = head; break;
        case 'neck': node = neckId; break;
        case 'top': node = torso; break;
        case 'arm': node = nodeFor[l.key] || null; break;
        case 'bottom': case 'bottomBack': node = get('skirt') ? 'skirt' : null; break;
        default: node = null;
      }
      l.node = node;
      if (role === 'iris' || role === 'eyewhite') l.blink = { sq: 1 };
      if (role === 'lash') { const ir = irisByNode[nodeFor[l.key]]; l.blink = { dy: Math.max(2, Math.round((ir ? ir.h : l.h * 2) * .3)) }; }
      if (role === 'bubble') l.show = 'emote';
      if (role === 'mouthOpen') { l.show = 'talk'; l.vs = VS_MOUTH(); }
      if (role === 'mouth' && hasOpen) l.show = '!talk';
    }
    // layer "back bottom" phải nằm DƯỚI chân; tay phải nằm TRÊN váy ngoài: chỉ báo, không tự đảo thứ tự
    if (!hasOpen && by('mouth').length) report.push('Không thấy layer miệng mở → model sẽ chỉ có miệng đóng khi nói. Hãy nhập thêm 1 ảnh miệng mở rồi bấm "Preset: miệng mở" trong tab Layer.');
    if (!by('iris').length) report.push('Không nhận ra layer mắt (tên chứa "iris/irides/eye") → chưa có hiệu ứng chớp mắt.');
    if (!face) report.push('Không nhận ra layer mặt (tên chứa "face") → khớp đầu có thể đặt chưa chính xác.');
    const un = all.filter(l => l.visible && !l.node).map(l => l.id);
    if (un.length) report.push(un.length + ' layer đứng yên (chưa gắn khớp): ' + un.join(', ') + '. Kéo-thả hoặc dùng "Gắn vào khớp" nếu muốn chúng chuyển động.');
    report.push('Đã tạo ' + nodes.length + ' khớp: ' + nodes.map(n => n.id).join(', ') + '. Kiểm tra bằng "Xem thử" và kéo các chấm pivot cho chuẩn.');
    return { report };
  }

  /* ---------- Sinh danh sách thanh kéo (tune) từ khớp hiện có ---------- */
  const MASTERS = [
    { k: 'm_look', label: 'Mức dịch theo chuột (nhân chung)', group: 'Tổng thể (chỉnh nhanh)', min: 0, max: 2.5, step: .05, g: 'look', def: 1 },
    { k: 'm_voice', label: 'Mức nảy khi nói (nhân chung)', group: 'Tổng thể (chỉnh nhanh)', min: 0, max: 2.5, step: .05, g: 'voice', def: 1 },
    { k: 'm_breath', label: 'Mức nhịp thở (nhân chung)', group: 'Tổng thể (chỉnh nhanh)', min: 0, max: 3, step: .05, g: 'breath', def: 1 },
    { k: 'm_spring', label: 'Mức đung đưa tóc/tay/váy (nhân chung)', group: 'Tổng thể (chỉnh nhanh)', min: 0, max: 2.5, step: .05, g: 'spring', def: 1 },
    { k: 'm_range', label: 'Độ nhạy chuột (to = chạm cực nhanh hơn)', group: 'Theo dõi chuột & phản hồi', min: .3, max: 3, step: .05, g: 'range', def: 1 },
    { k: 'm_follow', label: 'Tốc độ đầu đuổi theo chuột', group: 'Theo dõi chuột & phản hồi', min: .03, max: .6, step: .01, g: 'follow', def: .15 },
    { k: 'm_vfollow', label: 'Tốc độ phản ứng với giọng nói', group: 'Theo dõi chuột & phản hồi', min: .1, max: 1, step: .01, g: 'vfollow', def: .4 }
  ];
  const KINDS = [[/^torso/, 'Thân', 'Thân & nảy khi nói'], [/^neck/, 'Cổ', 'Đầu & cổ'], [/^head/, 'Đầu', 'Đầu & cổ'], [/^hair_?back/, 'Tóc sau', 'Tóc'],
    [/^hair_?front/, 'Tóc trước', 'Tóc'], [/^eye/, 'Mắt', 'Mắt & miệng'], [/^brow/, 'Lông mày', 'Mắt & miệng'], [/^mouth/, 'Miệng', 'Mắt & miệng'],
    [/^arm/, 'Tay áo', 'Tay áo & váy'], [/^skirt/, 'Váy', 'Tay áo & váy']];
  const GROUP_ORDER = ['Tổng thể (chỉnh nhanh)', 'Theo dõi chuột & phản hồi', 'Đầu & cổ', 'Mắt & miệng', 'Thân & nảy khi nói', 'Tóc', 'Tay áo & váy', 'Khác'];
  const PSPEC = [
    ['rest.rot', 'độ nghiêng mặc định (°)', -30, 30, .1, 'sym'], ['look.x', 'dịch ngang theo chuột (px)', 10, null, .1], ['look.y', 'dịch dọc theo chuột (px)', 10, null, .1],
    ['look.rot', 'xoay theo chuột (°)', 12, null, .1], ['voice.y', 'nảy khi nói (px)', 10, null, .1], ['voice.sy', 'giãn dọc khi nói', .2, null, .005],
    ['breath.y', 'nhịp thở: nhấp nhô (px)', 4, null, .1], ['breath.sy', 'nhịp thở: phập phồng', .015, null, .0005],
    ['spring.gain', 'độ đung đưa', 4, null, .05], ['spring.amp', 'biên độ phản ứng khi chuột lệch', 10, null, .1], ['spring.k', 'độ cứng (cao = lắc nhanh)', 20, 250, 1, 'range'],
    ['spring.c', 'giảm chấn (cao = nhanh dừng)', 1, 30, .5, 'range'], ['springY.gain', 'nhún theo chuyển động dọc', 3, null, .05]
  ];
  function getP(n, path) { let o = n; for (const p of path.split('.')) { o = o && o[p]; } return typeof o === 'number' ? o : undefined; }
  const niceMax = (base, v) => { const m = Math.max(base, Math.abs(v) * 4); const mag = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / mag * 2) / 2 * mag; };
  function buildTune(nodes) {
    // gộp cặp L/R có cùng giá trị thành một thanh kéo
    const baseOf = n => /[LR]$/.test(n.id) && nodes.some(m => m.id === n.id.slice(0, -1) + (n.id.endsWith('L') ? 'R' : 'L')) ? n.id.slice(0, -1) : n.id;
    const groupsN = new Map();
    for (const n of nodes) { const b = baseOf(n); if (!groupsN.has(b)) groupsN.set(b, []); groupsN.get(b).push(n); }
    const out = [], usedK = new Set();
    for (const [base, ns] of groupsN) {
      const kind = KINDS.find(x => x[0].test(base)) || [null, base, 'Khác'];
      for (const [path, label, a, b, step, mode] of PSPEC) {
        if (path === 'spring.k' || path === 'spring.c') { if (getP(ns[0], path) === undefined) continue; }
        const vals = ns.map(n => getP(n, path)); if (vals.some(v => v === undefined)) continue;
        if (vals.some(v => Math.abs(v - vals[0]) > 1e-9)) { // L/R khác nhau: tách riêng từng khớp
          ns.forEach((n, i) => pushRow(n.id, [n], vals[i]));
        } else pushRow(base, ns, vals[0]);
        function pushRow(name, group, v) {
          let min, max, sign;
          if (mode === 'sym') { min = a; max = b; }
          else if (mode === 'range') { min = a; max = Math.max(b, Math.ceil(v * 2)); }
          else { const neg = v < 0 && /^(voice|breath)\.y$/.test(path); sign = neg ? -1 : 1; const val = v * sign; const N = niceMax(a, val); if (path.endsWith('.sy') || val >= 0) { min = 0; max = N; } else { min = -N; max = 0; } }
          let key = (name + '_' + path.replace('.', '_')).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40), i = 2; const k0 = key;
          while (usedK.has(key)) key = k0.slice(0, 38) + i++; usedK.add(key);
          const set = group.map(n => n.id + '.' + path);
          // k, c của lò xo dọc đi chung với lò xo xoay nếu cùng giá trị
          if (path === 'spring.k' || path === 'spring.c') for (const n of group) { const y = n.springY && n.springY[path.split('.')[1]]; if (y !== undefined && Math.abs(y - v) < 1e-9) set.push(n.id + '.springY.' + path.split('.')[1]); }
          out.push({ k: key, label: kind[1] + (name !== base ? ' (' + name + ')' : '') + ': ' + label, group: kind[2], min: r3(min), max: r3(max), step, set, ...(sign === -1 ? { sign: -1 } : {}) });
        }
      }
    }
    out.sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group));
    return MASTERS.map(m => ({ ...m })).concat(out);
  }

  /* ---------- Dựng model.json từ state ---------- */
  const NODE_FIELDS = ['rest', 'look', 'voice', 'breath', 'spring', 'springY'];
  const roundObj = o => { if (Array.isArray(o)) return o.map(roundObj); if (o && typeof o === 'object') { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = roundObj(v); return r; } return typeof o === 'number' ? r3(o) : o; };
  function sortedNodes(nodes) { // cha luôn đứng trước con
    const out = [], done = new Set(), byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    const visit = (n, stack = []) => { if (done.has(n.id) || stack.includes(n.id)) return; if (n.parent && byId[n.parent]) visit(byId[n.parent], [...stack, n.id]); done.add(n.id); out.push(n); };
    nodes.forEach(n => visit(n)); return out;
  }
  function buildModel(state, opts = {}) {
    const vis = state.layers.filter(l => l.visible);
    const nodes = sortedNodes(state.nodes).map(n => {
      const o = { id: n.id }; if (n.parent && state.nodes.some(m => m.id === n.parent)) o.parent = n.parent;
      o.pivot = [Math.round(n.pivot[0]), Math.round(n.pivot[1])];
      for (const f of NODE_FIELDS) if (n[f] && Object.keys(n[f]).length) o[f] = roundObj(n[f]);
      return o;
    });
    const nids = new Set(nodes.map(n => n.id));
    const ext = opts.ext || 'png';
    const srcOf = opts.srcOf || ((l, i) => (l.show === 'talk' || l.show === 'emote' ? 'assets/emo/' + l.id + '.' + ext : 'assets/layer/' + String(i).padStart(3, '0') + '_' + l.id + '.' + ext));
    const sprites = vis.map((l, i) => {
      const s = { id: l.id, src: srcOf(l, i), node: l.node && nids.has(l.node) ? l.node : null, x: Math.round(l.x), y: Math.round(l.y), w: l.w, h: l.h };
      if (l.show) s.show = l.show; if (l.blink) s.blink = roundObj(l.blink); if (l.vs) s.vs = roundObj(l.vs);
      return s;
    });
    const crop = state.cropAuto === false && state.crop ? state.crop : autoCrop(state.layers, state.margin);
    const model = { format: 1, name: state.name, crop, nodes, sprites };
    model.tune = opts.autoTune === false && state.tune ? sanitizeTune(state.tune, nids) : buildTune(nodes);
    return model;
  }
  function sanitizeTune(tune, nids) {
    return tune.filter(d => d.g || (Array.isArray(d.set) && d.set.every(p => nids.has(String(p).split('.')[0]))));
  }

  /* ---------- Kiểm tra hợp lệ: PHẢI khớp với validateModel trong main.js của Ezy Tuber ---------- */
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const MASTER_KEYS = ['look', 'voice', 'breath', 'spring', 'range', 'follow', 'vfollow'], BAD_SEG = new Set(['__proto__', 'constructor', 'prototype']);
  const safeRel = p => typeof p === 'string' && p.length > 0 && p.length < 260 && !/^([A-Za-z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes('..');
  function validateModel(r, fileExists) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return 'model.json phải là một object';
    const c = r.crop;
    if (!c || ![c.x, c.y, c.w, c.h].every(isNum) || c.w <= 0 || c.h <= 0) return 'Sai "crop"';
    const nodes = r.nodes === undefined ? [] : r.nodes, ids = new Set();
    for (const n of nodes) {
      if (!n || typeof n.id !== 'string' || !ID_RE.test(n.id)) return 'Khớp có id sai: ' + JSON.stringify(n && n.id);
      if (ids.has(n.id)) return 'Trùng id khớp: ' + n.id;
      if (n.parent != null && !ids.has(n.parent)) return 'Khớp "' + n.id + '": cha "' + n.parent + '" không tồn tại hoặc nằm sau';
      if (!Array.isArray(n.pivot) || n.pivot.length !== 2 || !n.pivot.every(isNum)) return 'Khớp "' + n.id + '": thiếu pivot';
      ids.add(n.id);
    }
    if (!Array.isArray(r.sprites) || !r.sprites.length) return 'Chưa có layer nào để xuất';
    const sids = new Set();
    for (const s of r.sprites) {
      if (!s || typeof s.id !== 'string' || !ID_RE.test(s.id)) return 'Sprite có id sai: ' + JSON.stringify(s && s.id);
      if (sids.has(s.id)) return 'Trùng id sprite: ' + s.id; sids.add(s.id);
      if (!safeRel(s.src)) return 'Sprite "' + s.id + '": src không hợp lệ';
      if (![s.x, s.y, s.w, s.h].every(isNum) || s.w <= 0 || s.h <= 0) return 'Sprite "' + s.id + '": x,y,w,h sai';
      if (s.node != null && !ids.has(s.node)) return 'Sprite "' + s.id + '": khớp "' + s.node + '" không tồn tại';
      if (fileExists && !fileExists(s.src)) return 'Thiếu ảnh: ' + s.src;
    }
    if (r.tune !== undefined) {
      const ks = new Set();
      for (const d of r.tune) {
        if (!d || typeof d.k !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(d.k)) return 'Thanh kéo có k sai: ' + JSON.stringify(d && d.k);
        if (ks.has(d.k)) return 'Trùng k thanh kéo: ' + d.k; ks.add(d.k);
        if (typeof d.label !== 'string' || typeof d.group !== 'string') return 'Thanh kéo "' + d.k + '": thiếu label/group';
        if (![d.min, d.max, d.step].every(isNum) || d.step <= 0 || d.max <= d.min) return 'Thanh kéo "' + d.k + '": min/max/step sai';
        if (d.g !== undefined) { if (!MASTER_KEYS.includes(d.g) || !isNum(d.def)) return 'Thanh kéo "' + d.k + '": g/def sai'; }
        else {
          if (!Array.isArray(d.set) || !d.set.length) return 'Thanh kéo "' + d.k + '": thiếu set';
          for (const p of d.set) { const a = typeof p === 'string' ? p.split('.') : []; if (a.length < 2 || a.length > 4 || a.some(x => !/^[A-Za-z0-9_\-]+$/.test(x) || BAD_SEG.has(x)) || !ids.has(a[0])) return 'Thanh kéo "' + d.k + '": đường dẫn "' + p + '" sai'; }
        }
      }
    }
    return null;
  }

  const API = { ID_RE, strip, clamp, natural, sanitizeId, uniqueId, safeFolderName, roleOf, coverage, unionBox, autoCrop, autoRig, buildTune, buildModel, sortedNodes, validateModel, MASTERS, PSPEC, REF_H };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RigTools = API;
})(typeof window !== 'undefined' ? window : globalThis);
