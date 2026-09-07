/*
 * test-parse.js — Tests the DWG + DXF reader outside the browser.
 *   node tools/test-parse.js
 *
 * Reads sample/MB-CH-A0102.dwg directly with the WASM build of LibreDWG (the exact
 * build the web app uses), then parses it with js/dxf-parser.js and verifies the data.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EXPECT_ENTITIES = 251;
const EXPECT_LAYERS = 9;

/* --- load dxf-parser.js into a sandbox that fakes a window object --- */
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'dxf-parser.js'), 'utf8'), sandbox);
const DXF = sandbox.window.DXF;

/* --- LibreDWG WASM (the UMD build that runs under Node) --- */
let LibreDwg;
try {
  ({ LibreDwg } = require(path.join(ROOT, 'js/vendor/libredwg/dist/libredwg-web.js')));
} catch (e) {
  console.error('Failed to load LibreDWG WASM: ' + e.message);
  process.exit(1);
}

(async () => {
  const dwgPath = path.join(ROOT, 'sample', 'MB-CH-A0102.dwg');
  const raw = fs.readFileSync(dwgPath);
  const sig = raw.slice(0, 6).toString('ascii');

  const dwg = await LibreDwg.create(path.join(ROOT, 'js/vendor/libredwg/wasm/') + path.sep);
  const bytes = dwg.dwg_write_dxf(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  if (!bytes) { console.error('LibreDWG could not read ' + dwgPath); process.exit(1); }

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
    if (vals.some(v => typeof v !== 'number' || !isFinite(v))) fail('entity ' + i + ' ' + e.type + ' has invalid numbers');
    if (e.type === 'TEXT' && !e.text) fail('empty TEXT at ' + i);
  });

  /* Layer on/off: the WASM build of LibreDWG writes 62 = -7 for every layer (meaning OFF),
     the parser must recognize that nonsensical data and turn them back on — otherwise the
     drawing renders blank. */
  const off = Object.keys(doc.layers).filter(n => doc.layers[n].off);
  if (off.length) fail(off.length + ' layer(s) still treated as OFF: ' + off.join(','));

  /* Axis labels must sit in the right place, not piled at the origin (the group 11/21 = 0,0 bug) */
  const axis = doc.entities.filter(e => e.type === 'TEXT' && ['A', 'B', 'C', '1', '2', '3'].includes(e.text));
  const piled = axis.filter(e => e.x === 0 && e.y === 0);
  if (axis.length < 6) fail('missing axis labels: only found ' + axis.length + '/6');
  if (piled.length > 1) fail(piled.length + ' axis labels piled at the origin');

  const okEnt = doc.entities.length === EXPECT_ENTITIES;
  const okLay = Object.keys(doc.layers).length === EXPECT_LAYERS;

  console.log('');
  console.log((bad === 0 ? 'OK   ' : 'ERR  ') + (bad === 0 ? 'no bad data' : bad + ' issue(s)'));
  console.log((okEnt ? 'OK   ' : 'DIFF ') + 'entity: ' + doc.entities.length + '/' + EXPECT_ENTITIES);
  console.log((okLay ? 'OK   ' : 'DIFF ') + 'layer : ' + Object.keys(doc.layers).length + '/' + EXPECT_LAYERS);

  process.exit(bad === 0 && okEnt && okLay ? 0 : 1);
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
