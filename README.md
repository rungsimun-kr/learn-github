# PDF Editor

A browser app for cutting up and joining PDF files. Drop in one file to split it, or several to
merge them; every page lands in a single list you can reorder, rotate, delete, and export.

Nothing is uploaded — the files are opened, edited, and written back inside the browser tab, so a
document never leaves the machine it is on.

## What it does

- **Merge** — add several PDFs and their pages join one continuous list.
- **Insert** — drop another PDF's pages in at a chosen position, not just at the end.
- **Split and extract** — by page ranges (`1-5, 8, 10-12`), in fixed-size chunks, or one file per
  page. A single range downloads as a PDF; several come back as a `.zip`.
- **Rearrange** — drag pages around, or move them with the ◀ ▶ buttons.
- **Rotate and delete** — one page at a time or across a whole selection.
- **Draw on a page** — click any page to open it full size and mark it up (see below).
- **Extract the text** — including OCR for scanned books, in Thai and English (see below).
- **Export as images** — PNG or JPEG at up to 288 dpi, one image or a `.zip` of them.
- **Undo/redo** — every edit is reversible (`Ctrl`/`Cmd` + `Z`).

Shift-click a page to select a run of them. `Ctrl`/`Cmd` + `A` selects everything, `Delete` removes
the selection, `Esc` clears it.

## Marking up a page

Click a page thumbnail (or press **Annotate**) to open it full size. The tools are:

| Tool | What it does |
| --- | --- |
| Select | Click a mark to select it, drag to move, drag a corner or endpoint to reshape |
| Text | Click to drop a text box and type — Thai and Latin both work |
| Rectangle, Ellipse | Filled or outlined, in any palette colour |
| Line, Arrow | Arrowhead at one end or both |
| Freehand | Draw with the pointer |

A **filled shape below 100% opacity highlights** — it multiplies with the page, so text underneath
stays readable. Push opacity to 100% and it covers instead, which is how you black out or white out
a region. `Delete` removes the selected mark, `Esc` deselects and then closes the editor, and the
arrow keys step between pages.

Marks are **flattened into the page** on export: they become part of the page's content and render
identically in every reader, but they cannot be clicked or removed again afterwards. Until you
export, they stay editable and are covered by undo like any other change.

## Reading a scanned book

**Extract text** turns a document into one Markdown file. It works in two passes, and the first one
matters most:

1. **Pages that already contain text are read directly.** Most PDFs that look like books are digital,
   not scanned. A 500-page digital book extracts in about **5 seconds** and never starts the OCR
   engine at all.
2. **Only what is left goes through OCR** — Tesseract, in a pool of web workers, one page at a time.

Measured on a 150-page scanned fixture (44 MB, so roughly 150 MB at 500 pages) in this project's
test browser:

| | |
| --- | --- |
| Scanned pages | **0.93 s/page** → a 500-page book in **about 8 minutes** |
| Digital pages | ~0.01 s/page → 500 pages in **under 5 seconds** |
| Memory during the run | flat at 56–65 MB across 150 pages |
| Thai recognition confidence | 95% on a clean scan |

Your book will differ — denser type, noise and skew all cost time and accuracy — so the dialog has a
**Try 3 pages** button that measures *your* document and projects the real figure before you commit
to the full run. **Stop and keep what is done** ends a run early and still gives you every page read
so far.

Notes worth knowing:

- The tab has to stay open; the work happens in it.
- Thai OCR on an old or low-contrast scan makes mistakes. Expect to proofread. The output marks which
  pages were recognised rather than read exactly, and reports the engine's own confidence.
