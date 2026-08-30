import { createWorker, type Worker } from 'tesseract.js';
import { OCR_ASSETS } from './ocrAssets';
import { renderPage } from './render';
import { extractTextLayer, hasUsableText, tidy } from './textLayer';
import type { LoadedDoc, PageItem } from '../types';

/** Where a page's text came from. Reported so exact text is distinguishable. */
export type TextSource = 'pdf' | 'ocr';

export interface PageText {
  /** 1-based position in the requested run, matching the grid. */
  label: number;
  text: string;
  source: TextSource;
  /** OCR's own confidence, 0-100. Absent for text taken from the PDF. */
  confidence?: number;
  ms: number;
}

export interface ExtractOptions {
  language: string;
  /** Render scale; 72 dpi is 1, so 300 dpi is ~4.17. */
  scale: number;
  /** OCR even pages that already carry text — for a bad existing text layer. */
  reOcrTextPages?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ExtractProgress) => void;
}

export interface ExtractProgress {
  done: number;
  total: number;
  /** Pages found to need OCR; known only after the text-layer pass. */
  needingOcr: number;
  phase: 'scanning' | 'starting-engine' | 'reading' | 'done';
  page?: PageText;
}

/** Tesseract is slow to start, so cap the pool and leave the UI a core. */
function poolSize(needed: number): number {
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(4, cores - 1, needed));
}

class Aborted extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Aborted';
  }
}

/**
 * Read the text of a run of pages.
 *
 * Two passes: every page is checked for text it already has, then only what is
 * left goes through OCR in a pool of workers. Cancelling returns the pages
 * finished so far rather than throwing them away — on a job measured in tens of
 * minutes, losing the work to a mis-click would be unforgivable.
 */
export async function extractText(
  pages: readonly PageItem[],
  docs: ReadonlyMap<string, LoadedDoc>,
  options: ExtractOptions,
): Promise<PageText[]> {
  const results: Array<PageText | undefined> = new Array(pages.length);
  const total = pages.length;
  let done = 0;

  const report = (phase: ExtractProgress['phase'], needingOcr: number, page?: PageText) =>
    options.onProgress?.({ done, total, needingOcr, phase, page });

  const check = () => {
    if (options.signal?.aborted) throw new Aborted();
  };

  const finished = () =>
    results.filter((entry): entry is PageText => entry !== undefined);

  try {
    // Pass one: take what the document already has.
    const needOcr: number[] = [];
    report('scanning', 0);

    for (const [position, page] of pages.entries()) {
      check();
      const doc = docs.get(page.docId);
      if (!doc) continue;

      if (!options.reOcrTextPages) {
        const started = performance.now();
        const text = await extractTextLayer(doc.jsDoc, page.pageIndex);
        if (hasUsableText(text)) {
          const entry: PageText = {
            label: position + 1,
            text,
            source: 'pdf',
            ms: Math.round(performance.now() - started),
          };
          results[position] = entry;
          done += 1;
          report('scanning', needOcr.length, entry);
          continue;
        }
      }
      needOcr.push(position);
    }

    if (needOcr.length === 0) {
      report('done', 0);
      return finished();
    }

    // Pass two: OCR whatever is left.
    report('starting-engine', needOcr.length);
    const workers = await startPool(poolSize(needOcr.length), options.language);
    check();

    try {
      let next = 0;
      report('reading', needOcr.length);

      await Promise.all(
        workers.map(async (worker) => {
          while (next < needOcr.length) {
            if (options.signal?.aborted) return;
            const position = needOcr[next++];
            const page = pages[position];
            const doc = docs.get(page.docId);
            if (!doc) continue;

            const started = performance.now();
            const canvas = await renderPage(doc.jsDoc, page.pageIndex, {
              scale: options.scale,
              rotation: page.rotation,
              background: '#ffffff',
            });

            let text = '';
            let confidence: number | undefined;
            try {
              const { data } = await worker.recognize(canvas);
              text = tidy(data.text);
              confidence = data.confidence;
            } finally {
              // Drop the backing store now; at 300 dpi each of these is ~35 MB
              // and several are alive at once.
              canvas.width = 0;
              canvas.height = 0;
            }

            const entry: PageText = {
              label: position + 1,
              text,
              source: 'ocr',
              confidence,
              ms: Math.round(performance.now() - started),
            };
            results[position] = entry;
            done += 1;
            report('reading', needOcr.length, entry);
          }
        }),
      );
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate().catch(() => {})));
    }

    check();
    report('done', needOcr.length);
    return finished();
  } catch (error) {
    // A cancellation still hands back everything already read.
    if (error instanceof Aborted) return finished();
    throw error;
  }
}

async function startPool(size: number, language: string): Promise<Worker[]> {
  return Promise.all(
    Array.from({ length: size }, () =>
      createWorker(language, 1, {
        workerPath: OCR_ASSETS.workerPath,
        corePath: OCR_ASSETS.corePath,
        langPath: OCR_ASSETS.langPath,
      }),
    ),
  );
}
