/*
 * drm.js — Client-side deterrent layer.
 *
 * READ CAREFULLY BEFORE DEMOING TO A CLIENT:
 * Everything in this file runs in the VIEWER's browser, so it is a DETERRENCE +
 * TRACE fence, not real security. A technically skilled user can still bypass it
 * (disabling JS, using a phone camera, screen-recording software outside the browser,
 * OBS, virtual machines...). The layers that carry real legal/technical value are:
 *   1) an identifying watermark drawn straight into the canvas & into the PDF -> traces who leaked it
 *   2) never sending the original DWG file down to the client
 *   3) logging every violation back to the server
 * Those three points are what should be emphasized when advising a client.
 */
(function (global) {
  'use strict';

  /* All layers below are ALWAYS ON — there is no off switch in the UI. */
  var CFG = {
    blockDevtoolsKeys: true,
    blockContextMenu: true,
    blockSelection: true,
    blockPrint: true,
    blockSave: true,
    printScreenGuard: true,
    wipeOnFocus: true,          // wipe the clipboard whenever the page regains focus (catches Snipping Tool)
    wipeLines: [],              // identifying lines printed onto the warning image
    detectDevtools: true,
    onViolation: null,          // function(type, detail) — hook point for the audit logging API
    onDevtools: null,           // function(open) — reports DevTools open/close to hide/show the drawing
    onWipe: null                // function(ok) — reports each clipboard wipe as SUCCESS/FAILURE
  };

  var doc = global.document;
  var shieldEl = null, toastTimer = null;

  function violate(type, detail) {
    try { if (CFG.onViolation) CFG.onViolation(type, detail || ''); } catch (e) { }
  }

  /* ---------- warning toast ---------- */
  function toast(msg, kind) {
    var el = doc.getElementById('drm-toast');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'drm-toast';
      doc.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'show ' + (kind || 'warn');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 3200);
  }

  /* ---------- content shield ---------- */
  function shield(on, msg) {
    if (!shieldEl) {
      shieldEl = doc.createElement('div');
      shieldEl.id = 'drm-shield';
      shieldEl.innerHTML =
        '<div class="drm-shield-box">' +
        '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.6">' +
        '<path d="M12 2 4 5.5v6c0 5 3.4 9.2 8 10.5 4.6-1.3 8-5.5 8-10.5v-6L12 2Z"/>' +
        '<path d="m9.5 12 1.9 1.9L15 10"/></svg>' +
        '<h3></h3><p></p></div>';
      doc.body.appendChild(shieldEl);
    }
    shieldEl.querySelector('h3').textContent = 'Content has been hidden';
    shieldEl.querySelector('p').textContent = msg || '';
    doc.documentElement.classList.toggle('drm-shielded', !!on);
  }

  /* ---------- 1. Devtools / view-source / save / print shortcuts ---------- */
  function onKeyDown(ev) {
    var k = (ev.key || '').toLowerCase();
    var ctrl = ev.ctrlKey || ev.metaKey;

    if (CFG.blockDevtoolsKeys) {
      if (ev.key === 'F12') { stop(ev); toast('The F12 (DevTools) key has been blocked.'); violate('F12'); return; }
      if (ctrl && ev.shiftKey && ['i', 'j', 'c', 'k', 'e'].indexOf(k) >= 0) {
        stop(ev); toast('The DevTools shortcut has been blocked.'); violate('devtools-key', 'Ctrl+Shift+' + k.toUpperCase()); return;
      }
      if (ctrl && k === 'u') { stop(ev); toast('View source has been blocked.'); violate('view-source'); return; }
    }
    if (CFG.blockPrint && ctrl && k === 'p') {
      stop(ev); toast('Printing has been disabled for this document.', 'block'); violate('print-shortcut'); return;
    }
    if (CFG.blockSave && ctrl && k === 's') {
      stop(ev); toast('Saving the page has been blocked. Use the "Export watermarked PDF" button.'); violate('save-page'); return;
    }
    /* PrintScreen (the "Print Screen / SysRq" key).
       The capture itself CANNOT be blocked: the OS grabs the screenshot at a layer
       below the browser and then (sometimes) sends the key down, so preventDefault()
       has nothing left to cancel. The only thing achievable is to DESTROY the image
       right after it enters the clipboard + log it.

       Each platform sends a DIFFERENT kind of event, and this is the easiest place to
       get wrong:
         Windows + Chrome/Edge : ONLY keyup, NO keydown at all
         Linux/X11             : both keydown and keyup
         GNOME/KDE, macOS      : the desktop swallows the key, the page receives nothing
       That is why we must catch on BOTH directions and then de-duplicate. Catching only
       keydown makes this whole layer silent on Windows — no toast, no blur, and the user
       thinks the system is not working. */
    if (CFG.printScreenGuard && isPrintScreen(ev)) {
      handlePrintScreen('keydown');
      stop(ev);
      return;
    }
    /* Win + Shift + S (Snipping Tool) — we catch the key part, the OS handles the capture.
       The image only enters the clipboard once the user finishes the selection, handled in onFocusBack(). */
    if (CFG.printScreenGuard && ev.shiftKey && (ev.metaKey || ev.key === 'Meta') && k === 's') {
      flashBlur();
      toast('Screen-clipping tool detected — this action has been logged.', 'block');
      violate('snipping-tool');
    }
  }
  function onKeyUp(ev) {
    /* On Windows this is the ONLY path that runs — keydown never arrives. */
    if (CFG.printScreenGuard && isPrintScreen(ev)) {
      handlePrintScreen('keyup');
      stop(ev);
    }
  }
  function stop(ev) { ev.preventDefault(); ev.stopPropagation(); }

  function isPrintScreen(ev) {
    return ev.key === 'PrintScreen' || ev.code === 'PrintScreen' ||
           ev.keyCode === 44 || ev.which === 44;   // older browsers only expose the key code
  }

  /* When a platform sends both keydown and keyup, it is still ONE keypress: it must
     produce a single log line, not two. This also blocks the case where holding the key
     repeats keydown. */
  var lastPS = 0;
  function handlePrintScreen(src) {
    var now = Date.now();
    if (now - lastPS < 700) return;
    lastPS = now;
    wipeBurst();
    flashBlur();
    toast('Screenshot has been disabled. This action has been logged.', 'block');
    violate('printscreen', src);
  }

  /* ---------- clipboard wipe ----------
     Fire several bursts because Windows sometimes pushes the image into the clipboard
     a few dozen milliseconds later than the key event; overwriting only once, as before,
     misses it. */
  var wipeTimers = [];
  function wipeBurst() {
    wipeTimers.forEach(clearTimeout);
    wipeTimers = [0, 60, 180, 400, 900].map(function (d) {
      return setTimeout(wipeClipboard, d);
    });
  }

  /* A warning image pasted over the screenshot just taken. We write an IMAGE, not just
     text, so that when the user pastes into Paint / Word they get this warning card
     instead of the drawing. */
  var warnBlob = null;
  function warningImage() {
    if (warnBlob) return Promise.resolve(warnBlob);
    return new Promise(function (resolve, reject) {
      var c = doc.createElement('canvas');
      c.width = 1280; c.height = 720;
      var g = c.getContext('2d');
      g.fillStyle = '#0b0e14'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = '#e5484d'; g.lineWidth = 6;
      g.strokeRect(28, 28, c.width - 56, c.height - 56);

      g.textAlign = 'center';
      g.fillStyle = '#e5484d';
      g.font = '700 58px "Segoe UI", Arial, sans-serif';
      g.fillText('SCREENSHOT HAS BEEN DISABLED', c.width / 2, 240);

      g.fillStyle = '#dbe3f0';
      g.font = '400 25px "Segoe UI", Arial, sans-serif';
      g.fillText('This drawing is part of a controlled document.', c.width / 2, 305);
      g.fillText('The screenshot attempt has been logged along with your identity.', c.width / 2, 345);

      g.fillStyle = '#8b97ad';
      g.font = '400 21px "Cascadia Mono", Consolas, monospace';
      (CFG.wipeLines || []).forEach(function (line, i) {
        g.fillText(line, c.width / 2, 430 + i * 34);
      });

      c.toBlob(function (b) {
        if (!b) return reject(new Error('toBlob failed'));
        warnBlob = b; resolve(b);
      }, 'image/png');
    });
  }

  /* Report the result of one clipboard wipe. ok=false means the clipboard could NOT be
     written (permission lost / browser blocked it) -> the anti-screenshot layer is
     considered DEAD, and the app must hide the drawing immediately instead of assuming
     it is still safe. */
  function wipeReport(ok) { try { if (CFG.onWipe) CFG.onWipe(!!ok); } catch (e) { } }

  var selfCopy = false;   // allow our own execCommand('copy') to pass through
  function wipeClipboard() {
    /* Writing the clipboard is only allowed while the document is focused. If the page is
       NOT focused (e.g. a delayed burst nibble running after the user has already left the
       tab) then skip it — do not report failure, because that is a "not focused" error, not
       a lost permission. */
    if (doc.hasFocus && !doc.hasFocus()) return;
    var note = '[' + (CFG.wipeNote || 'Screenshot has been disabled by the drawing distribution system') + ']';
    /* Write image + text at the same time: every previous format in the clipboard is wiped clean. */
    if (navigator.clipboard && navigator.clipboard.write && global.ClipboardItem) {
      warningImage().then(function (img) {
        return navigator.clipboard.write([new global.ClipboardItem({
          'image/png': img,
          'text/plain': new Blob([note], { type: 'text/plain' })
        })]);
      }).then(function () { wipeReport(true); })
        .catch(function () { wipeText(note); });   // wipeText reports its own result
      return;
    }
    wipeText(note);
  }
  function wipeText(note) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(note)
          .then(function () { wipeReport(true); })
          .catch(function () { legacyWipe(note); });
      } else legacyWipe(note);
    } catch (e) { legacyWipe(note); }
  }
  function legacyWipe(note) {
    var ok = false;
    try {
      var ta = doc.createElement('textarea');
      ta.value = note;
      ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      doc.body.appendChild(ta); ta.select();
      selfCopy = true;
      ok = doc.execCommand('copy');     // false if the browser blocks it
      selfCopy = false;
      doc.body.removeChild(ta);
    } catch (e) { selfCopy = false; ok = false; }
    /* This is the LAST resort: if even this fails, the clipboard truly cannot be written. */
    wipeReport(ok);
  }

  /* Returning to the page after leaving = the only moment we can catch the Snipping Tool /
     Win+Shift+S, because the image only enters the clipboard once the user finishes the
     selection.
     Trade-off: the user's clipboard is wiped every time they come back to the tab. Turn it
     off with wipeOnFocus: false if it becomes annoying. */
  function onFocusBack() {
    if (!CFG.printScreenGuard || !CFG.wipeOnFocus) return;
    wipeBurst();
  }

  /* a quick one-shot blur so a screenshot (if it slips through) cannot read the lines */
  var flashTimer = null;
  function flashBlur() {
    doc.documentElement.classList.add('drm-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      doc.documentElement.classList.remove('drm-flash');
    }, 1400);
  }

  /* ---------- 2. Right-click / drag-and-drop / text selection ---------- */
  function onContextMenu(ev) {
    if (!CFG.blockContextMenu) return;
    stop(ev);
    toast('Right-click menu is disabled.');
    violate('contextmenu');
  }

  /* ---------- 3. Printing ---------- */
  function onBeforePrint() {
    if (!CFG.blockPrint) return;
    violate('print-dialog');
    toast('This document may not be printed directly.', 'block');
  }

  /* ---------- 4. DevTools detection (window-size heuristic) ---------- */
  var dtOpen = false;
  function detectDevtools() {
    if (!CFG.detectDevtools) return;
    var wGap = global.outerWidth - global.innerWidth;
    var hGap = global.outerHeight - global.innerHeight;
    var open = wGap > 165 || hGap > 165;
    if (open !== dtOpen) {
      dtOpen = open;
      /* Tell the app to hide/show the drawing at the canvas layer (not just blur the overlay). */
      try { if (CFG.onDevtools) CFG.onDevtools(open); } catch (e) { }
      if (open) {
        shield(true, 'Developer tools (DevTools) detected as open. Close DevTools to view the drawing again.');
        violate('devtools-open', 'gap ' + wGap + 'x' + hGap);
      } else {
        shield(false);
      }
    }
  }

  /* ---------- initialization ---------- */
  function init(cfg) {
    Object.assign(CFG, cfg || {});

    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('keyup', onKeyUp, true);
    doc.addEventListener('contextmenu', onContextMenu, true);
    doc.addEventListener('dragstart', function (ev) { stop(ev); }, true);
    doc.addEventListener('copy', function (ev) {
      if (selfCopy) return;                 // DRM's own clipboard-overwrite action
      if (!CFG.blockSelection) return;
      stop(ev); toast('Copying content has been blocked.'); violate('copy');
    }, true);
    if (CFG.blockSelection) doc.documentElement.classList.add('drm-noselect');

    global.addEventListener('focus', onFocusBack);
    global.addEventListener('beforeprint', onBeforePrint);
    if (global.matchMedia) {
      var mq = global.matchMedia('print');
      if (mq.addEventListener) mq.addEventListener('change', function (e) { if (e.matches) onBeforePrint(); });
    }

    setInterval(detectDevtools, 900);
    detectDevtools();

    try {
      console.log('%cSTOP', 'color:#e5484d;font:700 42px system-ui');
      console.log('%cThis is a developer-only area. Every action on this document is logged along with the user\'s identity.',
        'color:#c9d1d9;font:14px system-ui');
    } catch (e) { }

    return { toast: toast, shield: shield, config: CFG };
  }

  global.DRM = { init: init, toast: toast, shield: shield };
})(window);