- If a PDF has a text layer that is itself bad OCR, tick **Re-read pages that already have text**.
- The engine and its language data are served from this app (~15 MB in `public/tesseract/`), not a
  CDN, so nothing about a document implies a third-party request while you read it.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck and bundle into `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) |
| `npm run typecheck` | Typecheck without bundling |

`npm run test:e2e` needs a Chromium, normally fetched once with `npx playwright install`. If your
environment already ships one, point at it instead:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Deploying

Pushing to `main` builds the app and publishes it to GitHub Pages via
`.github/workflows/deploy.yml`. It only does anything once Pages is switched on for the repository:
**Settings → Pages → Source → GitHub Actions**. The bundle uses relative asset paths, so it works
both at a domain root and under a project path like `/learn-github/`.

## How it is put together

The whole app is one ordered list of page items:

```ts
{ id, docId, pageIndex, rotation, annotations, selected }
```

Each item points at a page inside a loaded file. Merging appends to the list, inserting splices into
it, reordering moves entries, and exporting reads a subset — so every feature is the same small data
structure viewed from a different angle. `src/lib/build.ts` turns any such list back into a PDF.

Annotations living *on the item* is what makes them follow a page when it is reordered, get copied
when a page is extracted twice, and fall under undo without any history code of their own.

| Path | Role |
| --- | --- |
| `src/lib/docs.ts` | Opens a file into both PDF libraries |
| `src/lib/build.ts` | Assembles a page list into a new PDF |
| `src/lib/ranges.ts` | Parses `1-5, 8, 10-12` into page indices |
| `src/lib/render.ts` | Renders previews and images, with caching |
| `src/lib/export.ts` | Turns the working document into downloads |
| `src/lib/geometry.ts` | View↔PDF coordinate transforms |
| `src/lib/drawAnnotations.ts` | Flattens marks into a page |
| `src/lib/textLayer.ts` | Reads text a PDF already has, and decides if OCR is needed |
| `src/lib/ocr.ts` | The two-pass extraction run: worker pool, progress, cancellation |
| `src/components/` | The UI |

### Two things keep a 500-page book usable

- **Thumbnails render only near the viewport** (`Thumbnail.tsx`, via `IntersectionObserver`).
  Rendering every card on load meant 500 queued jobs and an unusable grid; now 30 render and the
  first appears in half a second.
- **`LoadedDoc` keeps no copy of the raw bytes.** Each PDF library parses its own; a third copy was
  being retained and never read, which on a 150 MB scan is 150 MB of nothing.

### Annotation coordinates

Marks are stored in **PDF user space on the unrotated page** — the space pdf-lib draws in — so export
needs no conversion and all the transform work sits in `geometry.ts`. Two things there are easy to
get wrong and are covered by tests:

- A box has to be converted **corner by corner** and renormalised. A quarter turn swaps the axes, so
  width and height cannot be carried across field by field.
- **Text needs an explicit counter-rotation** (`rotate: degrees(pageRotation)`). Every other shape is
  orientation-free; text drawn into a turned page would come out sideways.

Image export builds the PDF first and renders *that*, rather than the original file, so annotations
and rotation are handled by exactly the code that produces the downloaded document.

Three details are worth knowing before changing anything:

- **`pdf-lib` writes, `pdf.js` renders**, and each gets its own copy of the file's bytes. pdf.js
  transfers the buffer it is handed to its worker thread and leaves the original detached, which
  would corrupt any other reader of the same array.
- **The pdf.js worker is our own module** (`src/lib/pdfWorker.ts`) rather than the file pdf.js ships.
  That keeps the worker bundled locally instead of fetched from a CDN, and it lets a small polyfill
  (`src/lib/mapPolyfill.ts`) run inside the worker. pdf.js 6 calls
  `Map.prototype.getOrInsertComputed`, which browsers only started shipping very recently; without
  the polyfill every render fails on anything older.

- **Text needs a real embedded font.** The standard PDF fonts are WinAnsi only and *throw* on Thai,
  so `src/lib/font.ts` embeds Sarabun (SIL Open Font License, vendored in `src/assets/fonts/`),
  subsetted to the glyphs used. Both the font and fontkit load on demand, so a session that never
  types anything never downloads either.

Password-protected PDFs are rejected with a message rather than opened — removing encryption is out
of scope.
