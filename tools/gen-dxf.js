/*
 * gen-dxf.js — Generate a sample engineering drawing file (DXF R12 / AC1009).
 * Run: node tools/gen-dxf.js
 * Outputs:
 *   sample/MB-CH-A0102.dxf   -> DXF file openable in AutoCAD / BricsCAD / LibreCAD
 *   data/drawing.js          -> same content, embedded directly into the web app (no upload/fetch needed)
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
 * Text. The final release format is DWG, and LibreDWG's DXF -> DWG conversion path
 * LOSES group 72 (horizontal alignment) and overwrites the alignment point 11/21 to 0,0.
 * So we no longer use groups 72/73: we precompute the center / right alignment coordinates
 * here and emit plain left-aligned text. This makes the DXF and DWG render identically.
 */
const CHAR_W = 0.55;   // estimated character width, relative to text height
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
/* two-line wall: axis (x1,y1)->(x2,y2), thickness t */
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
/* door in a horizontal wall */
function doorH(xc, y, w, t, up) {
  const s = up ? 1 : -1;
  line('TUONG', xc - w / 2, y - t / 2, xc - w / 2, y + t / 2);
  line('TUONG', xc + w / 2, y - t / 2, xc + w / 2, y + t / 2);
  line('CUA_SO', xc - w / 2, y, xc - w / 2, y + s * w);
  arc('CUA_SO', xc - w / 2, y, w, up ? 0 : -90, up ? 90 : 0);
}
/* door in a vertical wall */
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

/* ================= APARTMENT FLOOR PLAN ================= */
const T = 220, Ti = 110, W = 12000, H = 8000;
const xm = 6000;      // vertical partition wall, splitting left / right
const ym = 4200;      // horizontal partition wall, RIGHT half  (kitchen | bedroom 02)
const ymL = 5350;     // horizontal partition wall, LEFT half   (living | bedroom 01)

wall(0, 0, W, 0, T);
wall(0, H, W, H, T);
wall(0, 0, 0, H, T);
wall(W, 0, W, H, T);
cap(0, 0, W, 0, T); cap(0, H, W, H, T);

wall(xm, 0, xm, H, Ti);
wall(xm, ym, W, ym, Ti);
wall(0, ymL, xm, ymL, Ti);

doorH(2200, 0, 1000, T, true);          // main door -> living room
winH(4600, 0, 1800, T);
winH(8800, 0, 1600, T);
winH(3000, H, 1800, T);
winH(9200, H, 1600, T);
winV(0, 6600, 1500, T);                 // bedroom 01 window
doorH(4200, ymL, 900, Ti, true);        // living -> bedroom 01 (clears bed & wardrobe)
doorV(xm, 2000, 900, Ti, true);         // living -> kitchen
doorV(xm, 5000, 900, Ti, true);         // living -> bedroom 02

hatchRect('HATCH', xm + Ti / 2 + 60, T / 2 + 60, W - T / 2 - 60, ym - Ti / 2 - 60, 320);

/* interior furniture */
rect('THIET_BI', 700, 1250, 3100, 2100);   /* sofa - raised so it does not overlap the main door swing */
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

/* room labels */
text('VAN_BAN', 2900, 4000, 320, 'LIVING ROOM', { halign: 1 });
text('VAN_BAN', 2900, 3600, 200, '29.2 m2', { halign: 1 });
text('VAN_BAN', 2400, 6300, 320, 'BEDROOM 01', { halign: 1 });
text('VAN_BAN', 2400, 5900, 200, '13.6 m2', { halign: 1 });
text('VAN_BAN', 8900, 2000, 320, 'KITCHEN + DINING', { halign: 1 });
text('VAN_BAN', 8900, 1600, 200, '22.4 m2', { halign: 1 });
text('VAN_BAN', 9400, 6600, 320, 'BEDROOM 02', { halign: 1 });
text('VAN_BAN', 9400, 6200, 200, '20.1 m2', { halign: 1 });
text('VAN_BAN', 2200, -700, 170, 'MAIN DOOR 1000x2200', { halign: 1 });

/* grid axes */
axisV(0, -1200, H + 1200, 'A');
axisV(xm, -1200, H + 1200, 'B');
axisV(W, -1200, H + 1200, 'C');
axisH(0, -1200, W + 1200, '1');
axisH(ym, -1200, W + 1200, '2');
axisH(H, -1200, W + 1200, '3');

