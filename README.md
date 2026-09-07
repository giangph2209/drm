# DRM Drawing Portal — Demo for controlled drawing distribution

A static website (plain HTML + JS, **no framework, no build, no backend**).
It must be served over an HTTP server of any kind because it uses WebAssembly.

```
index.html
css/style.css
js/dxf-parser.js     hand-written DXF reader (LINE, ARC, CIRCLE, TEXT, MTEXT, SOLID,
                     LWPOLYLINE, POLYLINE, ELLIPSE, INSERT + BLOCK expansion)
js/viewer.js         2D canvas render: pan/zoom, layer, linetype, watermark, scale bar
js/export-pdf.js     VECTOR PDF export + watermark + no-print flag
js/drm.js            blocking layer for F12 / print / PrintScreen / right-click / DevTools
js/app.js            wires everything together
js/dwg-loader.js     reads binary DWG files via LibreDWG compiled to WebAssembly
js/vendor/jspdf.umd.min.js   jsPDF 2.5.1 (bundled — runs offline)
js/vendor/libredwg/  GNU LibreDWG WASM build (~10 MB) — GPL-3.0, see the warning below
data/drawing.js      the default DWG drawing, embedded as base64 — NO network calls
sample/MB-CH-A0102.dwg       that same drawing, openable in AutoCAD/BricsCAD
sample/sample_2018.dwg       a real AutoCAD 2018 DWG, to test a newer format
tools/gen-dxf.js     generates the drawing geometry into an intermediate DXF
tools/make-dwg.js    intermediate DXF -> DWG + embeds it into data/drawing.js
tools/test-parse.js  test: reads the DWG file directly, then verifies the data
tools/key-probe.html probe page: what keyboard events does the browser actually receive?
```

## Running

```
npx serve .        # or: python -m http.server 8080
```

**Must be served over HTTP.** Opening `index.html` via `file://` will not work: the default
drawing is a DWG too, so it needs WebAssembly, and browsers block WASM and ES modules over the
`file://` protocol.

---

## DWG-only

**The system works only with binary DWG files.** No DXF path is ever exposed in the UI.

- The default drawing is `sample/MB-CH-A0102.dwg` (AutoCAD 2000), embedded as base64 in
  `data/drawing.js` — no network calls, no uploads.
- Click **"Open DWG drawing"** or drag and drop to open a different `.dwg` file. It is read
  locally with `FileReader`, **and never sent anywhere**.

Mechanism: GNU LibreDWG compiled to WebAssembly (`@mlightcad/libredwg-web`, bundled into
`js/vendor/libredwg/`).

```
.dwg file  ──►  WASM LibreDWG  ──►  DXF in memory  ──►  parse  ──►  canvas
 (binary)       ~10 MB, loaded once   (intermediate, never exposed)
```

DXF still exists in the source, but only as an **in-memory intermediate format** — LibreDWG
emits DXF and `js/dxf-parser.js` reads that DXF. The user never sees or touches it.

Verified against real DWG files:

| File | Version | Result |
|---|---|---|
| `sample/MB-CH-A0102.dwg` | AutoCAD 2000 (AC1015) | 251 entities, 9 layers |
| `sample/sample_2018.dwg` | AutoCAD 2018 (AC1032) | 6 entities, 2 layers, 22 ms |

> **Must be served over HTTP** (`npx serve .`). Opened via `file://`, the browser blocks
> WebAssembly and ES modules, and the app reports an error with instructions.

### Regenerating the sample DWG file

```
node tools/gen-dxf.js     # geometry -> sample/_build.dxf (intermediate DXF R12)
node tools/make-dwg.js    # -> sample/MB-CH-A0102.dwg + data/drawing.js
```

