# DRM Drawing Portal — Demo phân phối bản vẽ có kiểm soát

Website tĩnh (HTML + JS thuần, **không framework, không build, không backend**).
Cần chạy qua một HTTP server bất kỳ vì có dùng WebAssembly.

```
index.html
css/style.css
js/dxf-parser.js     bộ đọc DXF tự viết (LINE, ARC, CIRCLE, TEXT, MTEXT, SOLID,
                     LWPOLYLINE, POLYLINE, ELLIPSE, INSERT + bung BLOCK)
js/viewer.js         render canvas 2D: pan/zoom, layer, linetype, watermark, thước tỷ lệ
js/export-pdf.js     kết xuất PDF VECTOR + watermark + cờ cấm in
js/drm.js            lớp chặn F12 / in / PrintScreen / chuột phải / DevTools
js/app.js            ghép mọi thứ
js/dwg-loader.js     đọc file DWG nhị phân bằng LibreDWG biên dịch WebAssembly
js/vendor/jspdf.umd.min.js   jsPDF 2.5.1 (đã tải sẵn — chạy offline)
js/vendor/libredwg/  GNU LibreDWG bản WASM (~10 MB) — GPL-3.0, xem cảnh báo bên dưới
data/drawing.js      bản vẽ DWG mặc định, nhúng dạng base64 — KHÔNG gọi mạng
sample/MB-CH-A0102.dwg       chính bản vẽ đó, mở được bằng AutoCAD/BricsCAD
sample/sample_2018.dwg       DWG thật của AutoCAD 2018, để thử định dạng đời mới
tools/gen-dxf.js     sinh hình học bản vẽ ra DXF trung gian
tools/make-dwg.js    DXF trung gian -> DWG + nhúng vào data/drawing.js
tools/test-parse.js  kiểm thử: đọc thẳng file DWG rồi kiểm tra số liệu
tools/key-probe.html trang đo: trình duyệt thật sự nhận được sự kiện gì khi bấm phím
```

## Chạy

```
npx serve .        # hoặc: python -m http.server 8080
```

**Bắt buộc chạy qua HTTP.** Mở `index.html` bằng `file://` sẽ không hoạt động: bản vẽ mặc
định cũng là DWG nên cần WebAssembly, mà trình duyệt chặn WASM và ES module qua giao thức
`file://`.

---

## Chỉ đọc DWG

**Hệ thống chỉ làm việc với file DWG nhị phân.** Không có đường DXF nào lộ ra giao diện.

- Bản vẽ mặc định là `sample/MB-CH-A0102.dwg` (AutoCAD 2000), nhúng sẵn dạng base64 trong
  `data/drawing.js` — không gọi mạng, không upload.
- Bấm **"Mở bản vẽ DWG"** hoặc kéo thả để mở file `.dwg` khác. Đọc tại máy bằng
  `FileReader`, **không gửi đi đâu cả**.

Cơ chế: GNU LibreDWG biên dịch sang WebAssembly (`@mlightcad/libredwg-web`, đã tải sẵn vào
`js/vendor/libredwg/`).

```
file .dwg  ──►  WASM LibreDWG  ──►  DXF trong bộ nhớ  ──►  parse  ──►  canvas
 (nhị phân)     ~10 MB, nạp 1 lần    (trung gian, không lộ ra ngoài)
```

DXF vẫn còn trong mã nguồn nhưng chỉ là **định dạng trung gian trong bộ nhớ** — LibreDWG
xuất DXF, `js/dxf-parser.js` đọc DXF đó. Người dùng không bao giờ thấy hay chạm vào nó.

Đã kiểm chứng bằng file DWG thật:

| File | Phiên bản | Kết quả |
|---|---|---|
| `sample/MB-CH-A0102.dwg` | AutoCAD 2000 (AC1015) | 251 đối tượng, 9 layer |
| `sample/sample_2018.dwg` | AutoCAD 2018 (AC1032) | 6 đối tượng, 2 layer, 22 ms |

