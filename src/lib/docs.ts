import './mapPolyfill';
import { PDFDocument } from 'pdf-lib';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { LoadedDoc, PageItem } from '../types';
import { uid } from './uid';

// Run our own worker module (see pdfWorker.ts) instead of letting pdf.js fetch
// one: Vite bundles it, so there is no CDN dependency, and the polyfill it
// imports is installed on the worker thread before any parsing happens.
GlobalWorkerOptions.workerPort = new Worker(new URL('./pdfWorker.ts', import.meta.url), {
  type: 'module',
});

/** A load failure with a message that is safe to show to the user as-is. */
export class PdfLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfLoadError';
  }
}

const PDF_HEADER = '%PDF-';

/**
 * Read a file into both PDF libraries.
 *
 * pdf.js transfers whatever buffer it is given to its worker thread and leaves
 * the original detached, so each library gets its own copy of the bytes and we
 * keep a third, pristine copy on the `LoadedDoc`.
 */
export async function loadPdfFile(file: File): Promise<LoadedDoc> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.length === 0) {
    throw new PdfLoadError(`"${file.name}" is empty.`);
  }
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (!header.includes(PDF_HEADER)) {
    throw new PdfLoadError(`"${file.name}" is not a PDF file.`);
  }

  let libDoc: PDFDocument;
  try {
    libDoc = await PDFDocument.load(bytes.slice());
  } catch (error) {
    throw new PdfLoadError(describeLoadError(file.name, error));
  }

  let jsDoc;
  try {
    jsDoc = await getDocument({ data: bytes.slice() }).promise;
  } catch (error) {
    throw new PdfLoadError(describeLoadError(file.name, error));
  }

  return {
    id: uid('doc'),
    name: file.name,
    libDoc,
    jsDoc,
    pageCount: libDoc.getPageCount(),
  };
}

function describeLoadError(filename: string, error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'PasswordException' || /encrypt/i.test(name) || /encrypt|password/i.test(message)) {
    return `"${filename}" is password-protected. Remove the password and try again.`;
  }
  return `"${filename}" could not be opened — it may be damaged. (${message})`;
}

/**
 * Open freshly built PDF bytes for rendering. Lives here so every caller goes
 * through the same worker setup above.
 */
export function openForRender(bytes: Uint8Array) {
  return getDocument({ data: bytes.slice() }).promise;
}

/** Fresh page items covering every page of a newly loaded document. */
export function pagesForDoc(doc: LoadedDoc): PageItem[] {
  return Array.from({ length: doc.pageCount }, (_, pageIndex) => ({
    id: uid('page'),
    docId: doc.id,
    pageIndex,
    rotation: 0 as const,
    annotations: [],
    selected: false,
  }));
}
