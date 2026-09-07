/*
 * export-pdf.js — Xuất bản vẽ đang xem ra PDF VECTOR kèm watermark.
 *
 * Vì sao xuất PDF chứ không cho tải DWG/DXF:
 *   DWG/DXF là định dạng dữ liệu mở cho phần mềm CAD. Watermark đóng vào DWG chỉ là
 *   một entity nằm trên một layer -> người nhận tắt layer / xoá entity / copy sang file
 *   mới là mất sạch. PDF thì watermark nằm trong content stream của trang, không tách rời
 *   được bằng thao tác thông thường, và còn gắn được cờ cấm in/cấm copy ở cấp tài liệu.
 */
(function (global) {
  'use strict';

  var PAPERS = {
    a3: { w: 420, h: 297, name: 'A3' },
    a4: { w: 297, h: 210, name: 'A4' },
    a2: { w: 594, h: 420, name: 'A2' }
  };

  /* jsPDF font chuẩn không có glyph tiếng Việt -> bỏ dấu cho chuỗi ghi vào PDF */
  function deaccent(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }

  /* Mã tra vết: nhúng vào watermark + metadata để truy nguồn bản rò rỉ */
  function traceId(seed) {
    var h = 0x811c9dc5;
    var s = seed + '|' + Date.now();
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16).toUpperCase()).slice(-8).replace(/(.{4})(.{4})/, '$1-$2');
  }

  function run(doc, viewer, o) {
    var jsPDFCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFCtor) throw new Error('Chua tai duoc thu vien jsPDF.');

    var paper = PAPERS[o.paper] || PAPERS.a3;
    var landscape = paper.w >= paper.h;
    var tid = traceId(o.user + '|' + o.docCode);

    var pdfOpts = {
      orientation: landscape ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [Math.max(paper.w, paper.h), Math.min(paper.w, paper.h)],
      compress: true
    };
    /* Cờ quyền ở cấp tài liệu: KHÔNG cấp quyền "print"/"copy" -> Acrobat & đa số reader
       sẽ khoá nút In và khoá copy text. Đây là lớp răn đe, không phải mã hoá nội dung. */
    if (o.protect) {
      pdfOpts.encryption = {
        userPassword: '',
        ownerPassword: tid + '-' + Math.random().toString(36).slice(2),
        userPermissions: []          // rỗng = không cho in, không cho sửa, không cho copy
      };
    }
    var pdf = new jsPDFCtor(pdfOpts);

    var PW = pdf.internal.pageSize.getWidth();
    var PH = pdf.internal.pageSize.getHeight();
    var M = 10, FOOT = 16;
    var area = { x: M, y: M, w: PW - M * 2, h: PH - M * 2 - FOOT };

    /* --- entity đang hiển thị --- */
    var ents = doc.entities.filter(function (e) {
      if (viewer.hidden[e.layer]) return false;
      var ly = doc.layers[e.layer] || {};
      return !ly.off && !ly.frozen;
    });
    var b = extents(ents);
    var s = Math.min(area.w / (b.w || 1), area.h / (b.h || 1)) * 0.985;
    var offX = area.x + (area.w - b.w * s) / 2;
    var offY = area.y + (area.h - b.h * s) / 2;
    var X = function (x) { return offX + (x - b.minX) * s; };
    var Y = function (y) { return offY + (b.maxY - y) * s; };

    /* --- nền + khung trang --- */
    pdf.setFillColor(255, 255, 255); pdf.rect(0, 0, PW, PH, 'F');

    /* --- thân bản vẽ --- */
    pdf.setLineCap('round'); pdf.setLineJoin('round');
    var LW = { TUONG: 0.45, KHUNG_TEN: 0.32, CUA_SO: 0.22, DEFAULT: 0.18 };
    var lastKey = null;

    ents.forEach(function (e) {
      var ly = doc.layers[e.layer] || {};
      var hex = o.mode === 'color'
        ? (e.color != null && e.color !== 256 ? global.DXF.aciToHex(Math.abs(e.color)) : (ly.color || '#000000'))
        : '#000000';
      var rgb = hexToRgb(hex, o.mode !== 'color');
      var lw = LW[e.layer] || LW.DEFAULT;
      var key = rgb.join(',') + '|' + lw;
      if (key !== lastKey) {
        pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
        pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
        pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
        pdf.setLineWidth(lw);
        lastKey = key;
      }
      drawEntity(pdf, e, X, Y, s);
    });

    /* --- watermark: lát chéo phủ toàn trang, nằm TRONG content stream --- */
    drawWatermark(pdf, PW, PH, o, tid);

    /* --- dải chân trang: ai tải, lúc nào, mã tra vết --- */
    pdf.setDrawColor(150); pdf.setLineWidth(0.25);
    pdf.line(M, PH - FOOT, PW - M, PH - FOOT);
    pdf.setTextColor(70); pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
    pdf.text(deaccent(o.title + '  |  Ma ban ve: ' + o.docCode + '  |  Layout: ' + o.layoutName), M, PH - FOOT + 5);
    pdf.text(deaccent('Nguoi tai: ' + o.user + '   -   ' + o.time + '   -   Ma tra vet: ' + tid), M, PH - FOOT + 9.5);
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(150, 30, 30);
    pdf.text(deaccent('TAI LIEU KIEM SOAT - CAM IN / CAM SAO CHEP / CAM PHAT TAN'), M, PH - FOOT + 14);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(120);
    pdf.text(paper.name + (landscape ? ' Landscape' : ' Portrait'), PW - M, PH - FOOT + 5, { align: 'right' });

    /* --- metadata ---
       Khi bật mã hoá (o.protect), jsPDF BẮT BUỘC mã hoá mọi chuỗi trong Info
       dictionary, kể cả /Title. Trình đọc nào không giải mã metadata (nhiều viewer
       nhẹ trên Linux/di động) sẽ in nguyên chuỗi ciphertext lên thanh tiêu đề ->
       trông như bị "lỗi font / encode". Tiêu đề, tác giả... không phải bí mật (đã có
       ở footer + watermark + tên file) nên khi mã hoá ta KHÔNG ghi các chuỗi này để
       tránh hiện chuỗi rác; giá trị DRM (cấm in/copy, watermark, tra vết) vẫn nguyên.
       Khi không mã hoá thì ghi đầy đủ metadata như bình thường. */
    var titlePlain = deaccent(o.title);
    if (!o.protect) {
      pdf.setProperties({
        title: titlePlain + ' [' + o.docCode + ']',
        subject: deaccent('Ban sao kiem soat cap cho ' + o.user + ' - ma tra vet ' + tid),
        author: deaccent(o.company || 'He thong phan phoi ban ve'),
        keywords: 'DRM,controlled-copy,' + tid,
        creator: 'DRM Drawing Portal'
      });
    }

    return { pdf: pdf, traceId: tid, count: ents.length, title: titlePlain };
  }

  /* ---------- vẽ 1 entity vào PDF ---------- */
  function drawEntity(pdf, e, X, Y, s) {
    switch (e.type) {
      case 'LINE':
        pdf.line(X(e.x1), Y(e.y1), X(e.x2), Y(e.y2));
        break;
      case 'CIRCLE':
        if (e.r * s < 0.08) break;
        pdf.circle(X(e.cx), Y(e.cy), e.r * s, 'S');
        break;
      case 'ARC': {
        if (e.r * s < 0.08) break;
        var a1 = e.a1 * Math.PI / 180, a2 = e.a2 * Math.PI / 180;
        if (a2 < a1) a2 += Math.PI * 2;
        var n = Math.max(8, Math.ceil((a2 - a1) / (Math.PI / 24)));
        var px = null, py = null;
        for (var i = 0; i <= n; i++) {
          var a = a1 + (a2 - a1) * i / n;
          var cx = X(e.cx + Math.cos(a) * e.r), cy = Y(e.cy + Math.sin(a) * e.r);
          if (px !== null) pdf.line(px, py, cx, cy);
          px = cx; py = cy;
        }
        break;
      }
      case 'ELLIPSE': {
        var R = Math.hypot(e.mx, e.my);
        if (R * s < 0.08) break;
        pdf.ellipse(X(e.cx), Y(e.cy), R * s, R * e.ratio * s, 'S');
        break;
      }
      case 'POINT':
        pdf.circle(X(e.x), Y(e.y), 0.25, 'F');
        break;
      case 'SOLID': case 'TRACE': {
        if (!e.pts || e.pts.length < 3) break;
        var order = e.pts.length >= 4 ? [0, 1, 3, 2] : [0, 1, 2];
        var pts = order.map(function (i) { return [X(e.pts[i].x), Y(e.pts[i].y)]; });
        polyFill(pdf, pts);
        break;
      }
      case 'POLYLINE': {
        if (!e.pts || e.pts.length < 2) break;
        for (var k = 0; k < e.pts.length - 1; k++) {
          pdf.line(X(e.pts[k].x), Y(e.pts[k].y), X(e.pts[k + 1].x), Y(e.pts[k + 1].y));
        }
        if (e.closed) {
          var a0 = e.pts[e.pts.length - 1], b0 = e.pts[0];
          pdf.line(X(a0.x), Y(a0.y), X(b0.x), Y(b0.y));
        }
        break;
      }
      case 'TEXT': {
        if (!e.text) break;
        var hmm = e.h * s;
        if (hmm < 0.7) break;
        pdf.setFontSize(hmm * 2.8346);
        var opt = { align: e.halign === 1 ? 'center' : e.halign === 2 ? 'right' : 'left' };
        if (e.rot) { opt.angle = e.rot; }
        var yy = Y(e.y);
        if (e.valign === 2) yy += hmm * 0.36;       // middle
        else if (e.valign === 3) yy += hmm * 0.82;  // top
        pdf.text(deaccent(e.text), X(e.x), yy, opt);
        break;
      }
    }
  }

  function polyFill(pdf, pts) {
    var lines = [];
    for (var i = 1; i < pts.length; i++) lines.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
    pdf.lines(lines, pts[0][0], pts[0][1], [1, 1], 'F', true);
  }

  /* ---------- watermark ---------- */
  function drawWatermark(pdf, PW, PH, o, tid) {
    var main = deaccent(o.watermarkText || o.user);
    var sub = deaccent(o.watermarkSub || (o.time + '  ·  ' + tid));
    var GState = pdf.GState;
    if (GState) pdf.setGState(new GState({ opacity: o.wmOpacity == null ? 0.14 : o.wmOpacity }));
    pdf.setTextColor(30, 30, 30);
    pdf.setFont('helvetica', 'bold');

    var size = o.wmSize || 22;                 // pt
    pdf.setFontSize(size);
    var tw = pdf.getTextWidth(main);
    var stepX = tw + 34;
    var stepY = 34;
    var diag = Math.hypot(PW, PH);

    for (var y = -diag / 2; y < diag; y += stepY) {
      for (var x = -diag / 2; x < diag; x += stepX) {
        /* xoay quanh tâm trang: jsPDF quay quanh chính điểm text */
        var p = rot(x - PW / 4, y - PH / 4, 30);
        var px = p.x + PW / 2, py = p.y + PH / 2;
        if (px < -tw || px > PW + tw || py < -20 || py > PH + 20) continue;
        pdf.setFontSize(size); pdf.setFont('helvetica', 'bold');
        pdf.text(main, px, py, { angle: 30, align: 'center' });
        pdf.setFontSize(size * 0.42); pdf.setFont('helvetica', 'normal');
        pdf.text(sub, px + 3.2, py + 5.6, { angle: 30, align: 'center' });
      }
    }
    if (GState) pdf.setGState(new GState({ opacity: 1 }));
    pdf.setFont('helvetica', 'normal');
  }
  function rot(x, y, deg) {
    var a = -deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  /* ---------- tiện ích ---------- */
  function hexToRgb(hex, forceDark) {
    var h = (hex || '#000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (forceDark) return [0, 0, 0];
    /* nền PDF trắng: màu quá sáng (trắng/vàng) sẽ mất nét -> ép tối lại */
    var lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 190) { r = Math.round(r * 0.35); g = Math.round(g * 0.35); b = Math.round(b * 0.35); }
    return [r, g, b];
  }

  function extents(entities) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function add(x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    entities.forEach(function (e) {
      switch (e.type) {
        case 'LINE': add(e.x1, e.y1); add(e.x2, e.y2); break;
        case 'CIRCLE': case 'ARC': add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); break;
        case 'POINT': add(e.x, e.y); break;
        case 'TEXT': add(e.x, e.y); add(e.x + e.h * (e.text || '').length * 0.7, e.y + e.h); break;
        case 'ELLIPSE': { var R = Math.hypot(e.mx, e.my); add(e.cx - R, e.cy - R); add(e.cx + R, e.cy + R); break; }
        default: if (e.pts) e.pts.forEach(function (p) { add(p.x, p.y); });
      }
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: maxX - minX, h: maxY - minY };
  }

  global.ExportPDF = { run: run, PAPERS: PAPERS, deaccent: deaccent };
})(window);