`make-dwg.js` needs the GNU LibreDWG binaries — download the Windows build from
[github.com/LibreDWG/libredwg/releases](https://github.com/LibreDWG/libredwg/releases) and
point `LIBREDWG_BIN` at the directory containing `dxfwrite.exe` / `dxf2dwg.exe`. You only need
to run it again when you edit the sample drawing; the generated DWG file is already in the repo.

**Two steps are required.** Converting intermediate DXF R12 straight to DWG with `dxf2dwg`
produces a **corrupt file**: reading it back reports `bit_read_TV buffer overflow`, all entities
are lost, and only the layer table remains. The cause is that minimal DXF R12 lacks the
`BLOCK_RECORD`, the `OBJECTS` section, and the handles the DWG writer needs. Letting `dxfwrite`
normalize it up to a full DXF R2000 first, then running `dxf2dwg`, produces a valid file that
keeps all 251 entities and 9 layers.

### Two bugs in the WASM build of LibreDWG that had to be patched

The WASM build (`@mlightcad/libredwg-web` 0.7.10) bundles an old version of LibreDWG that emits
DXF incorrectly in two places. Both make the drawing render broken; both are patched in
`js/dxf-parser.js`:

1. **Writes `62 = -7` for every layer.** In DXF, a negative group 62 means the layer is
   **off** — so the drawing opens blank. Verified with `dwglayers`: in the DWG file every layer
   is actually on, and the native `dwg2dxf` writes the correct positive number. The fix: no real
   drawing turns off every single layer, so when that happens, the off flag is ignored.
2. **Writes the alignment point `11/21 = 0,0`** even when it is unused, making every aligned text
   pile up at the origin. The fix: only trust the alignment point when it actually carries a value.

Beyond that, the DXF → DWG path **loses group 72** (horizontal alignment). Since the final
deliverable is DWG, `tools/gen-dxf.js` pre-computes the center/right-aligned coordinates itself
and only emits left-aligned text — so it no longer depends on group 72.

### LICENSING WARNING — read before quoting a price

**LibreDWG is GPL-3.0.** Embedding it in a closed-source commercial product drags GPL
obligations onto **the entire product** (you must publish the source). For a DRM product sold to
customers, that is usually unacceptable.

It is perfectly fine for **internal demos and technical due diligence** — the purpose of this
repo. For a real product it must be replaced with one of the following options:

| Solution | Form | Notes |
|---|---|---|
| **ODA SDK** (Open Design Alliance) | commercial license, ~1,200 USD/year and up | industry standard, includes web/WASM builds |
| **Autodesk Platform Services** | cloud, pay per conversion | files must be pushed to Autodesk servers |
| **ODA File Converter** running on a server | free binary | **read the commercial-use terms carefully** |

Note that writing DWG is much harder than reading it: LibreDWG's `dxf2dwg` only writes up to
r2004 and has the bugs described above. A real system does not need to write DWG — customers
upload their own DWG, the system only **reads** it; when downloads are allowed it exports a
watermarked PDF rather than handing back a DWG.

---

## What it does

### View — no editing, no deleting
- **Open a DWG file from disk** (button on the top bar, or drag and drop) — read locally, no upload
- Pan (drag), zoom (wheel at the cursor), pinch on touch, "Fit to frame" button / the `F` key
- Toggle individual layers; 4 preset **layouts** (full A3 / Model / Architecture without interior / Axes & dimensions)
- Scale bar, background grid, cursor coordinate readout
- **Truly read-only:** after parsing, the entire data tree is recursively `Object.freeze`d.
  No function in the code can write or delete an entity. The original base64 DWG string is
  `delete`d from `window` right after it is decoded, so the original file cannot be recovered
  from the console.

### On-screen watermark
Drawn **directly onto the canvas** inside the render loop, not a CSS `<div>` overlay on top.
The consequence: it cannot be removed via DevTools (deleting the DOM has no effect), and it is
**always present in every screenshot**. The watermark content comes from the logged-in user's
profile (name, phone number, timestamp, session code) — permanently on, with no UI to turn it
off or adjust it.

### Watermarked PDF export
- Re-rendered **as vector** (not a raster image) → crisp at any zoom level, ~15 KB file
- A4 / A3 / A2 sizes, black-and-white mode (for printing) or keep the layer colors
- Diagonal tiled watermark across the whole page: name + phone number + timestamp + **trace code**
- Footer: who downloaded it, when, drawing code, layout, trace code
- The filename includes the trace code: `KT-02-A0102_johnsmith_FBDD-42DA.pdf`
- **No-print / no-copy flags** at the PDF document level (owner password) — fixed for every
  export, with no option to turn them off. Acrobat and most readers will disable the Print
  button and lock text copying.

The watermark and no-print flags are **fixed policy**, not options — the export dialog only offers
paper size, color mode, and layer scope.

### Blocking interactions
| Behavior | How it is blocked |
|---|---|
| F12, Ctrl+Shift+I/J/C/K, Ctrl+U | `keydown` capture, `preventDefault` |
| Ctrl+P (print) | key block + `beforeprint` + `@media print` replaces the whole page with a warning |
| Ctrl+S (save page) | key block |
| Right-click | blocks `contextmenu` (no "Save image", "Inspect element") |
| Select / copy | `user-select: none` + blocks the `copy` event |
| Image drag | blocks `dragstart` |
| **Print Screen** | destroys the clipboard (see below) + a one-frame screen blur |
| DevTools open | `outerWidth/innerWidth` gap heuristic → hides the content |

The bold rows are **reactions after the image has already been captured**, they cannot prevent the
capture — see "Being straight with the customer" below. To block it for real you need the Desktop build.

#### Destroying the clipboard after a capture

You cannot disable the PrtSc key, but you can destroy the image it just created. The mechanism in
`js/drm.js`:

- **Overwrite with an IMAGE, not text.** Paste over it a warning PNG pre-printed with the drawing
  code, the viewer's name + email, session code, and timestamp. A user who pastes into Paint / Word
  gets the warning image bearing their own identity instead of the drawing.
- **Fire several times** (0 / 60 / 180 / 400 / 900 ms). Windows sometimes pushes the image into the
  clipboard a few tens of milliseconds after the key event; overwriting once would miss it.
- **Destroy it again every time the page regains focus.** This is the only way to catch
  `Win+Shift+S` / Snipping Tool, because the image only enters the clipboard when the user finishes
  selecting — at which point the page regains focus. The trade-off: the user's clipboard is wiped
  every time they return to the tab. To disable it, set `wipeOnFocus: false`.

Verified in real Chrome: place a 3 KB image on the clipboard, press PrtSc, read the clipboard back,
and the old image has been replaced with a 72 KB warning image plus an identifying text line.
Simulating the Snipping Tool (losing focus then returning) gives the same result.

**Limitation:** `navigator.clipboard.write()` requires the page to be focused, and some Chrome
versions also require recent interaction. If it is denied, the code falls back to writing text, then
falls back further to `execCommand('copy')`. The worst case is that the screenshot survives — but it
still carries the identifying watermark covering it entirely.

Every violation is written to the **log in the sidebar** with a timestamp.
In a real system, this is where `POST /api/audit` would go.

All of the layers above are **permanently on**, with no off switch in the UI. The sidebar only lists
the status so the viewer knows what is protecting the document.

---

## Being straight with the customer about the limits

This is the most important part — do not skip it when advising.

**1. Everything in `drm.js` runs on the viewer's machine, so all of it can be bypassed.**
Turn off JavaScript, run the browser in debug mode, use an extension, or simply **take a photo with a
phone** — there is no way to block it. This is a *deterrent* fence, like a door lock: it stops honest
people from misbehaving out of convenience, not someone who is determined.

**2. On the web, screen capture CANNOT be blocked. This point must be stated clearly.**

Windows captures the image at the operating-system layer: when you press `Win+Shift+S` or
`PrintScreen`, the OS freezes the framebuffer **at the very moment the key is pressed**, and only then
sends the key event down to the application. By the time the browser receives `keydown`, the image is
already in memory. JavaScript always runs **after** the image has been captured — no Web API can change
this ordering.

What the web build can do is only *react afterward*: overwrite the clipboard, blur the screen for one
frame, and **leave a trace**. The image still comes out — but that image carries the full identifying
watermark, so it can still be traced back.

To block it for real you need the **Desktop build** (see below). OBS, ShareX, online-meeting software,
virtual machines, capture cards — the web build knows about none of them. A phone camera **neither build
can block**.

**3. Watermarking inside the DWG is useless.**
As confirmed: a watermark baked into a DWG is just an entity on a layer. The recipient opens it in
AutoCAD and turns off the layer / deletes it / `COPYCLIP`s to a new file — gone in 5 seconds, no skill
required. **Nothing can protect a DWG**, because it is fundamentally an open data format meant to be
edited by CAD software.

→ Conclusion for the "allow file download" feature: **only allow downloading the converted + watermarked
PDF**. If the customer still wants to download the original DWG, they must accept that from that moment the
file is beyond their control — so handle it with a contract/NDA, not with technology.

**4. The PDF no-print flag is a deterrent, not encryption.**
The PDF standard says readers *should* respect this flag; Acrobat, Foxit, and Chrome all do. But a
dedicated tool removes it in seconds. To block it for real you must encrypt the content and force viewers
to use a proprietary reader (Adobe LiveCycle / FileOpen / Vitrium) — expensive, cumbersome, and the
customer already said they **do not need file encryption**.

---

## Decision table to put in front of the customer

| | Web (browser) | Desktop (Electron) |
|---|---|---|
| Install for the viewer | none, open a link and view | must install an app |
| View on phone / client's machine | yes | no |
| Version updates | instant | must ship a new build |
| Block F12 / right-click / Ctrl+P | yes (JS layer, bypassable) | yes (**native layer**, not bypassable) |
| **PrintScreen** | ❌ captures | ✅ **image comes out black** |
| **Snipping Tool / Win+Shift+S** | ❌ captures | ✅ **image comes out black** |
| **OBS / ShareX / screen recording** | ❌ records | ✅ **image comes out black** |
| **Teams / Zoom / TeamViewer share** | ❌ visible | ✅ **image comes out black** |
| Phone camera | ❌ | ❌ **both are helpless** |
| Identifying watermark + tracing | ✅ | ✅ |

The customer settled on **"web"** from the start, but also asked for **"screenshot protection"**. These
two are technically contradictory. Put the table above back in front of them and have them choose one of
the two:

- **Keep web** → accept that captures are possible, in exchange for always being able to trace who leaked
  it. Low cost, fast to deploy, viewers install nothing.
- **Switch to desktop** → real capture blocking, but viewers must install an app and can only use it on a
  computer. Contractors / outside consultants are often reluctant to install.

The approach commonly used in practice: **web for ordinary viewing, desktop for confidential drawings.**
Same source code, only a different shell — exactly how this repo is organized.

---

## Where the real value of the system lies

The three points below are what should actually be sold, and all three are already in the demo:

1. **The original file never leaves the server.** The client only receives converted geometry. This is
   the one protection layer that cannot be bypassed, because it does not depend on the user's machine.
2. **Identifying watermark + trace code**, present both on screen and in the downloaded PDF. Wherever a
   leaked copy shows up, it traces back to the exact account that downloaded it. This is what really makes
   people afraid to distribute it.
3. **A full audit log** — who viewed it, when, how many times they downloaded, whether they tried to open
   DevTools. There is evidence to act on when an incident occurs.

In other words: **you cannot prevent leaks, but you always know where the leak came from.** For
engineering drawings, that is a reasonable level of protection for the cost.

---

## If real screenshot blocking is needed later

This repo is now **web-only**. The Electron shell that was built earlier was removed following the
decision to go web. Recorded here so it need not be rediscovered if the customer changes their mind.

Blocking screen capture is only possible in a **desktop application**, with exactly one line:

```js
win.setContentProtection(true);   // Electron BrowserWindow
```

Electron calls down into the operating-system API:

| OS | API | Requires |
|---|---|---|
| Windows | `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` | Win 10 build 2004+ |
| macOS | `NSWindow.sharingType = NSWindowSharingNone` | — |

From then on the window disappears from every OS capture/recording mechanism: PrintScreen, Snipping Tool,
`Win+Shift+S`, OBS, ShareX, Teams / Zoom share, TeamViewer — all of them capture only a black region.
**A web page can never call this API.**

Wrapping it takes about half an hour: keep all the current web code, add `main.js` + `preload.js`, enable
`setContentProtection`, block keys at the native layer with `before-input-event`, and disable DevTools with
`webPreferences: { devTools: false }`.

---

## The gap from demo to product

| Item | Demo | Real product |
|---|---|---|
| Drawing source | 1 embedded file | upload + convert DWG→DXF/SVG on the server |
| Users | hard-coded in `app.js` | SSO / permissions per project, per drawing |
| Logging | array in RAM | `POST /api/audit`, stored in a DB, alert dashboard |
| Watermark | rendered on the client | rendered on the **server** (the client cannot turn it off) |
| PDF export | generated in the browser | generated on the server, digitally stamped, expiring links |
| Performance | ~250 entities | real drawings of 50k–500k entities → need WebGL or image tiling |

The most important point when quoting: **the watermark and PDF rendering must move to the server**. Done on
the client, the user can in principle still tamper with the running JS; moved to the server, the watermark is
completely out of their reach.

---

## Testing

```
node tools/test-parse.js   # reads sample/MB-CH-A0102.dwg directly via WASM
```

The test reads the DWG file with the exact LibreDWG build the web app uses, then confirms: 251/251
entities, 9/9 layers, no corrupt data, **no layer treated as off**, and **axis labels not piled at the
origin** — the last two conditions are exactly the two WASM bugs patched above.

A smoke test was run with Playwright + real Chrome, in two scenarios:

1. **The default DWG drawing** — decode base64, read via WASM, render the canvas, toggle layers, switch
   layouts, block F12 / Ctrl+P / right-click, export a PDF and reopen it with pdf.js (1 A3 page, correct
   `/Encrypt` flag).
2. **Open a different DWG file** — load `sample/sample_2018.dwg` (AutoCAD 2018) via WASM: 6 entities,
   2 layers, 22 ms; the layout switches automatically to "Entire drawing"; the watermark still covers the
   new drawing; a PDF with the no-print flag exports successfully; DRM still blocks F12.

No JavaScript errors in either scenario.
