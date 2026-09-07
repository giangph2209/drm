/*
 * gen-dxf.js — Sinh file bản vẽ kỹ thuật mẫu (DXF R12 / AC1009).
 * Chạy: node tools/gen-dxf.js
 * Xuất ra:
 *   sample/MB-CH-A0102.dxf   -> file DXF mở được bằng AutoCAD / BricsCAD / LibreCAD
 *   data/drawing.js          -> cùng nội dung, nhúng thẳng vào web (không cần upload/fetch)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ents = [];

/* ---------- helpers ---------- */
const P = (c, v) => c + '\n' + v + '\n';
const F = (n) => (Math.round(n * 1e6) / 1e6).toFixed(6);

function line(layer, x1, y1, x2, y2) {
  ents.push(P(0, 'LINE') + P(8, layer) + P(10, F(x1)) + P(20, F(y1)) + P(30, '0.0') +
    P(11, F(x2)) + P(21, F(y2)) + P(31, '0.0'));
}
function circle(layer, cx, cy, r) {
  ents.push(P(0, 'CIRCLE') + P(8, layer) + P(10, F(cx)) + P(20, F(cy)) + P(30, '0.0') + P(40, F(r)));
}
function arc(layer, cx, cy, r, a1, a2) {
  ents.push(P(0, 'ARC') + P(8, layer) + P(10, F(cx)) + P(20, F(cy)) + P(30, '0.0') +
    P(40, F(r)) + P(50, F(a1)) + P(51, F(a2)));
}
/*
 * Chữ. Bản phát hành cuối cùng là DWG, mà đường chuyển DXF -> DWG của LibreDWG
 * làm MẤT group 72 (căn lề ngang) và ghi đè điểm căn lề 11/21 thành 0,0.
 * Nên không dùng group 72/73 nữa: tự tính sẵn toạ độ căn giữa / căn phải ở đây
 * rồi xuất ra chữ căn trái thuần. Nhờ vậy DXF và DWG hiển thị giống hệt nhau.
 */
