/*
 * drm.js — Lớp răn đe phía client.
 *
 * ĐỌC KỸ TRƯỚC KHI DEMO CHO KHÁCH:
 * Toàn bộ những gì trong file này chạy trong trình duyệt của NGƯỜI XEM, nên nó là
 * hàng rào RĂN ĐE + GHI VẾT, không phải bảo mật thật. Người dùng có kỹ thuật vẫn có
 * thể vượt (tắt JS, dùng máy ảnh điện thoại, phần mềm quay màn hình ngoài trình duyệt,
 * OBS, máy ảo...). Lớp có giá trị pháp lý/kỹ thuật thật sự là:
 *   1) watermark định danh vẽ thẳng vào canvas & vào PDF  -> truy được người làm rò rỉ
 *   2) không bao giờ gửi file gốc DWG xuống client
 *   3) log mọi hành vi vi phạm về server
 * Ba điểm đó mới là thứ nên nhấn mạnh khi tư vấn.
 */
(function (global) {
  'use strict';

  /* Tất cả các lớp dưới đây LUÔN BẬT — không có công tắc tắt từ giao diện. */
  var CFG = {
    blockDevtoolsKeys: true,
    blockContextMenu: true,
    blockSelection: true,
    blockPrint: true,
    blockSave: true,
    printScreenGuard: true,
    wipeOnFocus: true,          // phá clipboard mỗi khi trang lấy lại focus (bắt Snipping Tool)
    wipeLines: [],              // các dòng định danh in lên ảnh cảnh báo
    detectDevtools: true,
    onViolation: null,          // function(type, detail) — nơi cắm API ghi log audit
    onDevtools: null            // function(open) — báo mở/đóng DevTools để ẩn/hiện bản vẽ
  };

  var doc = global.document;
  var shieldEl = null, toastTimer = null;

  function violate(type, detail) {
    try { if (CFG.onViolation) CFG.onViolation(type, detail || ''); } catch (e) { }
  }

  /* ---------- toast cảnh báo ---------- */
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

  /* ---------- màn che nội dung ---------- */
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
    shieldEl.querySelector('h3').textContent = 'Nội dung đã được che';
    shieldEl.querySelector('p').textContent = msg || '';
    doc.documentElement.classList.toggle('drm-shielded', !!on);
  }

  /* ---------- 1. Phím tắt devtools / xem nguồn / lưu / in ---------- */
  function onKeyDown(ev) {
    var k = (ev.key || '').toLowerCase();
    var ctrl = ev.ctrlKey || ev.metaKey;

    if (CFG.blockDevtoolsKeys) {
      if (ev.key === 'F12') { stop(ev); toast('Phím F12 (DevTools) đã bị chặn.'); violate('F12'); return; }
      if (ctrl && ev.shiftKey && ['i', 'j', 'c', 'k', 'e'].indexOf(k) >= 0) {
        stop(ev); toast('Tổ hợp mở DevTools đã bị chặn.'); violate('devtools-key', 'Ctrl+Shift+' + k.toUpperCase()); return;
      }
      if (ctrl && k === 'u') { stop(ev); toast('Xem mã nguồn đã bị chặn.'); violate('view-source'); return; }
    }
    if (CFG.blockPrint && ctrl && k === 'p') {
      stop(ev); toast('Chức năng In đã bị vô hiệu hoá cho tài liệu này.', 'block'); violate('print-shortcut'); return;
    }
    if (CFG.blockSave && ctrl && k === 's') {
      stop(ev); toast('Lưu trang đã bị chặn. Dùng nút "Xuất PDF có watermark".'); violate('save-page'); return;
    }
    /* PrintScreen (phím ghi "Print Screen / SysRq").
       KHÔNG chặn được việc chụp: OS chụp ảnh ở tầng dưới trình duyệt rồi mới (đôi khi)
       gửi phím xuống, nên preventDefault() không còn gì để huỷ. Thứ duy nhất làm được
       là PHÁ ảnh ngay sau khi nó vào clipboard + ghi nhật ký.

       Mỗi nền tảng gửi một kiểu KHÁC NHAU, đây là chỗ dễ sai nhất:
         Windows + Chrome/Edge : CHỈ có keyup, KHÔNG hề có keydown
         Linux/X11             : có cả keydown lẫn keyup
         GNOME/KDE, macOS      : desktop nuốt phím, trang không nhận được gì
       Vì vậy phải bắt ở CẢ HAI chiều rồi khử trùng lặp. Bắt mỗi keydown thì trên
       Windows toàn bộ lớp này im lặng — không toast, không nhoè, người dùng tưởng
       hệ thống không hoạt động. */
    if (CFG.printScreenGuard && isPrintScreen(ev)) {
      handlePrintScreen('keydown');
      stop(ev);
      return;
    }
    /* Win + Shift + S (Snipping Tool) — bắt được phần phím, phần chụp do OS xử lý.
       Ảnh chỉ vào clipboard lúc người dùng quét xong, xử lý ở onFocusBack(). */
    if (CFG.printScreenGuard && ev.shiftKey && (ev.metaKey || ev.key === 'Meta') && k === 's') {
      flashBlur();
      toast('Phát hiện công cụ cắt màn hình — thao tác đã được ghi nhận.', 'block');
      violate('snipping-tool');
    }
  }
  function onKeyUp(ev) {
    /* Trên Windows đây là đường DUY NHẤT chạy — keydown không bao giờ tới. */
    if (CFG.printScreenGuard && isPrintScreen(ev)) {
      handlePrintScreen('keyup');
      stop(ev);
    }
  }
  function stop(ev) { ev.preventDefault(); ev.stopPropagation(); }

  function isPrintScreen(ev) {
    return ev.key === 'PrintScreen' || ev.code === 'PrintScreen' ||
           ev.keyCode === 44 || ev.which === 44;   // trình duyệt cũ chỉ có mã phím
  }

  /* Nơi nào gửi cả keydown lẫn keyup thì đó vẫn là MỘT lần bấm: phải ra một dòng
     nhật ký, không phải hai. Cũng chặn luôn trường hợp giữ phím gây lặp keydown. */
  var lastPS = 0;
  function handlePrintScreen(src) {
    var now = Date.now();
    if (now - lastPS < 700) return;
    lastPS = now;
    wipeBurst();
    flashBlur();
    toast('Ảnh chụp màn hình đã bị vô hiệu hoá. Thao tác được ghi nhật ký.', 'block');
    violate('printscreen', src);
  }

  /* ---------- phá clipboard ----------
     Bắn nhiều nhịp vì Windows đôi khi đẩy ảnh vào clipboard trễ hơn sự kiện phím
     vài chục mili-giây; ghi đè một lần như trước là bỏ lọt. */
  var wipeTimers = [];
  function wipeBurst() {
    wipeTimers.forEach(clearTimeout);
    wipeTimers = [0, 60, 180, 400, 900].map(function (d) {
      return setTimeout(wipeClipboard, d);
    });
  }

  /* Ảnh cảnh báo dán đè lên ảnh vừa chụp. Ghi ẢNH chứ không chỉ ghi text, để khi dán
     vào Paint / Word người dùng nhận được tấm cảnh báo này thay vì bản vẽ. */
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
      g.fillText('ẢNH CHỤP ĐÃ BỊ VÔ HIỆU HOÁ', c.width / 2, 240);

      g.fillStyle = '#dbe3f0';
      g.font = '400 25px "Segoe UI", Arial, sans-serif';
      g.fillText('Bản vẽ này thuộc tài liệu kiểm soát.', c.width / 2, 305);
      g.fillText('Hành vi chụp màn hình đã được ghi nhật ký kèm định danh của bạn.', c.width / 2, 345);

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

  var selfCopy = false;   // cho phép execCommand('copy') của chính mình đi qua
  function wipeClipboard() {
    var note = '[' + (CFG.wipeNote || 'Anh chup bi vo hieu hoa boi he thong phan phoi ban ve') + ']';
    /* Ghi đồng thời ảnh + text: mọi định dạng cũ trong clipboard bị thay sạch. */
    if (navigator.clipboard && navigator.clipboard.write && global.ClipboardItem) {
      warningImage().then(function (img) {
        return navigator.clipboard.write([new global.ClipboardItem({
          'image/png': img,
          'text/plain': new Blob([note], { type: 'text/plain' })
        })]);
      }).catch(function () { wipeText(note); });
      return;
    }
    wipeText(note);
  }
  function wipeText(note) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(note).catch(function () { legacyWipe(note); });
      } else legacyWipe(note);
    } catch (e) { legacyWipe(note); }
  }
  function legacyWipe(note) {
    try {
      var ta = doc.createElement('textarea');
      ta.value = note;
      ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      doc.body.appendChild(ta); ta.select();
      selfCopy = true;
      doc.execCommand('copy');
      selfCopy = false;
      doc.body.removeChild(ta);
    } catch (e) { selfCopy = false; }
  }

  /* Quay lại trang sau khi rời đi = thời điểm duy nhất bắt được Snipping Tool /
     Win+Shift+S, vì ảnh chỉ vào clipboard khi người dùng quét xong.
     Đánh đổi: clipboard của người dùng bị xoá mỗi lần quay lại tab. Tắt bằng
     wipeOnFocus: false nếu thấy phiền. */
  function onFocusBack() {
    if (!CFG.printScreenGuard || !CFG.wipeOnFocus) return;
    wipeBurst();
  }

  /* nhoè nhanh 1 nhịp để ảnh chụp (nếu lọt) không đọc được nét */
  var flashTimer = null;
  function flashBlur() {
    doc.documentElement.classList.add('drm-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      doc.documentElement.classList.remove('drm-flash');
    }, 1400);
  }

  /* ---------- 2. Chuột phải / kéo thả / bôi đen ---------- */
  function onContextMenu(ev) {
    if (!CFG.blockContextMenu) return;
    stop(ev);
    toast('Menu chuột phải đã bị vô hiệu hoá.');
    violate('contextmenu');
  }

  /* ---------- 3. In ấn ---------- */
  function onBeforePrint() {
    if (!CFG.blockPrint) return;
    violate('print-dialog');
    toast('Tài liệu này không được phép in trực tiếp.', 'block');
  }

  /* ---------- 4. Dò DevTools (heuristic kích thước cửa sổ) ---------- */
  var dtOpen = false;
  function detectDevtools() {
    if (!CFG.detectDevtools) return;
    var wGap = global.outerWidth - global.innerWidth;
    var hGap = global.outerHeight - global.innerHeight;
    var open = wGap > 165 || hGap > 165;
    if (open !== dtOpen) {
      dtOpen = open;
      /* Báo cho app ẩn/hiện bản vẽ ở tầng canvas (không chỉ blur lớp phủ). */
      try { if (CFG.onDevtools) CFG.onDevtools(open); } catch (e) { }
      if (open) {
        shield(true, 'Phát hiện công cụ phát triển (DevTools) đang mở. Đóng DevTools để xem lại bản vẽ.');
        violate('devtools-open', 'gap ' + wGap + 'x' + hGap);
      } else {
        shield(false);
      }
    }
  }

  /* ---------- khởi tạo ---------- */
  function init(cfg) {
    Object.assign(CFG, cfg || {});

    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('keyup', onKeyUp, true);
    doc.addEventListener('contextmenu', onContextMenu, true);
    doc.addEventListener('dragstart', function (ev) { stop(ev); }, true);
    doc.addEventListener('copy', function (ev) {
      if (selfCopy) return;                 // thao tác ghi đè clipboard của chính DRM
      if (!CFG.blockSelection) return;
      stop(ev); toast('Sao chép nội dung đã bị chặn.'); violate('copy');
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
      console.log('%cDỪNG LẠI', 'color:#e5484d;font:700 42px system-ui');
      console.log('%cĐây là khu vực dành cho lập trình viên. Mọi thao tác trên tài liệu này đều được ghi nhật ký kèm định danh người dùng.',
        'color:#c9d1d9;font:14px system-ui');
    } catch (e) { }

    return { toast: toast, shield: shield, config: CFG };
  }

  global.DRM = { init: init, toast: toast, shield: shield };
})(window);
