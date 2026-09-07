/*
 * dxf-parser.js — Bộ đọc DXF tối giản, đủ dùng cho bản vẽ 2D kỹ thuật.
 * Hỗ trợ: LINE, CIRCLE, ARC, TEXT/MTEXT, POINT, SOLID, LWPOLYLINE, POLYLINE/VERTEX,
 *         ELLIPSE, INSERT (bung block, có scale/rotate), bảng LAYER + LTYPE.
 * Không hỗ trợ ghi/sửa — viewer chỉ đọc.
 */
(function (global) {
  'use strict';

  /* --- Bảng màu AutoCAD Color Index (ACI) --- */
  var ACI = {
    0: '#ffffff', 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
    5: '#0055ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0',
    250: '#333333', 251: '#5b5b5b', 252: '#848484', 253: '#adadad', 254: '#d6d6d6', 255: '#ffffff'
  };
  function aciToHex(i) {
    if (ACI[i]) return ACI[i];
    if (i >= 10 && i <= 249) {
      var h = ((i - 10) % 240) / 240 * 360;
      var l = 0.45 + 0.25 * (Math.floor((i - 10) / 10) % 3) / 3;
      return hslToHex(h, 0.9, l);
    }
    return '#ffffff';
  }
  function hslToHex(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    var f = function (v) { return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2); };
    return '#' + f(r) + f(g) + f(b);
  }

  /* --- tách file thành cặp (code, value) --- */
  function tokenize(txt) {
    var raw = txt.split(/\r\n|\r|\n/), out = [];
    for (var i = 0; i + 1 < raw.length; i += 2) {
      var c = parseInt(raw[i], 10);
      if (isNaN(c)) { i -= 1; continue; }          // tự đồng bộ lại nếu lệch dòng
      out.push({ c: c, v: raw[i + 1] });
    }
    return out;
  }

  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };

  /* --- gom các cặp của 1 thực thể thành map: {code: [values]} --- */
  function grab(tk, i) {
    var m = {};
    while (i < tk.length && tk[i].c !== 0) {
      (m[tk[i].c] = m[tk[i].c] || []).push(tk[i].v);
      i++;
    }
    return { map: m, next: i };
  }
  var g1 = function (m, c, d) { return m[c] ? m[c][0] : d; };
  var gn = function (m, c, d) { return m[c] ? num(m[c][0]) : (d === undefined ? 0 : d); };

  /* --- dựng entity từ map --- */
  function buildEntity(type, m) {
    var base = {
      type: type,
      layer: g1(m, 8, '0'),
      color: m[62] ? parseInt(m[62][0], 10) : null,   // null = BYLAYER
      ltype: g1(m, 6, null)
    };
    switch (type) {
      case 'LINE':
        return Object.assign(base, { x1: gn(m, 10), y1: gn(m, 20), x2: gn(m, 11), y2: gn(m, 21) });
      case 'CIRCLE':
        return Object.assign(base, { cx: gn(m, 10), cy: gn(m, 20), r: gn(m, 40) });
      case 'ARC':
        return Object.assign(base, { cx: gn(m, 10), cy: gn(m, 20), r: gn(m, 40), a1: gn(m, 50), a2: gn(m, 51) });
      case 'POINT':
        return Object.assign(base, { x: gn(m, 10), y: gn(m, 20) });
      case 'ELLIPSE':
        return Object.assign(base, {
          cx: gn(m, 10), cy: gn(m, 20), mx: gn(m, 11), my: gn(m, 21),
          ratio: gn(m, 40, 1), a1: gn(m, 41), a2: gn(m, 42, Math.PI * 2)
        });
      case 'SOLID':
      case 'TRACE': {
        var pts = [];
        for (var k = 0; k < 4; k++) if (m[10 + k]) pts.push({ x: gn(m, 10 + k), y: gn(m, 20 + k) });
        return Object.assign(base, { pts: pts });
      }
      case 'TEXT':
      case 'ATTRIB': {
        var ha = gn(m, 72, 0), va = gn(m, 73, 0);
        var x = gn(m, 10), y = gn(m, 20);
        if ((ha !== 0 || va !== 0) && m[11]) {
          /* Theo chuẩn DXF, khi có căn lề thì vị trí thật nằm ở 11/21. Nhưng LibreDWG
             luôn xuất 11/21 = 0,0 kể cả khi không dùng tới, làm mọi chữ dồn về gốc toạ
             độ. Chỉ tin điểm căn lề khi nó thực sự mang giá trị. */
          var ax = gn(m, 11), ay = gn(m, 21);
          if (ax !== 0 || ay !== 0 || (x === 0 && y === 0)) { x = ax; y = ay; }
        }
        return Object.assign(base, {
          type: 'TEXT', x: x, y: y, h: gn(m, 40, 2.5), text: g1(m, 1, ''),
          rot: gn(m, 50), halign: ha, valign: va, widthFactor: gn(m, 41, 1)
        });
      }
      case 'MTEXT': {
        var t = (m[1] || []).join('') + (m[3] ? m[3].join('') : '');
        t = t.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
        var at = gn(m, 71, 1); // 1..3 top, 4..6 middle, 7..9 bottom
        return Object.assign(base, {
          type: 'TEXT', x: gn(m, 10), y: gn(m, 20), h: gn(m, 40, 2.5), text: t,
          rot: gn(m, 50), halign: (at % 3 === 2 ? 1 : (at % 3 === 0 ? 2 : 0)),
          valign: (at <= 3 ? 3 : at <= 6 ? 2 : 1), widthFactor: 1
        });
      }
      case 'LWPOLYLINE': {
        var xs = m[10] || [], ys = m[20] || [], bs = m[42] || [];
        var p = [];
        for (var j = 0; j < xs.length; j++) p.push({ x: num(xs[j]), y: num(ys[j] || 0), bulge: 0 });
        // bulge trong LWPOLYLINE bám theo thứ tự đỉnh — xấp xỉ: gán tuần tự
        for (var b = 0; b < bs.length && b < p.length; b++) p[b].bulge = num(bs[b]);
        return Object.assign(base, {
          type: 'POLYLINE', pts: p, closed: (gn(m, 70) & 1) === 1, width: gn(m, 43)
        });
      }
      default:
        return null;
    }
  }

  /* --- xoay + tịnh tiến 1 điểm --- */
  function xf(p, ins) {
    var c = Math.cos(ins.rot * Math.PI / 180), s = Math.sin(ins.rot * Math.PI / 180);
    var x = p.x * ins.sx, y = p.y * ins.sy;
    return { x: ins.x + x * c - y * s, y: ins.y + x * s + y * c };
  }
  /* --- áp transform của INSERT lên 1 entity trong block --- */
  function applyInsert(e, ins) {
    var o = Object.assign({}, e);
    var k = (Math.abs(ins.sx) + Math.abs(ins.sy)) / 2;
    switch (e.type) {
      case 'LINE': {
        var a = xf({ x: e.x1, y: e.y1 }, ins), b = xf({ x: e.x2, y: e.y2 }, ins);
        o.x1 = a.x; o.y1 = a.y; o.x2 = b.x; o.y2 = b.y; break;
      }
      case 'CIRCLE': case 'ARC': {
        var c = xf({ x: e.cx, y: e.cy }, ins);
        o.cx = c.x; o.cy = c.y; o.r = e.r * k;
        if (e.type === 'ARC') { o.a1 = e.a1 + ins.rot; o.a2 = e.a2 + ins.rot; }
        break;
      }
      case 'TEXT': {
        var t = xf({ x: e.x, y: e.y }, ins);
        o.x = t.x; o.y = t.y; o.h = e.h * k; o.rot = e.rot + ins.rot; break;
      }
      case 'POINT': { var q = xf({ x: e.x, y: e.y }, ins); o.x = q.x; o.y = q.y; break; }
      case 'POLYLINE': case 'SOLID': case 'TRACE':
        o.pts = e.pts.map(function (p) {
          var r = xf(p, ins); return { x: r.x, y: r.y, bulge: p.bulge || 0 };
        });
        break;
      case 'ELLIPSE': {
        var ec = xf({ x: e.cx, y: e.cy }, ins);
        o.cx = ec.x; o.cy = ec.y; o.mx = e.mx * k; o.my = e.my * k; break;
      }
      default: return null;
    }
    if (ins.layer && ins.layer !== '0' && e.layer === '0') o.layer = ins.layer;
    return o;
  }

  /* ============ parse chính ============ */
  function parse(txt) {
    var tk = tokenize(txt);
    var layers = {}, ltypes = {}, blocks = {}, entities = [];
    var header = {};
    var i = 0, section = null;

    function readEntityStream(stop, sink, blockName) {
      /* đọc chuỗi entity đến khi gặp `stop` (ENDSEC / ENDBLK) */
      while (i < tk.length) {
        if (tk[i].c !== 0) { i++; continue; }
        var type = tk[i].v;
        if (type === stop) { i++; return; }
        i++;
        var r = grab(tk, i); i = r.next;

        if (type === 'POLYLINE') {
          var pl = {
            type: 'POLYLINE', layer: g1(r.map, 8, '0'),
            color: r.map[62] ? parseInt(r.map[62][0], 10) : null,
            ltype: g1(r.map, 6, null), closed: (gn(r.map, 70) & 1) === 1, pts: []
          };
          while (i < tk.length && tk[i].c === 0 && tk[i].v === 'VERTEX') {
            i++;
            var vr = grab(tk, i); i = vr.next;
            pl.pts.push({ x: gn(vr.map, 10), y: gn(vr.map, 20), bulge: gn(vr.map, 42) });
          }
          if (i < tk.length && tk[i].c === 0 && tk[i].v === 'SEQEND') { i++; var sr = grab(tk, i); i = sr.next; }
          if (pl.pts.length) sink.push(pl);
          continue;
        }

        if (type === 'INSERT') {
          sink.push({
            type: 'INSERT', layer: g1(r.map, 8, '0'), name: g1(r.map, 2, ''),
            x: gn(r.map, 10), y: gn(r.map, 20),
            sx: gn(r.map, 41, 1) || 1, sy: gn(r.map, 42, 1) || 1, rot: gn(r.map, 50)
          });
          continue;
        }

        var e = buildEntity(type, r.map);
        if (e) sink.push(e);
      }
    }

    while (i < tk.length) {
      var t = tk[i];
      if (t.c === 0 && t.v === 'SECTION') { section = tk[i + 1] ? tk[i + 1].v : null; i += 2; continue; }
      if (t.c === 0 && t.v === 'ENDSEC') { section = null; i++; continue; }
      if (t.c === 0 && t.v === 'EOF') break;

      if (section === 'HEADER') {
        if (t.c === 9) {
          var key = t.v; i++;
          var hr = grab(tk, i); i = hr.next;
          header[key] = hr.map;
          continue;
        }
        i++; continue;
      }

      if (section === 'TABLES') {
        if (t.c === 0 && (t.v === 'LAYER' || t.v === 'LTYPE')) {
          var kind = t.v; i++;
          var tr = grab(tk, i); i = tr.next;
          var nm = g1(tr.map, 2, null);
          if (!nm) continue;
          if (kind === 'LAYER') {
            var col = tr.map[62] ? parseInt(tr.map[62][0], 10) : 7;
            layers[nm] = {
              name: nm, colorIndex: Math.abs(col), color: aciToHex(Math.abs(col)),
              off: col < 0, frozen: (gn(tr.map, 70) & 1) === 1, ltype: g1(tr.map, 6, 'CONTINUOUS')
            };
          } else {
            ltypes[nm] = { name: nm, pattern: (tr.map[49] || []).map(num) };
          }
          continue;
        }
        i++; continue;
      }

      if (section === 'BLOCKS') {
        if (t.c === 0 && t.v === 'BLOCK') {
          i++;
          var br = grab(tk, i); i = br.next;
          var bn = g1(br.map, 2, 'noname');
          var bxo = gn(br.map, 10), byo = gn(br.map, 20);
          var bucket = [];
          readEntityStream('ENDBLK', bucket, bn);
          blocks[bn] = { name: bn, ox: bxo, oy: byo, entities: bucket };
          continue;
        }
        i++; continue;
      }

      if (section === 'ENTITIES') { readEntityStream('ENDSEC', entities, null); section = null; continue; }
      i++;
    }

    /* --- bung INSERT (tối đa 4 cấp lồng nhau) --- */
    function expand(list, depth) {
      var out = [];
      list.forEach(function (e) {
        if (e.type !== 'INSERT') { out.push(e); return; }
        var b = blocks[e.name];
        if (!b || depth > 4) return;
        var ins = { x: e.x - b.ox * e.sx, y: e.y - b.oy * e.sy, sx: e.sx, sy: e.sy, rot: e.rot, layer: e.layer };
        expand(b.entities, depth + 1).forEach(function (be) {
          var o = applyInsert(be, ins);
          if (o) out.push(o);
        });
      });
      return out;
    }
    entities = expand(entities, 0);

    /* --- layer ngầm định cho entity trỏ tới layer chưa khai báo --- */
    entities.forEach(function (e) {
      if (!layers[e.layer]) {
        layers[e.layer] = { name: e.layer, colorIndex: 7, color: '#ffffff', off: false, frozen: false, ltype: 'CONTINUOUS' };
      }
    });

    /* --- vá lỗi bộ chuyển DWG -> DXF ---
       Trong DXF, group 62 mang dấu âm nghĩa là layer đang TẮT. Bản LibreDWG biên dịch
       WebAssembly (@mlightcad/libredwg-web) ghi 62 = -7 cho MỌI layer, khiến bản vẽ mở ra
       trắng trơn — dù `dwglayers` xác nhận trong file DWG mọi layer đều đang bật, và bản
       native `dwg2dxf` ghi đúng số dương. Không có bản vẽ thật nào tắt sạch toàn bộ layer,
       nên gặp trường hợp đó thì coi như dữ liệu sai và bỏ qua cờ tắt. */
    var names = Object.keys(layers);
    if (names.length > 1 && names.every(function (n) { return layers[n].off; })) {
      names.forEach(function (n) { layers[n].off = false; });
    }

    return {
      layers: layers, ltypes: ltypes, blocks: blocks, entities: entities,
      header: header, aciToHex: aciToHex, extents: computeExtents(entities)
    };
  }

  /* --- bao hình toàn bản vẽ --- */
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
        case 'CIRCLE': case 'ARC':
          add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); break;
        case 'POINT': add(e.x, e.y); break;
        case 'TEXT': add(e.x, e.y); add(e.x + e.h * (e.text || '').length * 0.7, e.y + e.h); break;
        case 'ELLIPSE': {
          var R = Math.hypot(e.mx, e.my);
          add(e.cx - R, e.cy - R); add(e.cx + R, e.cy + R); break;
        }
        default:
          if (e.pts) e.pts.forEach(function (p) { add(p.x, p.y); });
      }
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: maxX - minX, h: maxY - minY };
  }

  global.DXF = { parse: parse, aciToHex: aciToHex };
})(window);
