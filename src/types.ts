import type { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation } from './lib/annotations';

/**
 * A PDF file the user has loaded, kept open by both PDF libraries.
 *
 * Deliberately no copy of the raw bytes: each library parses its own and a
 * third copy would just sit there. On a 300 MB scanned book that copy is 300 MB
 * of nothing.
 */
export interface LoadedDoc {
  id: string;
  name: string;
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
  /**
   * Marks drawn on this page, in PDF user space on the unrotated page. They
   * travel with the item, so reordering, copying and undo all cover them.
   */
  annotations: Annotation[];
  selected: boolean;
}

export type ImageFormat = 'png' | 'jpeg';
