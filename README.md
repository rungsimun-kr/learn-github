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
| `src/components/` | The UI |

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
