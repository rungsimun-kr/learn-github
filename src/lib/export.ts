import JSZip from 'jszip';
import type { ImageFormat, LoadedDoc, PageItem } from '../types';
import { buildPdf } from './build';
import type { TocSettings } from './toc';
import { openForRender } from './docs';
import { safeFilename } from './download';
import type { PageRange } from './ranges';
import { renderPageImage } from './render';

/** A finished download: the bytes plus the name to save them under. */
export interface Download {
  blob: Blob;
  filename: string;
}

export type ProgressFn = (done: number, total: number) => void;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** One PDF holding every page in `pages`, in order. */
export async function exportSinglePdf(
  pages: readonly PageItem[],
  docs: ReadonlyMap<string, LoadedDoc>,
  baseName: string,
  toc?: TocSettings,
): Promise<Download> {
  const bytes = await buildPdf(pages, docs, toc);
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    filename: `${safeFilename(baseName)}.pdf`,
  };
}

/**
 * Turn page ranges into downloads: one PDF per range, delivered on its own when
 * there is a single range and inside a zip when there are several.
 */
export async function exportRanges(
  pages: readonly PageItem[],
  docs: ReadonlyMap<string, LoadedDoc>,
  ranges: readonly PageRange[],
  baseName: string,
  onProgress?: ProgressFn,
): Promise<Download> {
  if (ranges.length === 0) throw new Error('There are no ranges to export.');
  const safeBase = safeFilename(baseName);

  if (ranges.length === 1) {
    const range = ranges[0];
    const selected = range.indices.map((i) => pages[i]).filter(Boolean);
    const download = await exportSinglePdf(selected, docs, `${safeBase} pages ${range.label}`);
    onProgress?.(1, 1);
    return download;
  }

  const zip = new JSZip();
  const width = String(ranges.length).length;
  for (const [position, range] of ranges.entries()) {
    const selected = range.indices.map((i) => pages[i]).filter(Boolean);
    const bytes = await buildPdf(selected, docs);
    zip.file(`${pad(position + 1, width)} ${safeBase} pages ${range.label}.pdf`, bytes);
    onProgress?.(position + 1, ranges.length);
  }

  return {
    blob: await zip.generateAsync({ type: 'blob' }),
    filename: `${safeBase} split.zip`,
  };
}

/**
 * Render pages to PNG or JPEG. A single page downloads as an image; several
 * come back as a zip.
 */
export async function exportImages(
  pages: readonly PageItem[],
  docs: ReadonlyMap<string, LoadedDoc>,
  options: { format: ImageFormat; scale: number; quality?: number; baseName: string },
  onProgress?: ProgressFn,
): Promise<Download> {
  if (pages.length === 0) throw new Error('There are no pages to export.');
  const safeBase = safeFilename(options.baseName);
  const extension = options.format === 'jpeg' ? 'jpg' : 'png';

  // Render the assembled document rather than the original files, so rotation
  // and annotations are already baked in and there is only one way to draw a
  // page — the same one that produces the downloaded PDF.
  const assembled = await openForRender(await buildPdf(pages, docs));

  const renderAt = (index: number): Promise<Blob> =>
    renderPageImage(assembled, index, {
      scale: options.scale,
      format: options.format,
      quality: options.quality,
    });

  if (pages.length === 1) {
    const blob = await renderAt(0);
    onProgress?.(1, 1);
    return { blob, filename: `${safeBase}.${extension}` };
  }

  const zip = new JSZip();
  const width = String(pages.length).length;
  for (const position of pages.keys()) {
    const blob = await renderAt(position);
    zip.file(`${safeBase} page ${pad(position + 1, width)}.${extension}`, blob);
    onProgress?.(position + 1, pages.length);
  }

  return {
    blob: await zip.generateAsync({ type: 'blob' }),
    filename: `${safeBase} images.zip`,
  };
}
