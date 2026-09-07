/*
 * test-parse.js — Kiểm thử bộ đọc DWG + DXF ngoài trình duyệt.
 *   node tools/test-parse.js
 *
 * Đọc thẳng sample/MB-CH-A0102.dwg bằng LibreDWG bản WASM (đúng bộ mà web dùng),
 * rồi parse bằng js/dxf-parser.js và kiểm tra số liệu.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EXPECT_ENTITIES = 251;
const EXPECT_LAYERS = 9;

/* --- nạp dxf-parser.js vào một sandbox giả lập window --- */
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'dxf-parser.js'), 'utf8'), sandbox);
const DXF = sandbox.window.DXF;

/* --- LibreDWG WASM (bản UMD chạy được trong Node) --- */
let LibreDwg;
try {
  ({ LibreDwg } = require(path.join(ROOT, 'js/vendor/libredwg/dist/libredwg-web.js')));
} catch (e) {
  console.error('Không nạp được LibreDWG WASM: ' + e.message);
  process.exit(1);
}

(async () => {
  const dwgPath = path.join(ROOT, 'sample', 'MB-CH-A0102.dwg');
  const raw = fs.readFileSync(dwgPath);
  const sig = raw.slice(0, 6).toString('ascii');

  const dwg = await LibreDwg.create(path.join(ROOT, 'js/vendor/libredwg/wasm/') + path.sep);
  const bytes = dwg.dwg_write_dxf(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  if (!bytes) { console.error('LibreDWG không đọc được ' + dwgPath); process.exit(1); }

  const doc = DXF.parse(Buffer.from(bytes).toString('utf8'));

  const byType = {}, byLayer = {};
  doc.entities.forEach(e => {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byLayer[e.layer] = (byLayer[e.layer] || 0) + 1;
  });

  console.log('File     : sample/MB-CH-A0102.dwg  [' + sig + ']  ' + raw.length + ' bytes');
  console.log('Entities : ' + doc.entities.length);
  console.log('By type  : ' + JSON.stringify(byType));
  console.log('Layers   : ' + Object.keys(doc.layers).join(', '));
  console.log('Extents  : ' + JSON.stringify(doc.extents));

  let bad = 0;
  const fail = (m) => { if (bad++ < 6) console.log('  !! ' + m); };

  doc.entities.forEach((e, i) => {
    const vals = ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'x', 'y', 'h']
      .filter(k => k in e).map(k => e[k]);
    if (vals.some(v => typeof v !== 'number' || !isFinite(v))) fail('entity ' + i + ' ' + e.type + ' co so khong hop le');
    if (e.type === 'TEXT' && !e.text) fail('TEXT rong tai ' + i);
  });

  /* Layer bật/tắt: LibreDWG bản WASM ghi 62 = -7 cho mọi layer (nghĩa là TẮT),
     parser phải nhận ra dữ liệu vô lý đó và bật lại — nếu không bản vẽ sẽ trắng trơn. */
  const off = Object.keys(doc.layers).filter(n => doc.layers[n].off);
  if (off.length) fail('con ' + off.length + ' layer bi coi la TAT: ' + off.join(','));

  /* Nhãn trục phải nằm đúng chỗ, không dồn về gốc toạ độ (lỗi group 11/21 = 0,0) */
  const axis = doc.entities.filter(e => e.type === 'TEXT' && ['A', 'B', 'C', '1', '2', '3'].includes(e.text));
  const piled = axis.filter(e => e.x === 0 && e.y === 0);
  if (axis.length < 6) fail('thieu nhan truc: chi tim thay ' + axis.length + '/6');
  if (piled.length > 1) fail(piled.length + ' nhan truc bi don ve goc toa do');

  const okEnt = doc.entities.length === EXPECT_ENTITIES;
  const okLay = Object.keys(doc.layers).length === EXPECT_LAYERS;

  console.log('');
  console.log((bad === 0 ? 'OK  ' : 'LOI ') + (bad === 0 ? 'khong co du lieu loi' : bad + ' van de'));
  console.log((okEnt ? 'OK  ' : 'LECH ') + 'entity: ' + doc.entities.length + '/' + EXPECT_ENTITIES);
  console.log((okLay ? 'OK  ' : 'LECH ') + 'layer : ' + Object.keys(doc.layers).length + '/' + EXPECT_LAYERS);

  process.exit(bad === 0 && okEnt && okLay ? 0 : 1);
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
