/*
 * viewer.js — Trình xem bản vẽ 2D trên <canvas>. CHỈ ĐỌC.
 * Không có API sửa/xoá entity: dữ liệu bản vẽ được đóng băng (Object.freeze)
 * ngay sau khi parse, mọi thao tác chuột chỉ đổi ma trận nhìn (pan/zoom).
 */
(function (global) {
  'use strict';

  /* Độ dày nét theo layer (mm quy đổi ra px ở tỷ lệ 1:1) */
  var LINEWEIGHT = { TUONG: 2.0, KHUNG_TEN: 1.4, CUA_SO: 1.0, VAN_BAN: 1.0, DEFAULT: 1.0 };

  function Viewer(canvas, doc, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.doc = doc;
    this.opts = opts || {};
    this.scale = 1; this.ox = 0; this.oy = 0;   // world -> screen
    this.hidden = {};                            // { layerName: true } = đang tắt
    this.suppressed = false;                     // true = ẩn bản vẽ (vd: DevTools đang mở)
    this.watermark = this.opts.watermark || null;
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this._bind();
    this.resize();
  }

  /* ---------- toạ độ ---------- */
  Viewer.prototype.toScreen = function (x, y) {
    return { x: (x - this.ox) * this.scale, y: (this.oy - y) * this.scale };
  };
  Viewer.prototype.toWorld = function (sx, sy) {
    return { x: sx / this.scale + this.ox, y: this.oy - sy / this.scale };
  };

  Viewer.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, Math.round(r.width));
    this.H = Math.max(1, Math.round(r.height));
    this.canvas.width = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
    this.render();
  };

  Viewer.prototype.fit = function (pad) {
    pad = pad === undefined ? 0.06 : pad;
    var b = this.visibleExtents();
    var sx = (this.W * (1 - pad * 2)) / (b.w || 1);
    var sy = (this.H * (1 - pad * 2)) / (b.h || 1);
    this.scale = Math.min(sx, sy);
    var cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    this.ox = cx - this.W / 2 / this.scale;
    this.oy = cy + this.H / 2 / this.scale;
    this.render();
  };

  Viewer.prototype.visibleExtents = function () {
    var self = this;
    var list = this.doc.entities.filter(function (e) { return !self.hidden[e.layer]; });
    var b = list.length ? computeExtents(list) : this.doc.extents;
    if (!b.w || !b.h) b = this.doc.extents;
    return b;
  };

  Viewer.prototype.zoomAt = function (sx, sy, factor) {
    var w = this.toWorld(sx, sy);
    var next = Math.min(Math.max(this.scale * factor, 1e-5), 1e5);
    this.scale = next;
    this.ox = w.x - sx / this.scale;
    this.oy = w.y + sy / this.scale;
    this.render();
  };

  /* ---------- layer / layout ---------- */
  Viewer.prototype.setLayerVisible = function (name, on) {
    if (on) delete this.hidden[name]; else this.hidden[name] = true;
    this.render();
  };
  Viewer.prototype.isLayerVisible = function (name) { return !this.hidden[name]; };
  Viewer.prototype.applyLayout = function (layout) {
    var self = this;
    this.hidden = {};
    (layout.hide || []).forEach(function (n) { self.hidden[n] = true; });
    this.render();
  };

  /* ---------- vẽ ---------- */
  Viewer.prototype.render = function () {
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = this.opts.bg || '#1e2532';
    ctx.fillRect(0, 0, this.W, this.H);

    /* Bị ẩn (vd: DevTools mở): KHÔNG vẽ entity/watermark -> canvas không chứa pixel
       bản vẽ để soi qua DevTools. Khác với lớp blur CSS (xoá class là hết), ở đây dữ
       liệu ảnh thật sự không được sinh ra. */
    if (this.suppressed) { this._suppressedNotice(ctx); return; }

    if (this.opts.grid !== false) this._grid(ctx);

    var self = this;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    this.doc.entities.forEach(function (e) {
      if (self.hidden[e.layer]) return;
      var ly = self.doc.layers[e.layer] || {};
      if (ly.off || ly.frozen) return;
      var col = e.color != null && e.color !== 256 ? global.DXF.aciToHex(Math.abs(e.color)) : (ly.color || '#ffffff');
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = LINEWEIGHT[e.layer] || LINEWEIGHT.DEFAULT;
      self._dash(ctx, e, ly);
      self._entity(ctx, e);
      ctx.setLineDash([]);
    });

    if (this.watermark) this.drawWatermark(ctx, this.W, this.H, this.watermark);
    this._scalebar(ctx);
  };

  /* Bật/tắt chế độ ẩn bản vẽ. Vẽ lại ngay để canvas trống (khi bật) hoặc hiện lại
     (khi tắt). Mọi thao tác pan/zoom sau đó cũng chỉ vẽ màn trống khi còn bật. */
  Viewer.prototype.setSuppressed = function (on) {
    on = !!on;
    if (this.suppressed === on) return;
    this.suppressed = on;
    this.render();
  };

  Viewer.prototype._suppressedNotice = function (ctx) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(240,165,51,.9)';
    ctx.font = '600 15px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Bản vẽ đã được ẩn', this.W / 2, this.H / 2 - 11);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Phát hiện DevTools đang mở — đóng lại để xem tiếp.', this.W / 2, this.H / 2 + 12);
    ctx.restore();
  };

  Viewer.prototype._dash = function (ctx, e, ly) {
    var name = e.ltype && e.ltype !== 'BYLAYER' ? e.ltype : ly.ltype;
    var lt = this.doc.ltypes[name];
    if (!lt || !lt.pattern || !lt.pattern.length) { ctx.setLineDash([]); return; }
    var d = lt.pattern.map(function (p) { return Math.max(1, Math.abs(p) * this.scale); }, this);
    ctx.setLineDash(d);
  };

  Viewer.prototype._entity = function (ctx, e) {
    var s = this.toScreen.bind(this);
    switch (e.type) {
      case 'LINE': {
        var a = s(e.x1, e.y1), b = s(e.x2, e.y2);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        break;
      }
      case 'CIRCLE': {
        var c = s(e.cx, e.cy), r = e.r * this.scale;
        if (r < 0.3) break;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'ARC': {
        var ac = s(e.cx, e.cy), ar = e.r * this.scale;
        if (ar < 0.3) break;
        /* DXF: góc CCW theo trục Y hướng lên; canvas Y hướng xuống -> đảo dấu và đảo chiều */
        ctx.beginPath();
        ctx.arc(ac.x, ac.y, ar, -e.a2 * Math.PI / 180, -e.a1 * Math.PI / 180);
        ctx.stroke();
        break;
      }
      case 'ELLIPSE': {
        var ec = s(e.cx, e.cy);
        var R = Math.hypot(e.mx, e.my) * this.scale;
        if (R < 0.3) break;
        var rot = Math.atan2(e.my, e.mx);
        ctx.beginPath();
        ctx.ellipse(ec.x, ec.y, R, R * e.ratio, -rot, -e.a2, -e.a1, true);
        ctx.stroke();
        break;
      }
      case 'POINT': {
        var p = s(e.x, e.y);
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'SOLID': case 'TRACE': {
        if (!e.pts || e.pts.length < 3) break;
        var q = e.pts.map(function (pt) { return s(pt.x, pt.y); });
        ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y);
        ctx.lineTo(q[1].x, q[1].y);
        if (q[3]) ctx.lineTo(q[3].x, q[3].y);
        if (q[2]) ctx.lineTo(q[2].x, q[2].y);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'POLYLINE': {
        if (!e.pts || e.pts.length < 2) break;
        ctx.beginPath();
        for (var i = 0; i < e.pts.length; i++) {
          var pt = s(e.pts[i].x, e.pts[i].y);
          if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
        if (e.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'TEXT': {
        var h = e.h * this.scale;
        if (h < 4 || !e.text) break;                        // quá nhỏ: bỏ qua cho nhẹ
        var tp = s(e.x, e.y);
        ctx.save();
        ctx.translate(tp.x, tp.y);
        if (e.rot) ctx.rotate(-e.rot * Math.PI / 180);
        ctx.font = h + 'px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = e.halign === 1 ? 'center' : e.halign === 2 ? 'right' : 'left';
        ctx.textBaseline = e.valign === 3 ? 'top' : e.valign === 2 ? 'middle' : 'alphabetic';
        ctx.fillText(e.text, 0, 0);
        ctx.restore();
        break;
      }
    }
  };

  /* --- lưới nền mờ --- */
  Viewer.prototype._grid = function (ctx) {
    var step = 1000;                                   // 1 m
    while (step * this.scale < 28) step *= 5;
    while (step * this.scale > 260) step /= 5;
    var w0 = this.toWorld(0, this.H), w1 = this.toWorld(this.W, 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = Math.floor(w0.x / step) * step; x < w1.x; x += step) {
      var sx = this.toScreen(x, 0).x;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, this.H);
    }
    for (var y = Math.floor(w0.y / step) * step; y < w1.y; y += step) {
      var sy = this.toScreen(0, y).y;
      ctx.moveTo(0, sy); ctx.lineTo(this.W, sy);
    }
    ctx.stroke();
    ctx.restore();
  };

  /* --- thước tỷ lệ góc dưới --- */
  Viewer.prototype._scalebar = function (ctx) {
    var target = 130, unit = 1;
    while (unit * this.scale < target) unit *= 10;
    while (unit * this.scale > target * 2) unit /= 2;
    var px = unit * this.scale;
    var x0 = 16, y0 = this.H - 20;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.lineWidth = 1.4; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 5);
    ctx.stroke();
    ctx.font = '11px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    var label = unit >= 1000 ? (unit / 1000) + ' m' : Math.round(unit) + ' mm';
    ctx.fillText(label, x0 + px / 2, y0 - 7);
    ctx.restore();
  };

  /* --- WATERMARK: vẽ trực tiếp vào canvas nên có mặt trong mọi ảnh chụp --- */
  Viewer.prototype.drawWatermark = function (ctx, W, H, wm) {
    var text = wm.text || '';
    var sub = wm.sub || '';
    ctx.save();
    ctx.globalAlpha = wm.opacity == null ? 0.13 : wm.opacity;
    ctx.fillStyle = wm.color || '#ffffff';
    var size = wm.size || Math.max(18, Math.min(W, H) / 22);
    ctx.font = '700 ' + size + 'px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    var stepX = ctx.measureText(text).width + size * 5.0;
    var stepY = size * 6.0;
    var diag = Math.hypot(W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 6);
    for (var y = -diag; y < diag; y += stepY) {
      for (var x = -diag; x < diag; x += stepX) {
        ctx.fillText(text, x, y);
        if (sub) {
          ctx.save();
          ctx.font = '600 ' + (size * 0.42) + 'px "Segoe UI", Arial, sans-serif';
          ctx.fillText(sub, x, y + size * 0.85);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  };

  /* ---------- tương tác: chỉ pan/zoom, không tạo/sửa hình ---------- */
  Viewer.prototype._bind = function () {
    var self = this, drag = null, pinch = null;
    var cv = this.canvas;

    cv.addEventListener('pointerdown', function (ev) {
      cv.setPointerCapture(ev.pointerId);
      drag = { x: ev.clientX, y: ev.clientY, ox: self.ox, oy: self.oy };
      cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', function (ev) {
      var r = cv.getBoundingClientRect();
      var w = self.toWorld(ev.clientX - r.left, ev.clientY - r.top);
      if (self.opts.onCoord) self.opts.onCoord(w);
      if (!drag) return;
      self.ox = drag.ox - (ev.clientX - drag.x) / self.scale;
      self.oy = drag.oy + (ev.clientY - drag.y) / self.scale;
      self.render();
    });
    var end = function () { drag = null; cv.style.cursor = 'grab'; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', function () {
      if (self.opts.onCoord) self.opts.onCoord(null);
    });

    cv.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var r = cv.getBoundingClientRect();
      self.zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    /* pinch zoom cho cảm ứng */
    cv.addEventListener('touchmove', function (ev) {
      if (ev.touches.length !== 2) return;
      ev.preventDefault();
      var r = cv.getBoundingClientRect();
      var d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX,
        ev.touches[0].clientY - ev.touches[1].clientY);
      var mx = (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left;
      var my = (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top;
      if (pinch) self.zoomAt(mx, my, d / pinch);
      pinch = d;
    }, { passive: false });
    cv.addEventListener('touchend', function () { pinch = null; });

    global.addEventListener('resize', function () { self.resize(); });
  };

  /* dùng lại từ parser */
  function computeExtents(entities) {
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

  global.Viewer = Viewer;
})(window);