const CHAR_W = 0.55;   // bề rộng ký tự ước lượng, theo chiều cao chữ
function text(layer, x, y, h, s, opts) {
  opts = opts || {};
  const rot = opts.rot || 0, halign = opts.halign || 0, valign = opts.valign || 0;
  const w = s.length * h * CHAR_W;
  const dx = halign === 1 ? -w / 2 : halign === 2 ? -w : 0;
  const dy = valign === 2 ? -h * 0.36 : valign === 3 ? -h : 0;
  const a = rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const px = x + dx * c - dy * sn;
  const py = y + dx * sn + dy * c;
  ents.push(P(0, 'TEXT') + P(8, layer) + P(10, F(px)) + P(20, F(py)) + P(30, '0.0') +
    P(40, F(h)) + P(1, s) + P(50, F(rot)) + P(41, '1.0') + P(7, 'STANDARD'));
}
function solid(layer, pts) {
  let b = P(0, 'SOLID') + P(8, layer);
  pts.forEach(function (p, i) { b += P(10 + i, F(p[0])) + P(20 + i, F(p[1])) + P(30 + i, '0.0'); });
  ents.push(b);
}
function rect(layer, x1, y1, x2, y2) {
  line(layer, x1, y1, x2, y1); line(layer, x2, y1, x2, y2);
  line(layer, x2, y2, x1, y2); line(layer, x1, y2, x1, y1);
}
/* tường 2 nét: trục (x1,y1)->(x2,y2), dày t */
function wall(x1, y1, x2, y2, t) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  const nx = -dy / L * t / 2, ny = dx / L * t / 2;
  line('TUONG', x1 + nx, y1 + ny, x2 + nx, y2 + ny);
  line('TUONG', x1 - nx, y1 - ny, x2 - nx, y2 - ny);
}
function cap(x1, y1, x2, y2, t) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  const nx = -dy / L * t / 2, ny = dx / L * t / 2;
  line('TUONG', x1 + nx, y1 + ny, x1 - nx, y1 - ny);
  line('TUONG', x2 + nx, y2 + ny, x2 - nx, y2 - ny);
}
/* cửa đi trên tường ngang */
function doorH(xc, y, w, t, up) {
  const s = up ? 1 : -1;
  line('TUONG', xc - w / 2, y - t / 2, xc - w / 2, y + t / 2);
  line('TUONG', xc + w / 2, y - t / 2, xc + w / 2, y + t / 2);
  line('CUA_SO', xc - w / 2, y, xc - w / 2, y + s * w);
  arc('CUA_SO', xc - w / 2, y, w, up ? 0 : -90, up ? 90 : 0);
}
/* cửa đi trên tường đứng */
function doorV(x, yc, w, t, right) {
  const s = right ? 1 : -1;
  line('TUONG', x - t / 2, yc - w / 2, x + t / 2, yc - w / 2);
  line('TUONG', x - t / 2, yc + w / 2, x + t / 2, yc + w / 2);
  line('CUA_SO', x, yc - w / 2, x + s * w, yc - w / 2);
  arc('CUA_SO', x, yc - w / 2, w, right ? 0 : 90, right ? 90 : 180);
}
function winH(xc, y, w, t) {
  line('TUONG', xc - w / 2, y - t / 2, xc - w / 2, y + t / 2);
  line('TUONG', xc + w / 2, y - t / 2, xc + w / 2, y + t / 2);
  line('CUA_SO', xc - w / 2, y - t / 6, xc + w / 2, y - t / 6);
  line('CUA_SO', xc - w / 2, y + t / 6, xc + w / 2, y + t / 6);
}
function winV(x, yc, w, t) {
  line('TUONG', x - t / 2, yc - w / 2, x + t / 2, yc - w / 2);
  line('TUONG', x - t / 2, yc + w / 2, x + t / 2, yc + w / 2);
  line('CUA_SO', x - t / 6, yc - w / 2, x - t / 6, yc + w / 2);
  line('CUA_SO', x + t / 6, yc - w / 2, x + t / 6, yc + w / 2);
}
function dimH(x1, x2, y, txt) {
  const tick = 120;
  line('KICH_THUOC', x1, y, x2, y);
  line('KICH_THUOC', x1 - tick / 2, y - tick / 2, x1 + tick / 2, y + tick / 2);
  line('KICH_THUOC', x2 - tick / 2, y - tick / 2, x2 + tick / 2, y + tick / 2);
  line('KICH_THUOC', x1, y - 150, x1, y + 150);
  line('KICH_THUOC', x2, y - 150, x2, y + 150);
  text('KICH_THUOC', (x1 + x2) / 2, y + 90, 180, txt, { halign: 1 });
}
function dimV(y1, y2, x, txt) {
  const tick = 120;
  line('KICH_THUOC', x, y1, x, y2);
  line('KICH_THUOC', x - tick / 2, y1 - tick / 2, x + tick / 2, y1 + tick / 2);
  line('KICH_THUOC', x - tick / 2, y2 - tick / 2, x + tick / 2, y2 + tick / 2);
  line('KICH_THUOC', x - 150, y1, x + 150, y1);
  line('KICH_THUOC', x - 150, y2, x + 150, y2);
  text('KICH_THUOC', x - 90, (y1 + y2) / 2, 180, txt, { halign: 1, rot: 90 });
}
function axisV(x, y1, y2, label) {
  line('TRUC', x, y1, x, y2);
  circle('TRUC', x, y2 + 450, 400);
  text('TRUC', x, y2 + 450, 260, label, { halign: 1, valign: 2 });
}
function axisH(y, x1, x2, label) {
  line('TRUC', x1, y, x2, y);
  circle('TRUC', x1 - 450, y, 400);
  text('TRUC', x1 - 450, y, 260, label, { halign: 1, valign: 2 });
}
function hatchRect(layer, x1, y1, x2, y2, step) {
  const w = x2 - x1, h = y2 - y1;
  for (let d = -h; d < w; d += step) {
    let ax = x1 + d, ay = y1, bx = x1 + d + h, by = y2;
    if (ax < x1) { ay = y1 + (x1 - ax); ax = x1; }
    if (bx > x2) { by = y2 - (bx - x2); bx = x2; }
    if (bx > ax && by > ay) line(layer, ax, ay, bx, by);
  }
}

