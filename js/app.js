/*
 * app.js — Ghép mọi thứ lại.
 *
 * Luồng: DWG nhúng sẵn (base64) -> LibreDWG WASM -> DXF -> parse -> khoá chỉ đọc
 *        -> viewer -> layer/layout -> watermark -> DRM -> xuất PDF.
 * Người dùng cũng mở được file .dwg khác từ máy; đọc tại chỗ, không upload.
 */
(function () {
  'use strict';

  /* ---------- Hồ sơ người xem (thực tế lấy từ phiên đăng nhập) ---------- */
  var USER = {
    name: 'Nguyễn Văn An',
    email: 'nguyenvanan@nhathau-me.vn',
    phone: '0912***456',
    role: 'Nhà thầu M&E',
    company: 'CÔNG TY CP XÂY DỰNG DEMO'
  };
  var DOC = {
    title: 'Mặt bằng bố trí nội thất — Căn hộ A-01.02',
    code: 'KT-02-A0102',
    rev: 'C'
  };

  /* ---------- Layout: mỗi layout = một tổ hợp layer ---------- */
  var LAYOUTS = [
    { id: 'a3', name: 'Layout A3 — Bản in đầy đủ', desc: 'Toàn bộ layer, có khung tên', hide: [] },
    { id: 'model', name: 'Model — Mặt bằng', desc: 'Chỉ phần bản vẽ, ẩn khung tên', hide: ['KHUNG_TEN'] },
    { id: 'kt', name: 'Kiến trúc — Không nội thất', desc: 'Ẩn thiết bị, hatch và khung tên', hide: ['KHUNG_TEN', 'THIET_BI', 'HATCH'] },
    { id: 'dim', name: 'Trục &amp; kích thước', desc: 'Chỉ tường, trục định vị và kích thước', hide: ['KHUNG_TEN', 'THIET_BI', 'HATCH', 'VAN_BAN', 'CUA_SO'] }
  ];
  var LAYER_LABEL = {
    'TUONG': 'Tường', 'CUA_SO': 'Cửa đi / cửa sổ', 'THIET_BI': 'Thiết bị — Nội thất',
    'HATCH': 'Hatch sàn', 'TRUC': 'Trục định vị', 'KICH_THUOC': 'Kích thước',
    'VAN_BAN': 'Văn bản — Ghi chú', 'KHUNG_TEN': 'Khung tên', '0': 'Layer 0'
  };

  var $ = function (id) { return document.getElementById(id); };
  var sessionId = genSession();
  var startedAt = new Date();
  var violations = [];

  /* ================= 1. Watermark (định danh người xem — cố định) ================= */
  var wm = {
    text: 'NGUYỄN VĂN AN · 0912***456',
    sub: fmtTime(startedAt) + '  ·  ' + sessionId,
    opacity: 0.13,
    size: 42,
    color: '#ffffff'
  };

  /* ================= 2. Trạng thái tài liệu đang mở ================= */
  var doc = null;          // cây dữ liệu bản vẽ (đã đóng băng)
  var viewer = null;       // trình xem
  var currentLayout = null;
  var layerRows = {};
  var srcInfo = { format: 'DWG', version: 'AutoCAD 2000', name: 'MB-CH-A0102' };

  var layoutBox = $('layouts');
  var layerBox = $('layers');

  /* Layout dựng sẵn chỉ đúng với bản vẽ mẫu. File người dùng mở lên có tên layer
     khác hẳn, nên khi đó chuyển sang một layout duy nhất "toàn bộ bản vẽ". */
  function layoutsFor(d) {
    var known = ['TUONG', 'KHUNG_TEN', 'THIET_BI', 'KICH_THUOC'];
    var hit = known.filter(function (n) { return d.layers[n]; }).length;
    if (hit >= 3) return LAYOUTS;
    return [{ id: 'all', name: 'Toàn bộ bản vẽ', desc: 'Hiển thị mọi layer trong file', hide: [] }];
  }

  /*
   * Nạp bản vẽ mới. Tham số là chuỗi DXF do LibreDWG WASM sinh ra từ file DWG
   * (DXF ở đây chỉ là định dạng trung gian trong bộ nhớ, không lộ ra giao diện).
   * Viewer cũ bị bỏ, dựng lại từ đầu.
   */
  function loadDocument(dxfText, info) {
    var d = window.DXF.parse(dxfText);
    if (!d.entities.length) throw new Error('File không có đối tượng nào để hiển thị.');

    /* Chỉ đọc thật sự: đóng băng toàn bộ cây dữ liệu. Sau lệnh này mọi phép
       ghi/xoá lên entity đều bị JS bỏ qua (và ném lỗi ở strict mode). */
    deepFreeze(d.entities);
    deepFreeze(d.layers);
    Object.freeze(d.extents);

    doc = d;
    srcInfo = info;

    viewer = new window.Viewer($('cad'), doc, {
      bg: '#1e2532',
      watermark: wm,
      onCoord: function (w) {
        $('ov-coord').textContent = w
          ? 'X: ' + fmt(w.x) + '   Y: ' + fmt(w.y)
          : 'X: —   Y: —';
      }
    });

    buildLayouts(layoutsFor(doc));
    buildLayerList();
    viewer.applyLayout(currentLayout);
    viewer.fit();
    paintDocInfo();
  }

  /* -- danh sách layout -- */
  function buildLayouts(list) {
    currentLayout = list[0];
    if (!layoutBox) return;
    layoutBox.innerHTML = '';
    list.forEach(function (L, i) {
      var el = document.createElement('label');
      el.className = 'layout-item' + (i === 0 ? ' on' : '');
      el.innerHTML = '<input type="radio" name="lay" ' + (i === 0 ? 'checked' : '') + '>' +
        '<div><b>' + L.name + '</b><span>' + L.desc + '</span></div>';
      el.querySelector('input').addEventListener('change', function () {
        [].forEach.call(layoutBox.children, function (c) { c.classList.remove('on'); });
        el.classList.add('on');
        viewer.applyLayout(L);
        syncLayerList();
        viewer.fit();
        currentLayout = L;
      });
      layoutBox.appendChild(el);
    });
  }

  /* -- danh sách layer -- */
  function buildLayerList() {
    layerRows = {};
    if (!layerBox) return;
    var counts = {};
    doc.entities.forEach(function (e) { counts[e.layer] = (counts[e.layer] || 0) + 1; });
    layerBox.innerHTML = '';
    Object.keys(doc.layers).sort().forEach(function (name) {
      var ly = doc.layers[name];
      var row = document.createElement('label');
      row.className = 'layer';
      row.innerHTML =
        '<input type="checkbox" checked>' +
        '<span class="swatch" style="background:' + ly.color + '"></span>' +
        '<span class="nm"></span>' +
        '<span class="ct">' + (counts[name] || 0) + '</span>';
      row.querySelector('.nm').textContent = LAYER_LABEL[name] || name;
      var cb = row.querySelector('input');
      cb.addEventListener('change', function () {
        viewer.setLayerVisible(name, cb.checked);
        row.classList.toggle('off', !cb.checked);
      });
      layerBox.appendChild(row);
      layerRows[name] = { row: row, cb: cb };
    });
  }

  function syncLayerList() {
    Object.keys(layerRows).forEach(function (n) {
      var on = viewer.isLayerVisible(n);
      layerRows[n].cb.checked = on;
      layerRows[n].row.classList.toggle('off', !on);
    });
  }

  if ($('lay-all')) {
    $('lay-all').addEventListener('click', function () {
      Object.keys(layerRows).forEach(function (n) { viewer.setLayerVisible(n, true); });
      syncLayerList(); viewer.render();
    });
  }

  /* ================= 3. Mở file DWG khác (đọc tại máy, không upload) ================= */
  if ($('btn-open') && $('file-input')) {
    $('btn-open').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      openFile(f);
    });
  }

  /* kéo thả file vào vùng vẽ */
  var main = document.querySelector('.main');
  ['dragenter', 'dragover'].forEach(function (ev) {
    main.addEventListener(ev, function (e) { e.preventDefault(); main.classList.add('drop'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    main.addEventListener(ev, function (e) { e.preventDefault(); main.classList.remove('drop'); });
  });
  main.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  function openFile(file) {
    var nm = file.name;
    if (!/\.dwg$/i.test(nm)) {
      window.DRM.toast('Chỉ nhận file .dwg', 'block');
      return;
    }
    setBusy('Đang đọc ' + nm + '…');
    var fr = new FileReader();
    fr.onerror = function () { setBusy(null); window.DRM.toast('Không đọc được file.', 'block'); };
    fr.onload = function () {
      window.DWGLoader.toDxf(fr.result)
        .then(function (r) {
          loadDocument(r.dxf, {
            format: r.format,
            version: r.version,
            name: nm.replace(/\.[^.]+$/, '')
          });
          setBusy(null);
          window.DRM.toast('Đã mở ' + nm + ' · ' + r.version + ' · ' +
            doc.entities.length + ' đối tượng · ' + r.ms + ' ms', 'ok');
          logViolation('open-file', nm + ' (' + r.format + ')');
        })
        .catch(function (err) {
          setBusy(null);
          window.DRM.toast('Lỗi: ' + err.message, 'block');
        });
    };
    fr.readAsArrayBuffer(file);
  }

  function setBusy(msg) {
    var el = $('busy');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function paintDocInfo() {
    $('ent-count').textContent = doc.entities.length;
    $('st-size').textContent = Object.keys(doc.layers).length + ' layer';
    $('st-format').textContent = 'DWG nhị phân · ' + srcInfo.version;
    $('doc-name').textContent = srcInfo.name;
    $('badge-fmt').textContent = srcInfo.format;
  }

  /* ================= 5. Thanh công cụ ================= */
  $('btn-fit').addEventListener('click', function () { viewer.fit(); });
  $('t-fit').addEventListener('click', function () { viewer.fit(); });
  $('t-zin').addEventListener('click', function () { viewer.zoomAt(viewer.W / 2, viewer.H / 2, 1.3); });
  $('t-zout').addEventListener('click', function () { viewer.zoomAt(viewer.W / 2, viewer.H / 2, 1 / 1.3); });
  $('t-grid').addEventListener('click', function () {
    viewer.opts.grid = viewer.opts.grid === false;
    viewer.render();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.target.tagName === 'INPUT') return;
    if (ev.key === 'f' || ev.key === 'F') viewer.fit();
  });

  /* ================= 6. DRM — bật cố định, không có công tắc tắt ================= */
  window.DRM.init({
    wipeNote: 'Anh chup man hinh da bi vo hieu hoa - ban ve ' + DOC.code +
      ' thuoc tai lieu kiem soat - cap cho ' + USER.email + ' - phien ' + sessionId,
    /* In lên chính tấm ảnh cảnh báo dán đè vào clipboard: ai chụp, bản vẽ nào, lúc nào */
    wipeLines: [
      'Bản vẽ: ' + DOC.code + ' Rev.' + DOC.rev,
      'Cấp cho: ' + USER.name + ' · ' + USER.email,
      'Phiên xem: ' + sessionId + ' · ' + fmtTime(startedAt)
    ],
    onViolation: logViolation
  });

  function logViolation(type, detail) {
    violations.push({ t: new Date(), type: type, detail: detail });
    $('log-count').textContent = violations.length;
    var box = $('viol-log');
    if (box) {
      if (violations.length === 1) box.innerHTML = '';
      var line = document.createElement('div');
      line.textContent = fmtClock(new Date()) + '  ' + type + (detail ? ' (' + detail + ')' : '');
      line.style.color = '#8b6f4a';
      box.insertBefore(line, box.firstChild);
      while (box.children.length > 12) box.removeChild(box.lastChild);
    }
    /* Thực tế: POST /api/audit {user, doc, type, detail, ts} — không chặn được nhưng ghi được vết */
  }

  /* ================= 7. Xuất PDF ================= */
  var xPaper = 'a3', xMode = 'bw';
  bindSeg('seg-paper', function (v) { xPaper = v; });
  bindSeg('seg-mode', function (v) { xMode = v; });
  function bindSeg(id, cb) {
    var box = $(id);
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      [].forEach.call(box.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      cb(b.dataset.v);
    });
  }

  $('btn-export').addEventListener('click', function () { $('modal').classList.add('on'); });
  $('x-cancel').addEventListener('click', function () { $('modal').classList.remove('on'); });
  $('modal').addEventListener('click', function (ev) {
    if (ev.target === this) this.classList.remove('on');
  });

  $('x-go').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Đang kết xuất…';
    setTimeout(function () {
      try {
        var now = new Date();
        /* Cố định: chỉ kết xuất các layer đang hiển thị — không còn tuỳ chọn trong giao diện. */
        var r = window.ExportPDF.run(doc, viewer, {
          user: USER.name + ' <' + USER.email + '>',
          company: USER.company,
          title: DOC.title,
          docCode: DOC.code + ' Rev.' + DOC.rev,
          layoutName: stripTags(currentLayout.name),
          time: fmtTime(now),
          paper: xPaper,
          mode: xMode,
          /* Chính sách cố định — không có tuỳ chọn tắt trong giao diện:
             mọi bản PDF xuất ra đều có watermark và cờ cấm in / cấm sao chép. */
          protect: true,
          watermarkText: wm.text,
          watermarkSub: fmtTime(now) + ' · ' + USER.email,
          wmOpacity: 0.14
        });
        r.pdf.save(DOC.code + '_' + USER.email.split('@')[0] + '_' + r.traceId + '.pdf');
        $('modal').classList.remove('on');
        window.DRM.toast('Đã xuất PDF · ' + r.count + ' đối tượng · mã tra vết ' + r.traceId, 'ok');
        logViolation('export-pdf', r.traceId);
      } catch (err) {
        window.DRM.toast('Lỗi kết xuất: ' + err.message, 'block');
        console.error(err);
      }
      btn.disabled = false; btn.textContent = 'Kết xuất & tải về';
    }, 60);
  });

  /* ================= 8. Định danh người xem hiển thị trên giao diện ================= */
  $('u-name').textContent = USER.name;
  $('u-role').textContent = USER.role + ' · Quyền: XEM + TẢI PDF';
  $('ava').textContent = initials(USER.name);
  $('ov-user').textContent = USER.email;
  $('ov-session').textContent = sessionId;

  /* ================= 9. Nạp bản vẽ DWG mặc định ================= */
  if (!window.EMBEDDED_DWG) {
    fatal('Không tìm thấy bản vẽ nhúng (data/drawing.js).<br>Chạy: node tools/gen-dxf.js && node tools/make-dwg.js');
    return;
  }

  setBusy('Đang mở bản vẽ DWG…');
  var dwgBytes = b64ToBuffer(window.EMBEDDED_DWG);
  /* Xoá tham chiếu để không copy được file gốc ra từ console */
  try { delete window.EMBEDDED_DWG; } catch (e) { window.EMBEDDED_DWG = null; }

  window.DWGLoader.toDxf(dwgBytes)
    .then(function (r) {
      loadDocument(r.dxf, { format: 'DWG', version: r.version, name: 'MB-CH-A0102' });
      setBusy(null);
    })
    .catch(function (err) {
      setBusy(null);
      fatal('Không mở được bản vẽ DWG.<br><br>' + err.message);
    });

  function fatal(html) {
    document.body.innerHTML =
      '<div style="max-width:620px;margin:12vh auto;padding:28px;font:14px/1.7 \'Segoe UI\',sans-serif;' +
      'color:#dbe3f0;background:#121722;border:1px solid #232b3d;border-radius:12px">' +
      '<h2 style="margin:0 0 10px;font-size:17px;color:#e5484d">Không mở được bản vẽ</h2>' + html + '</div>';
  }

  function b64ToBuffer(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  /* ================= tiện ích ================= */
  function deepFreeze(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.freeze(o);
    Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    return o;
  }
  function genSession() {
    var s = '';
    for (var i = 0; i < 8; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
    return s.slice(0, 4) + '-' + s.slice(4);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(d) {
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtClock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function initials(n) {
    var p = n.trim().split(/\s+/);
    return (p[0][0] + (p[p.length - 1][0] || '')).toUpperCase();
  }
  function stripTags(s) { var d = document.createElement('div'); d.innerHTML = s; return d.textContent; }
})();
