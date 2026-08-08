import { PDFDocument, degrees, type PDFFont } from 'pdf-lib';
import type { LoadedDoc, PageItem } from '../types';
import { drawAnnotation, needsFont } from './drawAnnotations';
import { embedTextFont } from './font';

/**
 * The slice of a loaded document that writing needs. Narrower than `LoadedDoc`
 * so this module can be exercised in Node without pdf.js or a browser.
 */
export type PdfSource = Pick<LoadedDoc, 'libDoc'>;

function normaliseAngle(angle: number): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

/**
 * Assemble a new PDF from an ordered list of page items.
 *
 * `pdf-lib`'s `copyPages` only accepts pages from one source document at a
 * time, so rather than a round trip per output page we group the list by source
 * document, copy each document's pages in a single call, then walk the list
 * again and drain the per-document queues in order. Repeating the same source
 * page is fine — every entry in `indices` yields an independent copy.
 */
export async function buildPdf(
  pages: readonly PageItem[],
  docs: ReadonlyMap<string, PdfSource>,
): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new Error('There are no pages to write.');
  }

  const out = await PDFDocument.create();

  const wanted = new Map<string, number[]>();
  for (const page of pages) {
    const indices = wanted.get(page.docId);
    if (indices) indices.push(page.pageIndex);
    else wanted.set(page.docId, [page.pageIndex]);
  }

  const copied = new Map<string, Awaited<ReturnType<PDFDocument['copyPages']>>>();
  for (const [docId, indices] of wanted) {
    const source = docs.get(docId);
    if (!source) throw new Error(`A page refers to a file that is no longer loaded.`);
    copied.set(docId, await out.copyPages(source.libDoc, indices));
  }

  // Text annotations need a Unicode font; fetch and embed it once, and only
  // when the document actually contains some.
  let font: PDFFont | null = null;
  if (pages.some((page) => needsFont(page.annotations))) {
    font = await embedTextFont(out);
  }

  const cursors = new Map<string, number>();
  for (const item of pages) {
    const cursor = cursors.get(item.docId) ?? 0;
    cursors.set(item.docId, cursor + 1);

    const page = copied.get(item.docId)![cursor];
    if (item.rotation !== 0) {
      // The editor's rotation is a delta; stack it on whatever the page carried.
      page.setRotation(degrees(normaliseAngle(page.getRotation().angle + item.rotation)));
    }

    if (item.annotations.length > 0) {
      // Annotations are stored against the unrotated page, which is exactly
      // what getSize reports, and were placed at the rotation now in effect.
      const size = page.getSize();
      const geometry = {
        width: size.width,
        height: size.height,
        rotation: normaliseAngle(page.getRotation().angle),
      };
      for (const annotation of item.annotations) {
        drawAnnotation(page, annotation, geometry, font);
      }
    }

    out.addPage(page);
  }

  return out.save();
}

/** Build a PDF containing only the pages at the given positions in `pages`. */
export function selectPages(pages: readonly PageItem[], indices: readonly number[]): PageItem[] {
  return indices.map((i) => pages[i]).filter((page): page is PageItem => page !== undefined);
}