/* dimensions — horizontal strings placed below, vertical strings on the RIGHT
   (the left side is reserved for notes + north arrow, to avoid overlap) */
dimH(0, xm, -2100, '6000');
dimH(xm, W, -2100, '6000');
dimH(0, W, -3000, '12000');
dimV(0, ym, W + 1500, '4200');
dimV(ym, H, W + 1500, '3800');
dimV(0, H, W + 2400, '8000');

/* notes — placed outside the axis extension zone (x <= -2400) */
text('VAN_BAN', -5800, H - 200, 220, 'NOTES:');
text('VAN_BAN', -5800, H - 700, 180, '1. Dimensions are in mm.');
text('VAN_BAN', -5800, H - 1100, 180, '2. Exterior walls 220, partition walls 110.');
text('VAN_BAN', -5800, H - 1500, 180, '3. Finished floor level +0.000.');
text('VAN_BAN', -5800, H - 1900, 180, '4. Verify on site before construction.');

/* north arrow */
circle('VAN_BAN', -4200, 1600, 700);
solid('VAN_BAN', [[-4200, 2400], [-4450, 900], [-4200, 1200], [-4200, 1200]]);
solid('VAN_BAN', [[-4200, 2400], [-3950, 900], [-4200, 1200], [-4200, 1200]]);
text('VAN_BAN', -4200, 2500, 200, 'N', { halign: 1 });

/* ================= TITLE BLOCK ================= */
/* A3 landscape sheet: 26600 x 18600 drawing units (~ ratio 1.43, close to A3's 1.414).
   The title block strip sits at the bottom right, below the horizontal dimension strings (y >= -3200). */
const PX1 = -6200, PY1 = -7000, PX2 = 20400, PY2 = 11600;
rect('KHUNG_TEN', PX1, PY1, PX2, PY2);
rect('KHUNG_TEN', PX1 + 300, PY1 + 300, PX2 - 300, PY2 - 300);
const bx = PX2 - 300, by = PY1 + 300, bw = 7600, bh = 3000;
rect('KHUNG_TEN', bx - bw, by, bx, by + bh);
[600, 1100, 1700, 2300].forEach(function (dy) { line('KHUNG_TEN', bx - bw, by + dy, bx, by + dy); });
line('KHUNG_TEN', bx - bw + 3200, by, bx - bw + 3200, by + 1700);
text('KHUNG_TEN', bx - bw + 200, by + 2550, 300, 'DEMO CONSTRUCTION JSC');
text('KHUNG_TEN', bx - bw + 200, by + 1900, 200, 'PROJECT: SUNRISE TOWER APARTMENTS - BLOCK A');
text('KHUNG_TEN', bx - bw + 200, by + 1300, 220, 'APARTMENT A-01.02 FLOOR PLAN');
text('KHUNG_TEN', bx - bw + 200, by + 800, 180, 'SCALE: 1/100');
text('KHUNG_TEN', bx - bw + 200, by + 350, 180, 'DATE: 04/09/2026');
text('KHUNG_TEN', bx - bw + 3400, by + 1300, 180, 'DRAWING NO.:');
text('KHUNG_TEN', bx - bw + 3400, by + 800, 300, 'KT-02-A0102');
text('KHUNG_TEN', bx - bw + 3400, by + 350, 180, 'STAGE: TECHNICAL DESIGN');
text('KHUNG_TEN', PX1 + 600, PY2 - 1000, 420, 'INTERIOR LAYOUT PLAN - APARTMENT A-01.02');
text('KHUNG_TEN', PX1 + 600, PY2 - 1600, 220, 'INTERNAL DOCUMENT - NOT FOR EXTERNAL DISTRIBUTION');

/* ================= file output ================= */
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

/* Intermediate DXF R12. The release format is DWG — run `node tools/make-dwg.js` next. */
fs.writeFileSync(path.join(ROOT, 'sample', '_build.dxf'), out, 'utf8');

console.log('OK  entities=' + ents.length + '  dxf=' + out.length + ' bytes -> sample/_build.dxf');
console.log('    next step: node tools/make-dwg.js');
