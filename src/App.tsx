import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import DropZone from './components/DropZone';
import ExportImagesDialog, { type ImageExportSettings } from './components/ExportImagesDialog';
import PageGrid from './components/PageGrid';
import SplitDialog from './components/SplitDialog';
import Toolbar from './components/Toolbar';
import PageEditor from './components/PageEditor';
import {
  DEFAULT_STYLE,
  type Annotation,
  type AnnotationStyle,
  type Tool,
} from './lib/annotations';
import OcrDialog, { type OcrSettings } from './components/OcrDialog';
import TocDialog from './components/TocDialog';
import { emptyToc, seedFromFiles, type TocSettings } from './lib/toc';
import { loadFile, pagesForDoc, PdfLoadError } from './lib/docs';
import { extractText, type ExtractProgress, type PageText } from './lib/ocr';
import { buildMarkdown, textDownload } from './lib/textExport';
import { stripExtension, triggerDownload } from './lib/download';
import { exportImages, exportRanges, exportSinglePdf } from './lib/export';
import type { PageRange } from './lib/ranges';
import { releaseThumbnails } from './lib/render';
import type { LoadedDoc, PageItem } from './types';

const HISTORY_LIMIT = 50;

type Rotation = PageItem['rotation'];

function rotateBy(current: Rotation, delta: 90 | -90): Rotation {
  return (((current + delta) % 360) + 360) % 360 as Rotation;
}

