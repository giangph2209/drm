/*
 * app.js — Wires everything together.
 *
 * Flow: embedded DWG (base64) -> LibreDWG WASM -> DXF -> parse -> read-only lock
 *       -> viewer -> layer/layout -> watermark -> DRM -> PDF export.
 * The user can also open another .dwg file from disk; it is read locally, never uploaded.
 */
(function () {
  'use strict';

  /* ---------- Viewer profile (in production, taken from the login session) ---------- */
  var USER = {
    name: 'John Smith',
    email: 'john.smith@demo-construction.com',
    phone: '555-0142',
    role: 'M&E Contractor',
    company: 'DEMO CONSTRUCTION JSC'
  };
  var DOC = {
    title: 'Interior Layout Plan — Apartment A-01.02',
    code: 'KT-02-A0102',
    rev: 'C'
  };

  /* ---------- Layout: each layout = one combination of layers ---------- */
  var LAYOUTS = [
    { id: 'a3', name: 'A3 Layout — Full print', desc: 'All layers, with title block', hide: [] },
    { id: 'model', name: 'Model — Floor plan', desc: 'Drawing only, title block hidden', hide: ['KHUNG_TEN'] },
    { id: 'kt', name: 'Architecture — No furniture', desc: 'Hides equipment, hatch and title block', hide: ['KHUNG_TEN', 'THIET_BI', 'HATCH'] },
    { id: 'dim', name: 'Grid &amp; dimensions', desc: 'Walls, grid lines and dimensions only', hide: ['KHUNG_TEN', 'THIET_BI', 'HATCH', 'VAN_BAN', 'CUA_SO'] }
  ];
  var LAYER_LABEL = {
    'TUONG': 'Walls', 'CUA_SO': 'Doors / windows', 'THIET_BI': 'Equipment — Furniture',
    'HATCH': 'Floor hatch', 'TRUC': 'Grid lines', 'KICH_THUOC': 'Dimensions',
    'VAN_BAN': 'Text — Notes', 'KHUNG_TEN': 'Title block', '0': 'Layer 0'
  };

  var $ = function (id) { return document.getElementById(id); };
  var sessionId = genSession();
  var startedAt = new Date();
  var violations = [];
  /* Only true once the browser has confirmed it can write the clipboard (via the gate
     in section 9). Locks both VIEW (the gate covers the app) and DOWNLOAD (the guard in
     the PDF export handler, section 7): no permission -> no viewing, no downloading. */
  var clipboardOK = false;
  /* true while DevTools is open -> hide the drawing at the canvas layer. We remember the
     state so that if the drawing finishes loading while DevTools is open, it still shows
     the hidden screen immediately. */
  var devtoolsOpen = false;

  /* ================= 1. Watermark (viewer identity — fixed) ================= */
  var wm = {
    text: 'JOHN SMITH · 555-0142',
    sub: fmtTime(startedAt) + '  ·  ' + sessionId,
    opacity: 0.13,
    size: 42,
    color: '#ffffff'
  };

  /* ================= 2. Currently-open document state ================= */
  var doc = null;          // drawing data tree (frozen)
  var viewer = null;       // the viewer
  var currentLayout = null;
  var layerRows = {};
  var srcInfo = { format: 'DWG', version: 'AutoCAD 2000', name: 'MB-CH-A0102' };

  var layoutBox = $('layouts');
  var layerBox = $('layers');

  /* The preset layouts only match the sample drawing. A file the user opens has completely
     different layer names, so in that case we fall back to a single "whole drawing" layout. */
  function layoutsFor(d) {
    var known = ['TUONG', 'KHUNG_TEN', 'THIET_BI', 'KICH_THUOC'];
    var hit = known.filter(function (n) { return d.layers[n]; }).length;
    if (hit >= 3) return LAYOUTS;
    return [{ id: 'all', name: 'Whole drawing', desc: 'Show every layer in the file', hide: [] }];
  }

  /*
   * Load a new drawing. The argument is the DXF string LibreDWG WASM produces from the DWG
   * file (DXF here is just an in-memory intermediate format, never exposed in the UI).
   * The old viewer is discarded and rebuilt from scratch.
   */
  function loadDocument(dxfText, info) {
    var d = window.DXF.parse(dxfText);
    if (!d.entities.length) throw new Error('The file has no objects to display.');

    /* Truly read-only: freeze the entire data tree. After this, every write/delete on an
       entity is silently ignored by JS (and throws in strict mode). */
    deepFreeze(d.entities);
    deepFreeze(d.layers);
    Object.freeze(d.extents);

    doc = d;
    srcInfo = info;

    viewer = new window.Viewer($('cad'), doc, {
      bg: '#1e2532',
      watermark: wm,
      onCoord: function (w) {
        $('ov-coord').textContent = w
          ? 'X: ' + fmt(w.x) + '   Y: ' + fmt(w.y)
          : 'X: —   Y: —';
      }
    });

    buildLayouts(layoutsFor(doc));
    buildLayerList();
    viewer.applyLayout(currentLayout);
    viewer.fit();
    paintDocInfo();
    /* If DevTools is open OR clipboard permission was lost as the drawing loaded: hide it
       immediately, don't let a single frame flash through. */
    applySuppress();
  }

  /* -- layout list -- */
  function buildLayouts(list) {
    currentLayout = list[0];
    if (!layoutBox) return;
    layoutBox.innerHTML = '';
    list.forEach(function (L, i) {
      var el = document.createElement('label');
      el.className = 'layout-item' + (i === 0 ? ' on' : '');
      el.innerHTML = '<input type="radio" name="lay" ' + (i === 0 ? 'checked' : '') + '>' +
        '<div><b>' + L.name + '</b><span>' + L.desc + '</span></div>';
      el.querySelector('input').addEventListener('change', function () {
        [].forEach.call(layoutBox.children, function (c) { c.classList.remove('on'); });
        el.classList.add('on');
        viewer.applyLayout(L);
        syncLayerList();
        viewer.fit();
        currentLayout = L;
      });
      layoutBox.appendChild(el);
    });
  }

  /* -- layer list -- */
  function buildLayerList() {
    layerRows = {};
    if (!layerBox) return;
    var counts = {};
    doc.entities.forEach(function (e) { counts[e.layer] = (counts[e.layer] || 0) + 1; });
    layerBox.innerHTML = '';
    Object.keys(doc.layers).sort().forEach(function (name) {
      var ly = doc.layers[name];
      var row = document.createElement('label');
      row.className = 'layer';
      row.innerHTML =
        '<input type="checkbox" checked>' +
        '<span class="swatch" style="background:' + ly.color + '"></span>' +
        '<span class="nm"></span>' +
        '<span class="ct">' + (counts[name] || 0) + '</span>';
      row.querySelector('.nm').textContent = LAYER_LABEL[name] || name;
      var cb = row.querySelector('input');
      cb.addEventListener('change', function () {
        viewer.setLayerVisible(name, cb.checked);
        row.classList.toggle('off', !cb.checked);
      });
      layerBox.appendChild(row);
      layerRows[name] = { row: row, cb: cb };
    });
  }

  function syncLayerList() {
    Object.keys(layerRows).forEach(function (n) {
      var on = viewer.isLayerVisible(n);
      layerRows[n].cb.checked = on;
      layerRows[n].row.classList.toggle('off', !on);
    });
  }

  if ($('lay-all')) {
    $('lay-all').addEventListener('click', function () {
      Object.keys(layerRows).forEach(function (n) { viewer.setLayerVisible(n, true); });
      syncLayerList(); viewer.render();
    });
  }

  /* ================= 3. Open another DWG file (read locally, never uploaded) ================= */
  if ($('btn-open') && $('file-input')) {
    $('btn-open').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      openFile(f);
    });
  }

  /* drag & drop a file onto the drawing area */
  var main = document.querySelector('.main');
  ['dragenter', 'dragover'].forEach(function (ev) {
    main.addEventListener(ev, function (e) { e.preventDefault(); main.classList.add('drop'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    main.addEventListener(ev, function (e) { e.preventDefault(); main.classList.remove('drop'); });
  });
  main.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  function openFile(file) {
    var nm = file.name;
    if (!/\.dwg$/i.test(nm)) {
      window.DRM.toast('Only .dwg files are accepted', 'block');
      return;
    }
    setBusy('Reading ' + nm + '…');
    var fr = new FileReader();
    fr.onerror = function () { setBusy(null); window.DRM.toast('Could not read the file.', 'block'); };
    fr.onload = function () {
      window.DWGLoader.toDxf(fr.result)
        .then(function (r) {
          loadDocument(r.dxf, {
            format: r.format,
            version: r.version,
            name: nm.replace(/\.[^.]+$/, '')
          });
          setBusy(null);
          window.DRM.toast('Opened ' + nm + ' · ' + r.version + ' · ' +
            doc.entities.length + ' objects · ' + r.ms + ' ms', 'ok');
          logViolation('open-file', nm + ' (' + r.format + ')');
        })
        .catch(function (err) {
          setBusy(null);
          window.DRM.toast('Error: ' + err.message, 'block');
        });
    };
    fr.readAsArrayBuffer(file);
  }

  function setBusy(msg) {
    var el = $('busy');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function paintDocInfo() {
    $('ent-count').textContent = doc.entities.length;
    $('st-size').textContent = Object.keys(doc.layers).length + ' layers';
    $('st-format').textContent = (srcInfo.version && srcInfo.version !== srcInfo.format)
      ? (srcInfo.format + ' · ' + srcInfo.version)
      : srcInfo.format;
    $('doc-name').textContent = srcInfo.name;
    $('badge-fmt').textContent = srcInfo.format;
  }

  /* ================= 5. Toolbar ================= */
  $('btn-fit').addEventListener('click', function () { viewer.fit(); });
  $('t-fit').addEventListener('click', function () { viewer.fit(); });
  $('t-zin').addEventListener('click', function () { viewer.zoomAt(viewer.W / 2, viewer.H / 2, 1.3); });
  $('t-zout').addEventListener('click', function () { viewer.zoomAt(viewer.W / 2, viewer.H / 2, 1 / 1.3); });
  $('t-grid').addEventListener('click', function () {
    viewer.opts.grid = viewer.opts.grid === false;
    viewer.render();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.target.tagName === 'INPUT') return;
    if (ev.key === 'f' || ev.key === 'F') viewer.fit();
  });

  /* ================= 6. DRM — always on, no off switch ================= */
  window.DRM.init({
    wipeNote: 'Anh chup man hinh da bi vo hieu hoa - ban ve ' + DOC.code +
      ' thuoc tai lieu kiem soat - cap cho ' + USER.email + ' - phien ' + sessionId,
    /* Printed onto the warning image pasted over the clipboard: who captured, which drawing, when */
    wipeLines: [
      'Drawing: ' + DOC.code + ' Rev.' + DOC.rev,
      'Issued to: ' + USER.name + ' · ' + USER.email,
      'Viewing session: ' + sessionId + ' · ' + fmtTime(startedAt)
    ],
    onViolation: logViolation,
    /* DevTools open -> hide the drawing (canvas draws no entities); closed -> show again. */
    onDevtools: function (open) {
      devtoolsOpen = open;
      applySuppress();
    },
    /* Each time drm.js wipes the clipboard: ok=false means the clipboard could not be
       written right now -> the anti-screenshot layer is dead -> downgrade to "no permission". */
    onWipe: function (ok) {
      /* Do NOT hide the drawing just because one clipboard write failed: writing the
         clipboard requires the document to be focused, so during focus in/out it can fail
         transiently even while permission is still granted. Re-verify the REAL permission
         via the Permissions API before deciding. */
      if (!ok) reverifyClipboard('wipe-failed');
    }
  });

  /* ---- Clipboard permission = source of truth for DISPLAY + DOWNLOAD ----
     clipboardOK reflects the browser's ACTUAL permission right now (read via the Permissions
     API + kept current by onchange, and downgraded if a clipboard wipe fails). No permission
     -> hide the drawing (blank canvas) + show the instruction gate + lock download.
     Permission back -> auto-display, no reload needed. */
  var drawingLoaded = false;
  var clipEvaluated = false;

  function applySuppress() {
    if (!viewer) return;
    viewer.setSuppressed(devtoolsOpen || !clipboardOK,
      (!clipboardOK && !devtoolsOpen)
        ? 'No Clipboard permission yet — open the browser permission settings for this page to view.'
        : undefined);
  }

  function applyClipboard(granted, reason) {
    granted = !!granted;
    var changed = granted !== clipboardOK;
    clipboardOK = granted;               // lock/unlock the Export PDF button (section 7)
    applySuppress();                     // hide/show the canvas
    showGate(!granted);                  // show/hide the instruction gate
    if (granted && !drawingLoaded) { drawingLoaded = true; loadEmbeddedDrawing(); }
    if (changed && clipEvaluated) {
      if (granted) {
        logViolation('clipboard-granted', reason || '');
        window.DRM.toast('Clipboard permission granted — displaying the drawing.', 'ok');
      } else {
        logViolation('clipboard-blocked', reason || '');
        window.DRM.toast('No Clipboard permission — the drawing is hidden and cannot be downloaded.', 'block');
      }
    }
    clipEvaluated = true;
  }

  /* A single clipboard-wipe failure MIGHT just be the page briefly losing focus (writing
     the clipboard requires the document to be focused) rather than losing permission ->
     don't hide the drawing hastily.
     - With the Permissions API: re-query the permission state (focus-independent); only
       block if it is genuinely not 'granted'. If still 'granted' -> ignore (focus noise).
     - Without the Permissions API: only block if the page is focused (rules out the
       "not focused" error).
     A real revocation on Chromium is still caught independently via onchange in section 9. */
  function reverifyClipboard(reason) {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'clipboard-write' }).then(function (st) {
        if (st.state !== 'granted') setGateMsg(CLIP_MSG.blocked);
        applyClipboard(st.state === 'granted', 'reverify:' + st.state);
      }).catch(function () {
        if (document.hasFocus()) { setGateMsg(CLIP_MSG.blocked); applyClipboard(false, reason); }
      });
    } else if (document.hasFocus()) {
      setGateMsg(CLIP_MSG.blocked);
      applyClipboard(false, reason);
    }
  }

  function logViolation(type, detail) {
    violations.push({ t: new Date(), type: type, detail: detail });
    $('log-count').textContent = violations.length;
    var box = $('viol-log');
    if (box) {
      if (violations.length === 1) box.innerHTML = '';
      var line = document.createElement('div');
      line.textContent = fmtClock(new Date()) + '  ' + type + (detail ? ' (' + detail + ')' : '');
      line.style.color = '#8b6f4a';
      box.insertBefore(line, box.firstChild);
      while (box.children.length > 12) box.removeChild(box.lastChild);
    }
    /* In production: POST /api/audit {user, doc, type, detail, ts} — can't block, but leaves a trace */
  }

  /* ================= 7. PDF Export ================= */
  var xPaper = 'a3', xMode = 'bw';
  bindSeg('seg-paper', function (v) { xPaper = v; });
  bindSeg('seg-mode', function (v) { xMode = v; });
  function bindSeg(id, cb) {
    var box = $(id);
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      [].forEach.call(box.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      cb(b.dataset.v);
    });
  }

  $('btn-export').addEventListener('click', function () { $('modal').classList.add('on'); });
  $('x-cancel').addEventListener('click', function () { $('modal').classList.remove('on'); });
  $('modal').addEventListener('click', function (ev) {
    if (ev.target === this) this.classList.remove('on');
  });

  $('x-go').addEventListener('click', function () {
    var btn = this;
    /* Download guard: with no active clipboard permission, do NOT export a file.
       Policy: without the anti-screenshot layer -> don't release the document out of the browser. */
    if (!clipboardOK) {
      window.DRM.toast('An active Clipboard permission is required to download the PDF. Grant it and try again.', 'block');
      logViolation('export-blocked', 'no-clipboard');
      return;
    }
    btn.disabled = true; btn.textContent = 'Rendering…';
    setTimeout(function () {
      try {
        var now = new Date();
        /* Fixed: only render the currently-visible layers — no UI option for this anymore. */
        var r = window.ExportPDF.run(doc, viewer, {
          user: USER.name + ' <' + USER.email + '>',
          company: USER.company,
          title: DOC.title,
          docCode: DOC.code + ' Rev.' + DOC.rev,
          layoutName: stripTags(currentLayout.name),
          time: fmtTime(now),
          paper: xPaper,
          mode: xMode,
          /* Fixed policy — no off switch in the UI: every exported PDF carries the
             watermark and the no-print / no-copy flags. */
          protect: true,
          watermarkText: wm.text,
          watermarkSub: fmtTime(now) + ' · ' + USER.email,
          wmOpacity: 0.14
        });
        /* Filename = readable (de-accented) title + drawing code + downloader + trace id.
           Because the encrypted PDF writes no /Title (to avoid garbled text), the reader's
           title bar falls back to the FILENAME -> a readable filename is how we show a clean
           title in every viewer. */
        var safe = function (s) { return String(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim(); };
        r.pdf.save(safe(r.title) + ' - ' + safe(DOC.code) + ' - ' + USER.email.split('@')[0] + ' - ' + r.traceId + '.pdf');
        $('modal').classList.remove('on');
        window.DRM.toast('PDF exported · ' + r.count + ' objects · trace id ' + r.traceId, 'ok');
        logViolation('export-pdf', r.traceId);
      } catch (err) {
        window.DRM.toast('Export error: ' + err.message, 'block');
        console.error(err);
      }
      btn.disabled = false; btn.textContent = 'Render & download';
    }, 60);
  });

  /* ================= 8. Viewer identity shown in the UI ================= */
  $('u-name').textContent = USER.name;
  $('u-role').textContent = USER.role + ' · Access: VIEW + DOWNLOAD PDF';
  $('ava').textContent = initials(USER.name);
  $('ov-user').textContent = USER.email;
  $('ov-session').textContent = sessionId;

  /* ================= 9. Check the real Clipboard permission ================= */
  /*
   * Policy: the anti-screenshot layer (drm.js) protects the document by OVERWRITING the
   * clipboard. So on ENTRY, read the browser's ACTUAL clipboard permission:
   *   - Granted        -> display the drawing, allow download.
   *   - Not yet/denied -> temporarily hide the drawing + lock download + show instructions
   *     for the user to enable it THEMSELVES in the browser permission settings. When the
   *     permission changes (onchange) -> auto-display again, no reload needed.
   */
  var CLIP_MSG = {
    checking: 'Checking the browser Clipboard permission…',
    blocked: 'The browser is blocking / has not granted the Clipboard permission for this page. Open the ' +
      'page permission settings (click the 🔒/⚙ icon next to the address bar → Site settings → Clipboard → ' +
      'select Allow) — the page will display again automatically. Or click “Retry”.',
    insecure: 'The page is not served over HTTPS, so the Clipboard API is locked by the browser — the document cannot be protected. Please open it over https.',
    unsupported: 'This browser does not support the required Clipboard API. Please use a recent Chrome/Edge.',
    needProbe: 'This browser does not allow reading the permission state. Click “Check & open drawing” to confirm the Clipboard permission.'
  };

  /* 1x1 png to test the exact IMAGE-write path the protection layer uses (not just text) */
  function probeImage() {
    return new Promise(function (res, rej) {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      c.toBlob(function (b) { b ? res(b) : rej('unsupported'); }, 'image/png');
    });
  }

  /* Actually WRITE to the clipboard — used by the button (needs a user gesture) and by
     browsers that can't read the permission state. Rejects with a code: insecure/unsupported/denied. */
  function probeClipboard() {
    if (!window.isSecureContext) return Promise.reject('insecure');
    if (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem) {
      return Promise.reject('unsupported');
    }
    return probeImage().then(function (img) {
      return navigator.clipboard.write([new window.ClipboardItem({
        'image/png': img,
        'text/plain': new Blob(['[Clipboard permission check - drawing distribution system]'], { type: 'text/plain' })
      })]);
    }).catch(function (e) {
      throw (e && e.name === 'NotAllowedError') ? 'denied' : (typeof e === 'string' ? e : 'denied');
    });
  }

  /* ---- Instruction gate (built once, shown/hidden by permission) ---- */
  var gateEl = null;
  function ensureGate() {
    if (gateEl) return gateEl;
    gateEl = document.createElement('div');
    gateEl.id = 'drm-gate';
    gateEl.innerHTML =
      '<div class="drm-gate-box">' +
      '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.6">' +
      '<path d="M12 2 4 5.5v6c0 5 3.4 9.2 8 10.5 4.6-1.3 8-5.5 8-10.5v-6L12 2Z"/>' +
      '<path d="m9.5 12 1.9 1.9L15 10"/></svg>' +
      '<h2>Clipboard permission required</h2>' +
      '<p>Drawing <b>' + DOC.code + '</b> is only displayed and downloadable when the browser grants the ' +
      '<b>Clipboard</b> permission — because the anti-screenshot layer protects the document right on the clipboard.</p>' +
      '<div class="gate-err" id="gate-msg"></div>' +
      '<button id="gate-btn" type="button">Retry</button>' +
      '</div>';
    document.body.appendChild(gateEl);
    gateEl.querySelector('#gate-btn').addEventListener('click', tryProbe);
    return gateEl;
  }
  function showGate(show) { ensureGate().style.display = show ? 'grid' : 'none'; }
  function setGateMsg(t) { ensureGate().querySelector('#gate-msg').textContent = t; }
  function setGateBtn(text, disabled) {
    var b = ensureGate().querySelector('#gate-btn');
    b.textContent = text; b.disabled = !!disabled;
  }

  /* Button: actually write (with a user gesture). Success -> open; failure -> stay blocked. */
  function tryProbe() {
    setGateBtn('Checking…', true);
    probeClipboard().then(function () {
      applyClipboard(true, 'probe');
    }).catch(function (code) {
      setGateMsg(CLIP_MSG[code] || CLIP_MSG.blocked);
      setGateBtn('Retry', false);
      applyClipboard(false, code);
    });
  }

  /* Read the ACTUAL permission on entry, then watch onchange to auto open/lock. */
  function initClipboard() {
    ensureGate(); showGate(true); setGateMsg(CLIP_MSG.checking); setGateBtn('Retry', false);

    if (!window.isSecureContext) {
      setGateMsg(CLIP_MSG.insecure);
      applyClipboard(false, 'insecure');
      return;
    }
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'clipboard-write' }).then(function (st) {
        applyState(st.state);
        st.onchange = function () { applyState(st.state); };   // user changes it in settings -> auto-update
      }).catch(function () {
        /* The browser can't read the permission state -> the user must click probe (with a gesture) */
        setGateMsg(CLIP_MSG.needProbe); setGateBtn('Check & open drawing', false);
        applyClipboard(false, 'no-perm-api');
      });
    } else {
      setGateMsg(CLIP_MSG.needProbe); setGateBtn('Check & open drawing', false);
      applyClipboard(false, 'no-perm-api');
    }

    function applyState(state) {
      if (state === 'granted') {
        applyClipboard(true, 'state:granted');
      } else {
        setGateMsg(CLIP_MSG.blocked); setGateBtn('Retry', false);
        applyClipboard(false, 'state:' + state);
      }
    }
  }

  /* ================= 10. Load the DWG drawing (only once permission is granted) ================= */
  if (!window.EMBEDDED_DWG) {
    fatal('Embedded drawing not found (data/drawing.js).<br>Run: node tools/gen-dxf.js && node tools/make-dwg.js');
    return;
  }

  /* Called by applyClipboard() exactly once when permission is first granted. */
  function loadEmbeddedDrawing() {
    setBusy('Opening the DWG drawing…');
    var dwgBytes = b64ToBuffer(window.EMBEDDED_DWG);
    /* Drop the reference so the original file can't be copied out from the console */
    try { delete window.EMBEDDED_DWG; } catch (e) { window.EMBEDDED_DWG = null; }

    window.DWGLoader.toDxf(dwgBytes)
      .then(function (r) {
        loadDocument(r.dxf, { format: r.format, version: r.version, name: 'MB-CH-A0102' });
        setBusy(null);
      })
      .catch(function (err) {
        setBusy(null);
        fatal('Could not open the DWG drawing.<br><br>' + err.message);
      });
  }

  initClipboard();

  function fatal(html) {
    document.body.innerHTML =
      '<div style="max-width:620px;margin:12vh auto;padding:28px;font:14px/1.7 \'Segoe UI\',sans-serif;' +
      'color:#dbe3f0;background:#121722;border:1px solid #232b3d;border-radius:12px">' +
      '<h2 style="margin:0 0 10px;font-size:17px;color:#e5484d">Could not open the drawing</h2>' + html + '</div>';
  }

  function b64ToBuffer(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  /* ================= utilities ================= */
  function deepFreeze(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.freeze(o);
    Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    return o;
  }
  function genSession() {
    var s = '';
    for (var i = 0; i < 8; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
    return s.slice(0, 4) + '-' + s.slice(4);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(d) {
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtClock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function initials(n) {
    var p = n.trim().split(/\s+/);
    return (p[0][0] + (p[p.length - 1][0] || '')).toUpperCase();
  }
  function stripTags(s) { var d = document.createElement('div'); d.innerHTML = s; return d.textContent; }
})();
