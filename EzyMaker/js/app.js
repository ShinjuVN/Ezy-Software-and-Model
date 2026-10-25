/* Ezy Maker — khởi tạo và nối các thao tác */
(function () {
  App.state = App.newState();
  Editor.init($('#cv'));
  App.commit();
  const on = (id, fn) => $(id).addEventListener('click', fn);

  /* ---- nhập / mở / xuất ---- */
  on('#bImport', () => $('#fIn').click()); on('#bImportDir', () => $('#fDir').click()); on('#bOpen', () => Panels.openModelDialog());
  for (const id of ['#fIn', '#fDir', '#fOpen']) $(id).addEventListener('change', e => { const f = filesFromInput(e.target); e.target.value = ''; if (f.length) App.importFiles(f); });
  on('#bAuto', () => App.autoRig()); on('#bCovered', () => App.findCovered()); on('#bExport', () => App.exportZip());
  on('#bUndo', () => App.undo()); on('#bRedo', () => App.redo());
  $('#mname').addEventListener('change', e => { App.state.name = e.target.value.trim() || 'Model'; App.commit(); });

  /* ---- kéo thả file ---- */
  const center = $('#center');
  for (const t of [document.body]) {
    t.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); center.classList.add('dragover'); } });
    t.addEventListener('dragleave', e => { if (!e.relatedTarget) center.classList.remove('dragover'); });
    t.addEventListener('drop', async e => { center.classList.remove('dragover'); if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); const f = await filesFromDrop(e.dataTransfer);
      if (App.mode === 'preview') { const img = f.find(x => /\.(png|jpe?g|webp|gif|bmp)$/i.test(x.path)); if (img) { await Preview.setBgFile(img.blob); Panels.renderRight(); } else App.status('Đang ở chế độ xem thử: chỉ nhận file ảnh để làm nền. Quay lại chỉnh sửa để nhập layer.', 'warn'); return; }
      if (f.length) App.importFiles(f); });
  }

  /* ---- ảnh nền xem thử (chọn từ máy) ---- */
  $('#fBg').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { await Preview.setBgFile(f); Panels.renderRight(); } });

  /* ---- thanh công cụ canvas ---- */
  on('#zFit', () => Editor.fit()); on('#z100', () => Editor.setZoom(1)); on('#zIn', () => Editor.setZoom(Editor.zoom * 1.25)); on('#zOut', () => Editor.setZoom(Editor.zoom / 1.25));
  $('#tNodes').onchange = e => { Editor.showNodes = e.target.checked; Editor.draw(); };
  $('#tCrop').onchange = e => { Editor.showCrop = e.target.checked; Editor.draw(); };
  $('#tIso').onchange = e => { Editor.isolate = e.target.checked; Editor.draw(); };

  /* ---- danh sách layer ---- */
  on('#lUp', () => Panels.moveSel('up')); on('#lDown', () => Panels.moveSel('down')); on('#lTop', () => Panels.moveSel('top')); on('#lBottom', () => Panels.moveSel('bottom'));
  on('#lVis', () => Panels.toggleVis()); on('#lDel', () => Panels.deleteSel());
  $('#layerFilter').addEventListener('input', e => { Panels.filter = e.target.value; Panels.renderLayers(); });
  on('#nAdd', () => Panels.addNode());
  on('#nAssign', () => { if (!App.sel.node) { App.status('Hãy chọn một khớp trong cây trước.', 'warn'); return; } Panels.assign(App.sel.node); });
  document.querySelectorAll('#ltabs button').forEach(b => b.onclick = () => { Panels.ltab = b.dataset.t; Panels.render(); });
  document.querySelectorAll('#rtabs button').forEach(b => b.onclick = () => { Panels.rtab = b.dataset.t; Panels.renderRight(); document.querySelectorAll('#rtabs button').forEach(x => x.classList.toggle('on', x === b)); });

  /* ---- chế độ xem thử ---- */
  function setMode(m) {
    if (m === 'preview') {
      if (!App.state.layers.some(l => l.visible)) { App.status('Chưa có layer nào để xem thử.', 'warn'); return; }
      try { App.mode = 'preview'; Preview.start(); } catch (e) { App.mode = 'edit'; console.error(e); App.status('Không xem thử được: ' + e.message, 'err'); return; }
      $('#ctools').hidden = true; $('#hint').textContent = 'Xem thử: di chuột trong khung để model nhìn theo chuột';
    } else { Preview.stop(); App.mode = 'edit'; $('#ctools').hidden = false; $('#hint').textContent = 'Cuộn chuột: phóng to/thu nhỏ • Giữ Space hoặc chuột giữa/phải: kéo khung nhìn • Kéo thả file/zip/thư mục vào đây để nhập'; }
    Panels.render(); Editor.draw();
  }
  App.setMode = setMode;
  on('#bMode', () => setMode(App.mode === 'preview' ? 'edit' : 'preview'));

  /* ---- phím tắt ---- */
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range';
  addEventListener('keydown', e => {
    if ($('#modal')) { if (e.key === 'Escape') $('#modal').remove(); return; }
    if (typing(e)) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === ' ' && App.mode === 'edit') { Editor.space = true; Editor.cv.style.cursor = 'grab'; e.preventDefault(); return; }
    if (App.mode !== 'edit') { if (k === 'Escape') setMode('edit'); return; }
    if (ctrl && k.toLowerCase() === 'z') { e.shiftKey ? App.redo() : App.undo(); e.preventDefault(); }
    else if (ctrl && k.toLowerCase() === 'y') { App.redo(); e.preventDefault(); }
    else if (ctrl && k.toLowerCase() === 'a') { App.sel.layers = new Set(App.state.layers.filter(l => l.visible).map(l => l.key)); Panels.focus('layer'); App.refresh(); e.preventDefault(); }
    else if (k === 'Delete' || k === 'Backspace') { if (App.sel.layers.size) Panels.deleteSel(); else if (App.sel.node) Panels.deleteNode(); e.preventDefault(); }
    else if (k === 'Escape') { App.sel = { layers: new Set(), node: null }; App.refresh(); }
    else if (k.toLowerCase() === 'f' && !ctrl) Editor.fit();
    else if (k.startsWith('Arrow') && (App.sel.layers.size || App.sel.node)) { const s = e.shiftKey ? 10 : 1; Editor.nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0); e.preventDefault(); }
  });
  addEventListener('keyup', e => { if (e.key === ' ') { Editor.space = false; Editor.cv.style.cursor = 'default'; } });
  addEventListener('resize', () => Editor.resize());
  Panels.render(); Editor.fit();
})();