function messageOf(error: unknown): string {
  if (error instanceof PdfLoadError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function App() {
  const [docs, setDocs] = useState<Map<string, LoadedDoc>>(() => new Map());
  const [pages, setPages] = useState<PageItem[]>([]);
  const [past, setPast] = useState<PageItem[][]>([]);
  const [future, setFuture] = useState<PageItem[][]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'split' | 'images' | 'ocr' | 'toc' | null>(null);

  // The contents list is part of the document's definition, not a one-off
  // export setting, so it lives here and survives closing the dialog.
  const [toc, setToc] = useState<TocSettings>(emptyToc);

  // Text extraction is long-running, so it gets its own progress state and an
  // abort handle rather than riding on the generic `busy` string.
  const [ocrProgress, setOcrProgress] = useState<ExtractProgress | null>(null);
  const [ocrSample, setOcrSample] = useState<{ pages: PageText[]; secondsPerPage: number } | null>(
    null,
  );
  const ocrAbortRef = useRef<AbortController | null>(null);
  const [fileDragDepth, setFileDragDepth] = useState(0);

  // Which page the annotation editor is open on, and the drawing settings it
  // remembers between visits.
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('rect');
  const [style, setStyle] = useState<AnnotationStyle>(DEFAULT_STYLE);

  // Mirrors of state for callbacks that must not close over a stale render.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const tocRef = useRef(toc);
  tocRef.current = toc;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const insertingRef = useRef(false);
  const anchorRef = useRef<number | null>(null);

  const selectedCount = useMemo(() => pages.filter((page) => page.selected).length, [pages]);
  const showSource = docs.size > 1;

  /** Where "Insert" drops new pages: right after the last selected page. */
  const insertIndex = useMemo(() => {
    let last = -1;
    pages.forEach((page, index) => {
      if (page.selected) last = index;
    });
    return last >= 0 ? last + 1 : pages.length;
  }, [pages]);

  const editingPage = editingPageId
    ? (pages.find((page) => page.id === editingPageId) ?? null)
    : null;
  const editingDoc = editingPage ? docs.get(editingPage.docId) : undefined;

  /** Name new downloads after the first file the pages came from. */
  const baseName = useMemo(() => {
    const first = pages[0] ? docs.get(pages[0].docId) : undefined;
    return stripExtension(first?.name ?? 'document') || 'document';
  }, [pages, docs]);

  /** Replace the page list and record the previous one for undo. */
  const commit = useCallback((next: PageItem[]) => {
    setPast((history) => [...history, pagesRef.current].slice(-HISTORY_LIMIT));
    setFuture([]);
    setPages(next);
  }, []);

  /** Change selection only — not worth an undo step of its own. */
  const setSelection = useCallback((next: PageItem[]) => setPages(next), []);

  const addFiles = useCallback(
    async (files: File[], at: number | null) => {
      const pdfs = files.filter((file) => file.size > 0);
      if (pdfs.length === 0) return;

      setBusy(pdfs.length === 1 ? 'Opening file…' : `Opening ${pdfs.length} files…`);
      setError(null);

      const loaded: LoadedDoc[] = [];
      const failures: string[] = [];
      for (const file of pdfs) {
        try {
          loaded.push(await loadFile(file));
        } catch (failure) {
          failures.push(messageOf(failure));
        }
      }

      if (loaded.length > 0) {
        setDocs((current) => {
          const next = new Map(current);
          for (const doc of loaded) next.set(doc.id, doc);
          return next;
        });

        const incoming = loaded.flatMap(pagesForDoc);
        const current = pagesRef.current;
        const position = at ?? current.length;
        commit([...current.slice(0, position), ...incoming, ...current.slice(position)]);
      }

      setError(failures.length > 0 ? failures.join(' ') : null);
      setBusy(null);
    },
    [commit],
  );

  const openFilePicker = useCallback((insert: boolean) => {
    insertingRef.current = insert;
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const at = insertingRef.current ? insertIndex : null;
      insertingRef.current = false;
      void addFiles(Array.from(files), at);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [addFiles, insertIndex],
  );

  const toggle = useCallback(
    (id: string, shiftKey: boolean) => {
      const current = pagesRef.current;
      const index = current.findIndex((page) => page.id === id);
      if (index < 0) return;

      const anchor = anchorRef.current;
      if (shiftKey && anchor !== null && anchor < current.length) {
        const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
        const value = !current[index].selected;
        setSelection(
          current.map((page, i) => (i >= from && i <= to ? { ...page, selected: value } : page)),
        );
      } else {
        setSelection(
          current.map((page, i) => (i === index ? { ...page, selected: !page.selected } : page)),
        );
      }
      anchorRef.current = index;
    },
    [setSelection],
  );

  const selectAll = useCallback(
    () => setSelection(pagesRef.current.map((page) => ({ ...page, selected: true }))),
    [setSelection],
  );

  const selectNone = useCallback(
    () => setSelection(pagesRef.current.map((page) => ({ ...page, selected: false }))),
    [setSelection],
  );

  const rotateSelected = useCallback(
    (delta: 90 | -90) => {
      const current = pagesRef.current;
      if (!current.some((page) => page.selected)) return;
      commit(
        current.map((page) =>
          page.selected ? { ...page, rotation: rotateBy(page.rotation, delta) } : page,
        ),
      );
    },
    [commit],
  );

  const rotateOne = useCallback(
    (id: string, delta: 90 | -90) => {
      commit(
        pagesRef.current.map((page) =>
          page.id === id ? { ...page, rotation: rotateBy(page.rotation, delta) } : page,
        ),
      );
    },
    [commit],
  );

  const deleteSelected = useCallback(() => {
    const current = pagesRef.current;
    if (!current.some((page) => page.selected)) return;
    commit(current.filter((page) => !page.selected));
    anchorRef.current = null;
  }, [commit]);

  const deleteOne = useCallback(
    (id: string) => {
      commit(pagesRef.current.filter((page) => page.id !== id));
      anchorRef.current = null;
    },
    [commit],
  );

  const nudge = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = pagesRef.current;
      const from = current.findIndex((page) => page.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      commit(next);
    },
    [commit],
  );

  const reorder = useCallback(
    (draggedId: string, targetId: string, side: 'before' | 'after') => {
      const current = pagesRef.current;
      const dragged = current.find((page) => page.id === draggedId);
      if (!dragged || draggedId === targetId) return;

      const without = current.filter((page) => page.id !== draggedId);
      const target = without.findIndex((page) => page.id === targetId);
      if (target < 0) return;

      const at = side === 'after' ? target + 1 : target;
      commit([...without.slice(0, at), dragged, ...without.slice(at)]);
    },
    [commit],
  );

  const setAnnotations = useCallback(
    (pageId: string, annotations: Annotation[]) => {
      commit(
        pagesRef.current.map((page) => (page.id === pageId ? { ...page, annotations } : page)),
      );
    },
    [commit],
  );

  /** Step the editor to the neighbouring page without closing it. */
  const navigateEditor = useCallback((delta: -1 | 1) => {
    setEditingPageId((current) => {
      const pages = pagesRef.current;
      const index = pages.findIndex((page) => page.id === current);
      const next = pages[index + delta];
      return next ? next.id : current;
    });
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    setFuture((forward) => [pagesRef.current, ...forward]);
    setPages(past[past.length - 1]);
    setPast(past.slice(0, -1));
  }, [past]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setPast((history) => [...history, pagesRef.current].slice(-HISTORY_LIMIT));
    setPages(future[0]);
    setFuture(future.slice(1));
  }, [future]);

  const clearAll = useCallback(() => {
    for (const doc of docsRef.current.keys()) releaseThumbnails(doc);
    setDocs(new Map());
    setPages([]);
    setPast([]);
    setFuture([]);
    setError(null);
    setEditingPageId(null);
    setToc(emptyToc());
    anchorRef.current = null;
  }, []);

  /** Run an export, surfacing progress and errors in the status bar. */
  const runExport = useCallback(
    async (label: string, job: (report: (done: number, total: number) => void) => Promise<void>) => {
      setBusy(label);
      setError(null);
      try {
        await job((done, total) => setBusy(total > 1 ? `${label} ${done}/${total}` : label));
      } catch (failure) {
        setError(messageOf(failure));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const downloadPdf = useCallback(() => {
    const current = pagesRef.current;
    const selecting = current.some((page) => page.selected);
    const target = selecting ? current.filter((page) => page.selected) : current;
    if (target.length === 0) return;

    // A contents page belongs to the whole document; a handful of extracted
    // pages does not want one.
    const contents = selecting ? undefined : tocRef.current;

    void runExport('Building PDF…', async () => {
      const download = await exportSinglePdf(target, docsRef.current, baseName, contents);
      triggerDownload(download.blob, download.filename);
    });
  }, [baseName, runExport]);

  const confirmSplit = useCallback(
    (ranges: PageRange[]) => {
      setDialog(null);
      void runExport('Splitting…', async (report) => {
        const download = await exportRanges(
          pagesRef.current,
          docsRef.current,
          ranges,
          baseName,
          report,
        );
        triggerDownload(download.blob, download.filename);
      });
    },
    [baseName, runExport],
  );

  /** Pages a text run should cover, honouring the dialog's scope choice. */
  const ocrScope = useCallback((selectionOnly: boolean) => {
    const current = pagesRef.current;
    return selectionOnly ? current.filter((page) => page.selected) : current;
  }, []);

  /** Read a few pages so the settings and the speed can be judged in a minute. */
  const sampleOcr = useCallback(
    (settings: OcrSettings) => {
      const target = ocrScope(settings.selectionOnly).slice(0, 3);
      if (target.length === 0) return;

      setOcrSample(null);
      const started = performance.now();
      void extractText(target, docsRef.current, {
        language: settings.language,
        scale: settings.scale,
        reOcrTextPages: settings.reOcrTextPages,
      })
        .then((pages) => {
          setOcrSample({
            pages,
            secondsPerPage: (performance.now() - started) / 1000 / Math.max(1, pages.length),
          });
        })
        .catch((failure: unknown) => setError(messageOf(failure)));
    },
    [ocrScope],
  );

  const startOcr = useCallback(
    (settings: OcrSettings) => {
      const target = ocrScope(settings.selectionOnly);
      if (target.length === 0) return;

      const controller = new AbortController();
      ocrAbortRef.current = controller;
      setError(null);
      setOcrProgress({ done: 0, total: target.length, needingOcr: 0, phase: 'scanning' });

      void extractText(target, docsRef.current, {
        language: settings.language,
        scale: settings.scale,
        reOcrTextPages: settings.reOcrTextPages,
        signal: controller.signal,
        onProgress: setOcrProgress,
      })
        .then((results) => {
          if (results.length === 0) return;
          const download = textDownload(baseName, buildMarkdown(baseName, results));
          triggerDownload(download.blob, download.filename);
          setDialog(null);
        })
        .catch((failure: unknown) => setError(messageOf(failure)))
        .finally(() => {
          ocrAbortRef.current = null;
          setOcrProgress(null);
        });
    },
    [baseName, ocrScope],
  );

  const cancelOcr = useCallback(() => ocrAbortRef.current?.abort(), []);

  const confirmImages = useCallback(
    (settings: ImageExportSettings) => {
      setDialog(null);
      const current = pagesRef.current;
      const target = settings.selectionOnly ? current.filter((page) => page.selected) : current;

      void runExport('Rendering…', async (report) => {
        const download = await exportImages(
          target,
          docsRef.current,
          { ...settings, baseName },
          report,
        );
        triggerDownload(download.blob, download.filename);
      });
    },
    [baseName, runExport],
  );

  // Keyboard shortcuts, ignored while typing in a field or a dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The page editor runs its own shortcuts while it is open.
      if (dialog || editingPageId) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, dialog')) return;

      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (pagesRef.current.some((page) => page.selected)) {
          event.preventDefault();
          deleteSelected();
        }
      } else if (event.key === 'Escape') {
        selectNone();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, editingPageId, undo, redo, selectAll, selectNone, deleteSelected]);

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    setFileDragDepth((depth) => depth + 1);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    setFileDragDepth((depth) => Math.max(0, depth - 1));
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setFileDragDepth(0);
    void addFiles(Array.from(event.dataTransfer.files), null);
  };

  return (
    <div
      className="app"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="app-header">
        <h1>PDF Editor</h1>
        <p>
          Merge, split, reorder, rotate and export PDF pages — and drop in images to add them as
          pages. Entirely in your browser, with no uploads.
        </p>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf,image/*"
        multiple
        hidden
        onChange={(event) => handleFileInput(event.target.files)}
      />

      <Toolbar
        totalPages={pages.length}
        selectedCount={selectedCount}
        insertPosition={insertIndex + 1}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        busy={busy !== null}
        onAdd={() => openFilePicker(false)}
        onInsert={() => openFilePicker(true)}
        onAnnotate={() => {
          const target = pages.find((page) => page.selected) ?? pages[0];
          if (target) setEditingPageId(target.id);
        }}
        onRotate={rotateSelected}
        onDelete={deleteSelected}
        onSelectAll={selectAll}
        onSelectNone={selectNone}
        onUndo={undo}
        onRedo={redo}
        onDownload={downloadPdf}
        onSplit={() => setDialog('split')}
        onExportImages={() => setDialog('images')}
        onExtractText={() => setDialog('ocr')}
        onContents={() => {
          // Arrive with a usable list rather than an empty one.
          if (toc.entries.length === 0 && pages.length > 0) {
            setToc({ ...toc, entries: seedFromFiles(pages, docs) });
          }
          setDialog('toc');
        }}
        onClear={clearAll}
      />

      {error ? (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}

      <main className="workspace">
        {pages.length === 0 ? (
          <DropZone onBrowse={() => openFilePicker(false)} />
        ) : (
          <PageGrid
            pages={pages}
            docs={docs}
            showSource={showSource}
            onToggle={toggle}
            onRotate={rotateOne}
            onDelete={deleteOne}
            onNudge={nudge}
            onOpen={setEditingPageId}
            onReorder={reorder}
          />
        )}
      </main>

      <footer className="status-bar" aria-live="polite">
        <span>
          {pages.length === 0
            ? 'No pages yet'
            : `${pages.length} page${pages.length === 1 ? '' : 's'}` +
              (selectedCount > 0 ? ` · ${selectedCount} selected` : '') +
              (docs.size > 1 ? ` · ${docs.size} files` : '')}
        </span>
        {busy ? <span className="busy">{busy}</span> : null}
      </footer>

      {fileDragDepth > 0 ? <div className="drop-overlay">Drop PDFs to add them</div> : null}

      {editingPage && editingDoc ? (
        <PageEditor
          key={editingPage.id}
          page={editingPage}
          doc={editingDoc}
          position={pages.indexOf(editingPage) + 1}
          total={pages.length}
          tool={tool}
          style={style}
          onTool={setTool}
          onStyle={(patch) => setStyle((current) => ({ ...current, ...patch }))}
          onChange={(annotations) => setAnnotations(editingPage.id, annotations)}
          onNavigate={navigateEditor}
          onClose={() => setEditingPageId(null)}
        />
      ) : null}

      {dialog === 'split' ? (
        <SplitDialog
          pageCount={pages.length}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onConfirm={confirmSplit}
        />
      ) : null}

      {dialog === 'toc' ? (
        <TocDialog
          pages={pages}
          docs={docs}
          toc={toc}
          onChange={setToc}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'ocr' ? (
        <OcrDialog
          totalPages={pages.length}
          selectedPages={selectedCount}
          running={ocrProgress !== null}
          progress={ocrProgress}
          sample={ocrSample}
          onClose={() => {
            setDialog(null);
            setOcrSample(null);
          }}
          onSample={sampleOcr}
          onStart={startOcr}
          onCancel={cancelOcr}
        />
      ) : null}

      {dialog === 'images' ? (
        <ExportImagesDialog
          totalPages={pages.length}
          selectedPages={selectedCount}
          busy={busy !== null}
          progress={busy}
          onClose={() => setDialog(null)}
          onConfirm={confirmImages}
        />
      ) : null}
    </div>
  );
}