/* ================= MẶT BẰNG CĂN HỘ ================= */
const T = 220, Ti = 110, W = 12000, H = 8000;
const xm = 6000;      // tường ngăn đứng, chia trái / phải
const ym = 4200;      // tường ngăn ngang nửa PHẢI  (bếp  | ngủ 02)
const ymL = 5350;     // tường ngăn ngang nửa TRÁI  (khách | ngủ 01)

wall(0, 0, W, 0, T);
wall(0, H, W, H, T);
wall(0, 0, 0, H, T);
wall(W, 0, W, H, T);
cap(0, 0, W, 0, T); cap(0, H, W, H, T);

wall(xm, 0, xm, H, Ti);
wall(xm, ym, W, ym, Ti);
wall(0, ymL, xm, ymL, Ti);

doorH(2200, 0, 1000, T, true);          // cửa chính -> phòng khách
winH(4600, 0, 1800, T);
winH(8800, 0, 1600, T);
winH(3000, H, 1800, T);
winH(9200, H, 1600, T);
winV(0, 6600, 1500, T);                 // cửa sổ phòng ngủ 01
doorH(4200, ymL, 900, Ti, true);        // khách -> ngủ 01 (tránh giường & tủ)
doorV(xm, 2000, 900, Ti, true);         // khách -> bếp
doorV(xm, 5000, 900, Ti, true);         // khách -> ngủ 02

hatchRect('HATCH', xm + Ti / 2 + 60, T / 2 + 60, W - T / 2 - 60, ym - Ti / 2 - 60, 320);

/* nội thất */
rect('THIET_BI', 700, 1250, 3100, 2100);   /* sofa - nang len de khong de len cung quet cua chinh */
rect('THIET_BI', 700, 1250, 1000, 2100);
line('THIET_BI', 1900, 1250, 1900, 2100);
rect('THIET_BI', 1250, 2300, 2550, 3050);
rect('THIET_BI', 600, 3300, 900, 5200);
circle('THIET_BI', 4300, 2600, 750);
[0, 90, 180, 270].forEach(function (a) {
  const r = a * Math.PI / 180;
  circle('THIET_BI', 4300 + Math.cos(r) * 1150, 2600 + Math.sin(r) * 1150, 260);
});
rect('THIET_BI', xm + 250, 400, W - 400, 1000);
rect('THIET_BI', W - 1000, 400, W - 400, 3200);
circle('THIET_BI', 7800, 700, 240);
rect('THIET_BI', 9100, 480, 10000, 920);
line('THIET_BI', 9550, 480, 9550, 920);
rect('THIET_BI', xm + 250, 2400, xm + 950, 3200);
line('THIET_BI', xm + 250, 2800, xm + 950, 2800);
rect('THIET_BI', 900, 5600, 2700, 7500);
line('THIET_BI', 900, 7100, 2700, 7100);
rect('THIET_BI', 1050, 7150, 1700, 7450);
rect('THIET_BI', 1900, 7150, 2550, 7450);
rect('THIET_BI', 3000, 6400, 3500, 7500);
rect('THIET_BI', 7400, 5900, 9000, 7500);
line('THIET_BI', 7400, 7150, 9000, 7150);
rect('THIET_BI', 10200, 5200, 11500, 5800);
circle('THIET_BI', 10850, 6250, 320);

/* nhãn phòng */
text('VAN_BAN', 2900, 4000, 320, 'PHONG KHACH', { halign: 1 });
text('VAN_BAN', 2900, 3600, 200, '29.2 m2', { halign: 1 });
text('VAN_BAN', 2400, 6300, 320, 'PHONG NGU 01', { halign: 1 });
text('VAN_BAN', 2400, 5900, 200, '13.6 m2', { halign: 1 });
text('VAN_BAN', 8900, 2000, 320, 'BEP + AN', { halign: 1 });
text('VAN_BAN', 8900, 1600, 200, '22.4 m2', { halign: 1 });
text('VAN_BAN', 9400, 6600, 320, 'PHONG NGU 02', { halign: 1 });
text('VAN_BAN', 9400, 6200, 200, '20.1 m2', { halign: 1 });
text('VAN_BAN', 2200, -700, 170, 'CUA CHINH 1000x2200', { halign: 1 });

