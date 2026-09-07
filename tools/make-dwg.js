/*
 * make-dwg.js — Sinh file DWG mẫu và nhúng vào web.
 *
 *   node tools/gen-dxf.js     ->  sample/_build.dxf   (DXF R12 trung gian)
 *   node tools/make-dwg.js    ->  sample/MB-CH-A0102.dwg + data/drawing.js
 *
 * PHẢI QUA HAI BƯỚC. Chuyển thẳng DXF R12 -> DWG bằng `dxf2dwg` cho ra file hỏng
 * (đọc lại báo `bit_read_TV buffer overflow`, mất sạch entity, chỉ còn bảng layer).
 * Nguyên nhân: DXF R12 tối giản thiếu BLOCK_RECORD, OBJECTS và handle mà bộ ghi DWG cần.
 * Cho `dxfwrite` chuẩn hoá thành DXF R2000 đầy đủ trước rồi mới `dxf2dwg` thì ra file
 * hợp lệ, giữ nguyên 251 entity và 9 layer.
 *
 *   DXF R12  ──dxfwrite──►  DXF R2000 đầy đủ  ──dxf2dwg──►  DWG (AC1015)
 *
 * Cần bộ nhị phân GNU LibreDWG. Tải bản Windows tại:
 *   https://github.com/LibreDWG/libredwg/releases   (libredwg-<ver>-win64.zip)
 * rồi trỏ biến môi trường LIBREDWG_BIN tới thư mục chứa dxfwrite.exe / dxf2dwg.exe,
 * hoặc đặt chúng vào PATH.
 *
 * Chỉ cần chạy lại khi sửa bản vẽ mẫu. File DWG sinh ra đã có sẵn trong repo.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = process.env.LIBREDWG_BIN || '';
const EXE = process.platform === 'win32' ? '.exe' : '';

function tool(name) {
  return BIN ? path.join(BIN, name + EXE) : name + EXE;
}

function run(name, args) {
  try {
    return execFileSync(tool(name), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error('\nKhông tìm thấy ' + name + EXE + '.');
      console.error('Tải GNU LibreDWG bản Windows rồi đặt LIBREDWG_BIN trỏ tới thư mục chứa nó:');
      console.error('  https://github.com/LibreDWG/libredwg/releases');
      console.error('  set LIBREDWG_BIN=C:\\duong\\dan\\libredwg\n');
      process.exit(1);
    }
    /* LibreDWG hay ghi cảnh báo ra stderr rồi vẫn trả mã khác 0 — cứ đi tiếp,
       bước kiểm tra ở cuối sẽ bắt lỗi thật. */
    return (e.stdout || '') + (e.stderr || '');
  }
}

const srcDxf = path.join(ROOT, 'sample', '_build.dxf');
if (!fs.existsSync(srcDxf)) {
  console.error('Chưa có ' + srcDxf + '. Chạy trước: node tools/gen-dxf.js');
  process.exit(1);
}

const tmpDxf = path.join(os.tmpdir(), 'drm-normalised-' + process.pid + '.dxf');
const outDwg = path.join(ROOT, 'sample', 'MB-CH-A0102.dwg');

console.log('1/3  chuẩn hoá DXF R12 -> DXF R2000 đầy đủ (dxfwrite)');
run('dxfwrite', ['--as', 'r2000', '-y', '-o', tmpDxf, srcDxf]);
if (!fs.existsSync(tmpDxf)) { console.error('dxfwrite không tạo được file.'); process.exit(1); }

console.log('2/3  DXF R2000 -> DWG AC1015 (dxf2dwg)');
run('dxf2dwg', ['--as', 'r2000', '-y', '-o', outDwg, tmpDxf]);
fs.unlinkSync(tmpDxf);
if (!fs.existsSync(outDwg)) { console.error('dxf2dwg không tạo được file.'); process.exit(1); }

const dwg = fs.readFileSync(outDwg);
const sig = dwg.slice(0, 6).toString('ascii');
if (!/^AC10\d\d$/.test(sig)) { console.error('File tạo ra không phải DWG hợp lệ: ' + sig); process.exit(1); }

console.log('3/3  nhúng DWG vào data/drawing.js (base64)');
const js = '/* Bản vẽ DWG nhúng sẵn — sinh tự động bởi tools/make-dwg.js. KHÔNG sửa tay.\n' +
  '   Nguồn: sample/MB-CH-A0102.dwg (' + sig + ', ' + dwg.length + ' bytes) */\n' +
  'window.EMBEDDED_DWG = "' + dwg.toString('base64') + '";\n';
fs.writeFileSync(path.join(ROOT, 'data', 'drawing.js'), js, 'utf8');

console.log('\nOK  ' + sig + '  ' + dwg.length + ' bytes  ->  sample/MB-CH-A0102.dwg');
console.log('    data/drawing.js  ' + js.length + ' bytes (base64)');
