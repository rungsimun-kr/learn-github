import type { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** A PDF file the user has loaded, kept open by both PDF libraries. */
export interface LoadedDoc {
  id: string;
  name: string;
  /**
   * Pristine copy of the file. Never hand this array straight to pdf.js or
   * pdf-lib — pdf.js transfers the underlying buffer to its worker and detaches
   * it, which would corrupt every other reader. Always pass `bytes.slice()`.
   */
  bytes: Uint8Array;
  /** pdf-lib document, used as a source when writing new PDFs. */
  libDoc: PDFDocument;
  /** pdf.js document, used for rendering thumbnails and images. */
  jsDoc: PDFDocumentProxy;
  pageCount: number;
}

/**
 * One page in the editor's working document. The whole app is an ordered list
 * of these: merging appends, inserting splices, deleting removes, reordering
 * moves, and exporting reads a subset.
 */
export interface PageItem {
  /** Stable id, unique across the session (React keys, drag and drop). */
  id: string;
  /** Which loaded file this page comes from. */
  docId: string;
  /** 0-based page index inside that file. */
  pageIndex: number;
  /** Extra rotation applied on top of the page's own, in degrees. */
  rotation: 0 | 90 | 180 | 270;
  selected: boolean;
}

export type ImageFormat = 'png' | 'jpeg';