/* trục */
axisV(0, -1200, H + 1200, 'A');
axisV(xm, -1200, H + 1200, 'B');
axisV(W, -1200, H + 1200, 'C');
axisH(0, -1200, W + 1200, '1');
axisH(ym, -1200, W + 1200, '2');
axisH(H, -1200, W + 1200, '3');

/* kích thước — chuỗi ngang đặt dưới, chuỗi đứng đặt bên PHẢI
   (bên trái dành cho ghi chú + hoa gió, tránh đè lên nhau) */
dimH(0, xm, -2100, '6000');
dimH(xm, W, -2100, '6000');
dimH(0, W, -3000, '12000');
dimV(0, ym, W + 1500, '4200');
dimV(ym, H, W + 1500, '3800');
dimV(0, H, W + 2400, '8000');

/* ghi chú — nằm ngoài vùng bóng trục (x <= -2400) */
text('VAN_BAN', -5800, H - 200, 220, 'GHI CHU:');
text('VAN_BAN', -5800, H - 700, 180, '1. Kich thuoc tinh bang mm.');
text('VAN_BAN', -5800, H - 1100, 180, '2. Tuong bao 220, tuong ngan 110.');
text('VAN_BAN', -5800, H - 1500, 180, '3. Cao do san hoan thien +0.000.');
text('VAN_BAN', -5800, H - 1900, 180, '4. Kiem tra hien truong truoc thi cong.');

/* hướng Bắc */
circle('VAN_BAN', -4200, 1600, 700);
solid('VAN_BAN', [[-4200, 2400], [-4450, 900], [-4200, 1200], [-4200, 1200]]);
solid('VAN_BAN', [[-4200, 2400], [-3950, 900], [-4200, 1200], [-4200, 1200]]);
text('VAN_BAN', -4200, 2500, 200, 'N', { halign: 1 });

/* ================= KHUNG TÊN ================= */
/* Tờ A3 ngang: 26600 x 18600 đơn vị vẽ (~ tỷ lệ 1.43, xấp xỉ A3 1.414).
   Dải khung tên nằm dưới cùng bên phải, thấp hơn chuỗi kích thước ngang (y >= -3200). */
const PX1 = -6200, PY1 = -7000, PX2 = 20400, PY2 = 11600;
rect('KHUNG_TEN', PX1, PY1, PX2, PY2);
rect('KHUNG_TEN', PX1 + 300, PY1 + 300, PX2 - 300, PY2 - 300);
const bx = PX2 - 300, by = PY1 + 300, bw = 7600, bh = 3000;
rect('KHUNG_TEN', bx - bw, by, bx, by + bh);
[600, 1100, 1700, 2300].forEach(function (dy) { line('KHUNG_TEN', bx - bw, by + dy, bx, by + dy); });
line('KHUNG_TEN', bx - bw + 3200, by, bx - bw + 3200, by + 1700);
text('KHUNG_TEN', bx - bw + 200, by + 2550, 300, 'CONG TY CP XAY DUNG DEMO');
text('KHUNG_TEN', bx - bw + 200, by + 1900, 200, 'DU AN: CHUNG CU SUNRISE TOWER - BLOCK A');
text('KHUNG_TEN', bx - bw + 200, by + 1300, 220, 'MAT BANG CAN HO A-01.02');
text('KHUNG_TEN', bx - bw + 200, by + 800, 180, 'TY LE: 1/100');
text('KHUNG_TEN', bx - bw + 200, by + 350, 180, 'NGAY: 04/09/2026');
text('KHUNG_TEN', bx - bw + 3400, by + 1300, 180, 'SO HIEU BAN VE:');
text('KHUNG_TEN', bx - bw + 3400, by + 800, 300, 'KT-02-A0102');
text('KHUNG_TEN', bx - bw + 3400, by + 350, 180, 'GIAI DOAN: THIET KE KY THUAT');
text('KHUNG_TEN', PX1 + 600, PY2 - 1000, 420, 'MAT BANG BO TRI NOI THAT - CAN HO A-01.02');
text('KHUNG_TEN', PX1 + 600, PY2 - 1600, 220, 'TAI LIEU NOI BO - KHONG PHO BIEN RA NGOAI');