> **Phải chạy qua HTTP** (`npx serve .`). Mở bằng `file://` thì trình duyệt chặn
> WebAssembly và ES module, ứng dụng sẽ báo lỗi kèm hướng dẫn.

### Tạo lại file DWG mẫu

```
node tools/gen-dxf.js     # hình học -> sample/_build.dxf (DXF R12 trung gian)
node tools/make-dwg.js    # -> sample/MB-CH-A0102.dwg + data/drawing.js
```

`make-dwg.js` cần bộ nhị phân GNU LibreDWG — tải bản Windows ở
[github.com/LibreDWG/libredwg/releases](https://github.com/LibreDWG/libredwg/releases) rồi
đặt `LIBREDWG_BIN` trỏ tới thư mục chứa `dxfwrite.exe` / `dxf2dwg.exe`. Chỉ cần chạy lại khi
sửa bản vẽ mẫu; file DWG sinh ra đã có sẵn trong repo.

**Bắt buộc hai bước.** Chuyển thẳng DXF R12 sang DWG bằng `dxf2dwg` cho ra **file hỏng**:
đọc lại báo `bit_read_TV buffer overflow`, mất sạch entity, chỉ còn bảng layer. Nguyên nhân
là DXF R12 tối giản thiếu `BLOCK_RECORD`, section `OBJECTS` và handle mà bộ ghi DWG cần.
Cho `dxfwrite` chuẩn hoá lên DXF R2000 đầy đủ trước rồi mới `dxf2dwg` thì ra file hợp lệ,
giữ nguyên 251 đối tượng và 9 layer.

### Hai lỗi của LibreDWG bản WASM đã phải vá

Bản WASM (`@mlightcad/libredwg-web` 0.7.10) gói một phiên bản LibreDWG cũ, xuất DXF sai ở
hai chỗ. Cả hai đều làm bản vẽ hiển thị hỏng, đã vá trong `js/dxf-parser.js`:

1. **Ghi `62 = -7` cho mọi layer.** Trong DXF, group 62 mang dấu âm nghĩa là layer đang
   **tắt** — nên bản vẽ mở ra trắng trơn. Kiểm chứng bằng `dwglayers` thì trong file DWG
   mọi layer đều đang bật, và bản native `dwg2dxf` ghi đúng số dương. Cách vá: không bản vẽ
   thật nào tắt sạch toàn bộ layer, nên gặp trường hợp đó thì bỏ qua cờ tắt.
2. **Ghi điểm căn lề `11/21 = 0,0`** kể cả khi không dùng tới, làm mọi chữ có căn lề dồn hết
   về gốc toạ độ. Cách vá: chỉ tin điểm căn lề khi nó thực sự mang giá trị.

Ngoài ra đường DXF → DWG **làm mất group 72** (căn lề ngang). Vì bản phát hành cuối là DWG
nên `tools/gen-dxf.js` tự tính sẵn toạ độ căn giữa/căn phải rồi chỉ xuất chữ căn trái —
nhờ vậy không phụ thuộc vào group 72 nữa.

### CẢNH BÁO BẢN QUYỀN — đọc trước khi báo giá

**LibreDWG là GPL-3.0.** Nhúng nó vào một sản phẩm thương mại đóng mã nguồn sẽ kéo theo
nghĩa vụ GPL cho **toàn bộ sản phẩm** (phải công khai mã nguồn). Với một sản phẩm DRM bán
cho khách thì đây thường là điều không chấp nhận được.

Nó hoàn toàn ổn cho **demo nội bộ và thẩm định kỹ thuật** — mục đích của repo này. Khi làm
thật thì phải thay bằng một trong các lựa chọn sau:

| Giải pháp | Hình thức | Ghi chú |
|---|---|---|
| **ODA SDK** (Open Design Alliance) | license thương mại, ~1.200 USD/năm trở lên | chuẩn công nghiệp, có cả bản web/WASM |
| **Autodesk Platform Services** | đám mây, trả tiền theo lượt convert | file phải đẩy lên server Autodesk |
| **ODA File Converter** chạy ở server | binary miễn phí | **phải đọc kỹ điều khoản dùng thương mại** |

Lưu ý ghi DWG khó hơn đọc nhiều: `dxf2dwg` của LibreDWG chỉ ghi được tới r2004 và đã có
lỗi như mô tả ở trên. Hệ thống thật không cần ghi DWG — khách upload DWG của họ, hệ thống
chỉ **đọc**; khi cho tải về thì xuất PDF có watermark chứ không trả lại DWG.

---

## Đã làm được gì

### Xem — không sửa, không xoá
- **Mở file DWG từ máy** (nút trên thanh trên, hoặc kéo thả) — đọc tại chỗ, không upload
- Pan (kéo chuột), zoom (lăn chuột tại con trỏ), pinch trên cảm ứng, nút "Vừa khung" / phím `F`
- Bật/tắt từng layer; 4 **layout** dựng sẵn (A3 đầy đủ / Model / Kiến trúc không nội thất / Trục & kích thước)
- Thước tỷ lệ, lưới nền, hiển thị toạ độ theo con trỏ
- **Chỉ đọc thật sự:** sau khi parse, toàn bộ cây dữ liệu bị `Object.freeze` đệ quy.
  Không có hàm nào trong code có thể ghi/xoá entity. Chuỗi DWG base64 gốc bị `delete` khỏi
  `window` ngay sau khi giải mã, để không lấy lại được file gốc từ console.

### Watermark trên màn hình
Vẽ **thẳng vào canvas** trong vòng lặp render, không phải lớp `<div>` CSS phủ lên trên.
Hệ quả: không thể xoá bằng DevTools (xoá DOM không ảnh hưởng gì), và **luôn có mặt trong
mọi ảnh chụp màn hình**. Nội dung watermark lấy từ hồ sơ người đang đăng nhập (tên, số điện
thoại, thời điểm, mã phiên) — bật cố định, giao diện không có chỗ tắt hay chỉnh.

### Xuất PDF có watermark
- Kết xuất lại **dạng vector** (không phải ảnh raster) → nét sắc ở mọi mức zoom, file ~15 KB
- Khổ A4 / A3 / A2, chế độ đen trắng (in ấn) hoặc giữ màu layer
- Watermark lát chéo toàn trang: tên + số điện thoại + thời điểm + **mã tra vết**
- Chân trang: ai tải, lúc nào, mã bản vẽ, layout, mã tra vết
- Tên file chứa luôn mã tra vết: `KT-02-A0102_nguyenvanan_FBDD-42DA.pdf`
- **Cờ cấm in / cấm sao chép** ở cấp tài liệu PDF (owner password) — đặt cố định cho mọi
  bản xuất, không có tuỳ chọn tắt. Acrobat và hầu hết trình đọc sẽ khoá nút In và khoá copy text.

Watermark và cờ cấm in là **chính sách cố định**, không phải tuỳ chọn — hộp thoại xuất chỉ
còn khổ giấy, chế độ màu, và phạm vi layer.

### Chặn thao tác
| Hành vi | Cách chặn |
|---|---|
| F12, Ctrl+Shift+I/J/C/K, Ctrl+U | `keydown` capture, `preventDefault` |
| Ctrl+P (in) | chặn phím + `beforeprint` + `@media print` thay toàn trang bằng cảnh báo |
| Ctrl+S (lưu trang) | chặn phím |
| Chuột phải | chặn `contextmenu` (không cho "Lưu ảnh", "Kiểm tra phần tử") |
| Bôi đen / copy | `user-select: none` + chặn sự kiện `copy` |
| Kéo thả ảnh | chặn `dragstart` |
| **Print Screen** | phá clipboard (xem mục dưới) + nhoè màn hình 1 nhịp |
| DevTools đang mở | heuristic chênh lệch `outerWidth/innerWidth` → che nội dung |

Dòng in đậm là **phản ứng sau khi ảnh đã bị chụp**, không ngăn được việc chụp — xem mục
"Nói thẳng với khách hàng" bên dưới. Muốn chặn thật thì phải chạy bản Desktop.

#### Phá clipboard sau khi bị chụp

Không vô hiệu hoá được phím PrtSc, nhưng huỷ được tấm ảnh nó vừa tạo ra. Cơ chế trong
`js/drm.js`:

- **Ghi đè bằng ẢNH, không phải text.** Dán đè một tấm PNG cảnh báo có in sẵn mã bản vẽ,
  tên + email người xem, mã phiên và thời điểm. Người dùng dán vào Paint / Word sẽ nhận
  được tấm cảnh báo mang chính danh tính của họ thay vì bản vẽ.
- **Bắn nhiều nhịp** (0 / 60 / 180 / 400 / 900 ms). Windows đôi khi đẩy ảnh vào clipboard
  trễ hơn sự kiện phím vài chục mili-giây; ghi đè một lần là bỏ lọt.
- **Phá lại mỗi khi trang lấy lại focus.** Đây là cách duy nhất bắt được `Win+Shift+S` /
  Snipping Tool, vì ảnh chỉ vào clipboard lúc người dùng quét xong — khi đó trang mới lấy
  lại focus. Đánh đổi: clipboard của người dùng bị xoá mỗi lần quay lại tab. Muốn bỏ thì
  đặt `wipeOnFocus: false`.

Đã kiểm chứng bằng Chrome thật: đặt sẵn một ảnh 3 KB vào clipboard, bấm PrtSc, đọc lại
clipboard thì ảnh cũ đã bị thay bằng tấm cảnh báo 72 KB kèm dòng text định danh. Mô phỏng
Snipping Tool (mất focus rồi quay lại) cũng cho kết quả tương tự.

**Giới hạn:** `navigator.clipboard.write()` đòi trang phải đang được focus, và một số phiên
bản Chrome còn đòi có tương tác gần đây. Nếu bị từ chối thì code tự lùi về ghi text, rồi
lùi tiếp về `execCommand('copy')`. Trường hợp xấu nhất là ảnh chụp sống sót — nhưng nó vẫn
mang watermark định danh phủ kín.

Mỗi lần vi phạm đều được ghi vào **nhật ký ở sidebar** kèm mốc thời gian.
Trong hệ thống thật, chỗ này là `POST /api/audit`.

Tất cả các lớp trên **bật cố định**, không có công tắc tắt trong giao diện. Sidebar chỉ
liệt kê trạng thái để người xem biết tài liệu đang được bảo vệ bằng những gì.

---

## Nói thẳng với khách hàng về giới hạn

Đây là phần quan trọng nhất, đừng bỏ qua khi tư vấn.

**1. Mọi thứ trong `drm.js` chạy trên máy người xem, nên đều vượt được.**
Tắt JavaScript, chạy trình duyệt ở chế độ debug, dùng extension, hoặc đơn giản là
**chụp bằng điện thoại** — không có cách nào chặn. Đây là hàng rào *răn đe*, giống như
khoá cửa: ngăn người tử tế làm bậy vì tiện tay, không ngăn được người cố tình.

**2. Trên web, KHÔNG chặn được chụp màn hình. Điểm này cần nói rõ ràng.**

Windows chụp ảnh ở tầng hệ điều hành: khi bấm `Win+Shift+S` hay `PrintScreen`, OS đóng
băng framebuffer **ngay tại thời điểm bấm phím**, rồi mới gửi sự kiện phím xuống ứng dụng.
Trình duyệt nhận được `keydown` thì ảnh đã nằm trong bộ nhớ từ trước. JavaScript luôn chạy
**sau** khi ảnh đã bị chụp — không có Web API nào thay đổi được thứ tự này.

Những gì bản web làm được chỉ là *phản ứng sau*: ghi đè clipboard, nhoè màn hình một nhịp,
và **ghi vết**. Ảnh vẫn ra — nhưng ảnh đó mang đầy đủ watermark định danh, nên vẫn truy
được nguồn.

Muốn chặn thật thì phải dùng **bản Desktop** (xem mục dưới). OBS, ShareX, phần mềm họp
trực tuyến, máy ảo, card capture — bản web đều không biết. Camera điện thoại thì **cả hai
bản đều không chặn được**.

**3. Watermark trong DWG không có tác dụng.**
Như đã xác nhận: watermark đóng vào DWG chỉ là entity nằm trên một layer. Người nhận mở
bằng AutoCAD là tắt layer / xoá / `COPYCLIP` sang file mới — mất sạch trong 5 giây, không
cần kỹ năng gì. **Không có cơ chế nào bảo vệ được DWG**, vì bản chất nó là định dạng dữ
liệu mở cho phần mềm CAD chỉnh sửa.

→ Kết luận cho mục "cho tải file về": **chỉ cho tải PDF đã convert + đóng watermark**.
Nếu khách vẫn muốn tải DWG gốc thì phải chấp nhận là từ thời điểm đó file nằm ngoài
tầm kiểm soát — nên xử lý bằng hợp đồng/NDA chứ không phải bằng kỹ thuật.

**4. Cờ cấm in trong PDF là răn đe, không phải mã hoá.**
Chuẩn PDF quy định trình đọc *nên* tôn trọng cờ này; Acrobat, Foxit, Chrome đều tôn trọng.
Nhưng công cụ chuyên dụng gỡ được trong vài giây. Muốn chặn thật thì phải mã hoá nội dung
và ép người xem dùng trình đọc riêng (Adobe LiveCycle / FileOpen / Vitrium) — đắt, phiền,
và khách đã nói **không cần mã hoá file**.

---

## Bảng chốt phương án để đưa khách quyết định

| | Web (trình duyệt) | Desktop (Electron) |
|---|---|---|
| Cài đặt cho người xem | không cần, mở link là xem | phải cài app |
| Xem trên điện thoại / máy khách | được | không |
| Cập nhật phiên bản | tức thì | phải phát hành bản mới |
| Chặn F12 / chuột phải / Ctrl+P | có (tầng JS, vượt được) | có (**tầng native**, không vượt được) |
| **PrintScreen** | ❌ chụp được | ✅ **ảnh ra đen** |
| **Snipping Tool / Win+Shift+S** | ❌ chụp được | ✅ **ảnh ra đen** |
| **OBS / ShareX / quay màn hình** | ❌ quay được | ✅ **ảnh ra đen** |
| **Teams / Zoom / TeamViewer share** | ❌ thấy được | ✅ **ảnh ra đen** |
| Camera điện thoại | ❌ | ❌ **cả hai đều chịu** |
| Watermark định danh + truy vết | ✅ | ✅ |

Khách đã chốt **"web"** ngay từ đầu, nhưng lại yêu cầu **"chống chụp màn hình"**. Hai điều
này mâu thuẫn nhau về mặt kỹ thuật. Cần đưa lại bảng trên để khách chọn một trong hai:

- **Giữ web** → chấp nhận chụp được, đổi lại luôn truy được ai làm rò rỉ. Chi phí thấp,
  triển khai nhanh, người xem không phải cài gì.
- **Chuyển desktop** → chặn chụp thật, nhưng người xem phải cài app và chỉ dùng được trên
  máy tính. Nhà thầu / tư vấn ngoài công ty thường ngại cài.

Phương án hay dùng trong thực tế: **web cho xem thường, desktop cho bản vẽ mật**. Cùng một
bộ mã nguồn, chỉ khác lớp vỏ — đúng như repo này đang tổ chức.

---

## Giá trị thật của hệ thống nằm ở đâu

Ba điểm dưới đây mới là thứ nên bán, và cả ba đều đã có trong demo:

1. **File gốc không bao giờ rời server.** Client chỉ nhận hình học đã convert. Đây là lớp
   bảo vệ duy nhất không vượt được, vì nó không phụ thuộc vào máy người dùng.
2. **Watermark định danh + mã tra vết**, có trên cả màn hình lẫn PDF tải về. Bản rò rỉ
   xuất hiện ở đâu cũng truy ngược được về đúng tài khoản đã tải. Đây là thứ thực sự
   khiến người ta không dám phát tán.
3. **Nhật ký truy vết đầy đủ** — ai xem, xem lúc nào, tải mấy lần, có cố mở DevTools không.
   Có bằng chứng để xử lý khi có sự cố.

Nói cách khác: **không ngăn được rò rỉ, nhưng luôn biết rò rỉ từ đâu ra.** Với bản vẽ kỹ
thuật thì đó là mức bảo vệ hợp lý về chi phí.

---

## Nếu sau này cần chặn chụp màn hình thật

Repo này **chỉ còn bản web**. Vỏ Electron đã dựng trước đó bị gỡ bỏ theo quyết định đi
hướng web. Ghi lại đây để khỏi phải tìm lại nếu khách đổi ý.

Chặn chụp màn hình chỉ làm được ở **ứng dụng desktop**, bằng đúng một dòng:

```js
win.setContentProtection(true);   // Electron BrowserWindow
```

Electron gọi xuống API của hệ điều hành:

| HĐH | API | Yêu cầu |
|---|---|---|
| Windows | `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` | Win 10 build 2004+ |
| macOS | `NSWindow.sharingType = NSWindowSharingNone` | — |

Từ lúc đó cửa sổ biến mất khỏi mọi cơ chế chụp/quay của OS: PrintScreen, Snipping Tool,
`Win+Shift+S`, OBS, ShareX, Teams / Zoom share, TeamViewer — tất cả chỉ thu được vùng đen.
**Trang web không bao giờ gọi được API này.**

Bọc lại chỉ mất khoảng nửa tiếng: giữ nguyên toàn bộ mã web hiện tại, thêm `main.js` +
`preload.js`, bật `setContentProtection`, chặn phím ở tầng native bằng `before-input-event`,
tắt DevTools bằng `webPreferences: { devTools: false }`.

---

## Khoảng cách từ demo tới sản phẩm

| Hạng mục | Demo | Sản phẩm thật |
|---|---|---|
| Nguồn bản vẽ | nhúng sẵn 1 file | upload + convert DWG→DXF/SVG ở server |
| Người dùng | cứng trong `app.js` | SSO / phân quyền theo dự án, theo bản vẽ |
| Ghi log | mảng trong RAM | `POST /api/audit`, lưu DB, dashboard cảnh báo |
| Watermark | render ở client | render ở **server** (client không tắt được) |
| Xuất PDF | tạo ở trình duyệt | tạo ở server, đóng dấu số, cấp link hết hạn |
| Hiệu năng | ~250 entity | bản vẽ thật 50k–500k entity → cần WebGL hoặc tile ảnh |

Điểm cần lưu ý nhất khi báo giá: **watermark và kết xuất PDF phải chuyển về server**.
Làm ở client thì về nguyên tắc người dùng vẫn can thiệp được vào mã JS đang chạy; chuyển
lên server thì watermark nằm ngoài tầm với của họ hoàn toàn.

---

## Kiểm thử

```
node tools/test-parse.js   # đọc thẳng sample/MB-CH-A0102.dwg qua WASM
```

Bài kiểm tra đọc file DWG bằng đúng bộ LibreDWG mà web dùng, rồi xác nhận: 251/251 đối
tượng, 9/9 layer, không có số liệu hỏng, **không layer nào bị coi là tắt**, và **nhãn trục
không bị dồn về gốc toạ độ** — hai điều kiện sau chính là hai lỗi WASM đã vá ở trên.

Đã chạy smoke test bằng Playwright + Chrome thật, hai kịch bản:

1. **Bản vẽ DWG mặc định** — giải mã base64, đọc qua WASM, render canvas, bật/tắt layer,
   đổi layout, chặn F12 / Ctrl+P / chuột phải, xuất PDF rồi mở lại bằng pdf.js (1 trang A3,
   đúng cờ `/Encrypt`).
2. **Mở file DWG khác** — nạp `sample/sample_2018.dwg` (AutoCAD 2018) qua WASM: 6 đối
   tượng, 2 layer, 22 ms; layout tự chuyển sang "Toàn bộ bản vẽ"; watermark vẫn phủ lên bản
   vẽ mới; xuất được PDF có cờ cấm in; DRM vẫn chặn F12.

Không có lỗi JavaScript ở cả hai kịch bản.
