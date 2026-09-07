/*
 * dwg-loader.js — Read BINARY DWG files right inside the browser.
 *
 * Uses GNU LibreDWG compiled to WebAssembly (@mlightcad/libredwg-web).
 * Flow: .dwg (ArrayBuffer) -> WASM -> DXF string -> DXF.parse() -> canvas.
 *
 * The WASM is ~10 MB, so it is only loaded when the user actually opens a DWG file
 * (the first time takes about 1 second, later times reuse the already-loaded instance).
 *
 * ==========================  COPYRIGHT WARNING  ==========================
 * LibreDWG is GPL-3.0. Embedding it into a closed-source commercial product
 * carries the GPL obligation over the entire product. If a client sells this
 * software, it must be replaced with one of:
 *   - ODA SDK (Open Design Alliance) — commercial license, industry standard
 *   - Autodesk Platform Services    — cloud service, pay per conversion
 *   - ODA File Converter running on a server — check the commercial-use terms carefully
 * See README.md, section "Reading DWG files".
 * =========================================================================
 */
(function (global) {
  'use strict';

  /* Dynamic import() treats a bare relative path as a "bare specifier" and rejects it,
     so we must build an absolute URL from the page's base URL. */
  var BASE = new URL('js/vendor/libredwg/', document.baseURI).href;
  var instance = null;
  var loading = null;

  /* Load the WASM once, reuse it for later files */
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
          throw new Error('Reading DWG requires running over HTTP. Open the project folder and run: npx serve . ' +
            '(browsers block WebAssembly and ES modules when opened via file://)');
        }
        throw new Error('Could not load the DWG reader: ' + err.message);
      });
    return loading;
  }

  /* Detect the format from the file's signature: DWG starts with "AC10xx" */
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
   * Returns { dxf, format, version, ms } — dxf is the DXF string to feed into DXF.parse().
   * A DXF file goes straight through, no WASM needed.
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
      if (!bytes) throw new Error('LibreDWG could not read this DWG file (it may be corrupted or use too new an AutoCAD version).');
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
