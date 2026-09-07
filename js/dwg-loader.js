/*
 * dwg-loader.js — Đọc file DWG NHỊ PHÂN ngay trong trình duyệt.
 *
 * Dùng GNU LibreDWG biên dịch sang WebAssembly (@mlightcad/libredwg-web).
 * Luồng: .dwg (ArrayBuffer) -> WASM -> chuỗi DXF -> DXF.parse() -> canvas.
 *
 * WASM nặng ~10 MB nên chỉ nạp khi người dùng thực sự mở một file DWG
 * (lần đầu mất khoảng 1 giây, các lần sau dùng lại instance đã nạp).
 *
 * ==========================  CẢNH BÁO BẢN QUYỀN  ==========================
 * LibreDWG là GPL-3.0. Nhúng nó vào một sản phẩm thương mại đóng mã nguồn
 * sẽ kéo theo nghĩa vụ GPL cho toàn bộ sản phẩm. Nếu khách hàng bán phần mềm
 * này thì phải thay bằng:
 *   - ODA SDK (Open Design Alliance) — license thương mại, chuẩn công nghiệp
 *   - Autodesk Platform Services    — dịch vụ đám mây, trả tiền theo lượt convert
 *   - ODA File Converter chạy ở server — kiểm tra kỹ điều khoản dùng thương mại
 * Xem README.md, mục "Đọc file DWG".
 * =========================================================================
 */
(function (global) {
  'use strict';

  /* import() động coi đường dẫn tương đối trần là "bare specifier" và từ chối,
     nên phải dựng URL tuyệt đối từ base URL của trang. */
  var BASE = new URL('js/vendor/libredwg/', document.baseURI).href;
  var instance = null;
  var loading = null;

  /* Nạp WASM một lần, dùng lại cho các file sau */
  function ensure() {
    if (instance) return Promise.resolve(instance);
    if (loading) return loading;
    loading = import(BASE + 'dist/libredwg-web.js')
      .then(function (mod) {
        return mod.LibreDwg.create(BASE + 'wasm/');
      })
      .then(function (inst) {
        instance = inst;
        return inst;
      })
      .catch(function (err) {
        loading = null;
        if (location.protocol === 'file:') {
          throw new Error('Đọc DWG cần chạy qua HTTP. Mở thư mục dự án rồi gõ: npx serve . ' +
            '(trình duyệt chặn WebAssembly và ES module khi mở bằng file://)');
        }
        throw new Error('Không nạp được bộ đọc DWG: ' + err.message);
      });
    return loading;
  }

  /* Nhận diện định dạng qua chữ ký đầu file: DWG bắt đầu bằng "AC10xx" */
  function sniff(buf) {
    var head = new Uint8Array(buf, 0, Math.min(6, buf.byteLength));
    var sig = String.fromCharCode.apply(null, head);
    if (/^AC10\d\d$/.test(sig)) return { kind: 'dwg', sig: sig, version: DWG_VERSIONS[sig] || sig };
    return { kind: 'dxf', sig: null, version: 'DXF' };
  }

  var DWG_VERSIONS = {
    AC1009: 'AutoCAD R12', AC1012: 'AutoCAD R13', AC1014: 'AutoCAD R14',
    AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007',
    AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018'
  };

  /*
   * Trả về { dxf, format, version, ms } — dxf là chuỗi DXF để đưa vào DXF.parse().
   * File DXF thì đi thẳng, không cần WASM.
   */
  function toDxf(buf) {
    var info = sniff(buf);
    var t0 = (global.performance || Date).now();

    if (info.kind === 'dxf') {
      var txt = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
      return Promise.resolve({
        dxf: txt, format: 'DXF', version: 'DXF',
        ms: Math.round((global.performance || Date).now() - t0)
      });
    }

    return ensure().then(function (dwg) {
      var bytes = dwg.dwg_write_dxf(buf);
      if (!bytes) throw new Error('LibreDWG không đọc được file DWG này (có thể hỏng hoặc dùng bản AutoCAD quá mới).');
      return {
        dxf: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
        format: 'DWG',
        version: info.version,
        sig: info.sig,
        ms: Math.round((global.performance || Date).now() - t0)
      };
    });
  }

  global.DWGLoader = {
    toDxf: toDxf,
    sniff: sniff,
    isReady: function () { return !!instance; },
    VERSIONS: DWG_VERSIONS
  };
})(window);