/* ================= xuất file ================= */
const LTYPES = [
  { n: 'CONTINUOUS', d: 'Solid line', pat: [] },
  { n: 'DASHED', d: '__ __ __ __', pat: [400, -200] },
  { n: 'CENTER', d: '____ _ ____', pat: [1000, -250, 250, -250] }
];
const LAYERS = [
  { n: '0', c: 7, lt: 'CONTINUOUS' },
  { n: 'TUONG', c: 7, lt: 'CONTINUOUS' },
  { n: 'CUA_SO', c: 4, lt: 'CONTINUOUS' },
  { n: 'THIET_BI', c: 6, lt: 'CONTINUOUS' },
  { n: 'HATCH', c: 8, lt: 'CONTINUOUS' },
  { n: 'TRUC', c: 1, lt: 'CENTER' },
  { n: 'KICH_THUOC', c: 3, lt: 'CONTINUOUS' },
  { n: 'VAN_BAN', c: 2, lt: 'CONTINUOUS' },
  { n: 'KHUNG_TEN', c: 5, lt: 'CONTINUOUS' }
];

let out = '';
out += P(0, 'SECTION') + P(2, 'HEADER');
out += P(9, '$ACADVER') + P(1, 'AC1009');
out += P(9, '$INSUNITS') + P(70, 4);
out += P(9, '$EXTMIN') + P(10, F(PX1)) + P(20, F(PY1)) + P(30, '0.0');
out += P(9, '$EXTMAX') + P(10, F(PX2)) + P(20, F(PY2)) + P(30, '0.0');
out += P(0, 'ENDSEC');

out += P(0, 'SECTION') + P(2, 'TABLES');
out += P(0, 'TABLE') + P(2, 'LTYPE') + P(70, LTYPES.length);
for (const L of LTYPES) {
  out += P(0, 'LTYPE') + P(2, L.n) + P(70, 0) + P(3, L.d) + P(72, 65) + P(73, L.pat.length) +
    P(40, F(L.pat.reduce(function (a, b) { return a + Math.abs(b); }, 0)));
  for (const p of L.pat) out += P(49, F(p));
}
out += P(0, 'ENDTAB');
out += P(0, 'TABLE') + P(2, 'LAYER') + P(70, LAYERS.length);
for (const L of LAYERS) out += P(0, 'LAYER') + P(2, L.n) + P(70, 0) + P(62, L.c) + P(6, L.lt);
out += P(0, 'ENDTAB');
out += P(0, 'TABLE') + P(2, 'STYLE') + P(70, 1) +
  P(0, 'STYLE') + P(2, 'STANDARD') + P(70, 0) + P(40, '0.0') + P(41, '1.0') + P(50, '0.0') +
  P(71, 0) + P(42, '2.5') + P(3, 'txt') + P(4, '') + P(0, 'ENDTAB');
out += P(0, 'ENDSEC');

out += P(0, 'SECTION') + P(2, 'ENTITIES') + ents.join('') + P(0, 'ENDSEC');
out += P(0, 'EOF');

/* DXF R12 trung gian. Bản phát hành là DWG — chạy tiếp `node tools/make-dwg.js`. */
fs.writeFileSync(path.join(ROOT, 'sample', '_build.dxf'), out, 'utf8');

console.log('OK  entities=' + ents.length + '  dxf=' + out.length + ' bytes -> sample/_build.dxf');
console.log('    buoc tiep theo: node tools/make-dwg.js');
