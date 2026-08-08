import type { PDFDocument, PDFFont } from 'pdf-lib';
import fontUrl from '../assets/fonts/Sarabun-Regular.ttf?url';

/**
 * Text annotations need a Unicode font. The standard PDF fonts are WinAnsi
 * only and *throw* on Thai — or on anything outside Latin-1 — so we embed
 * Sarabun (SIL Open Font License), which covers Thai and Latin.
 *
 * Only the URL is in the bundle; the 83 KB of font is fetched the first time a
 * document with text is exported, and never for documents without any.
 */
let pending: Promise<ArrayBuffer> | null = null;

function fetchFont(): Promise<ArrayBuffer> {
  pending ??= fetch(fontUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`the text font could not be loaded (${response.status})`);
      return response.arrayBuffer();
    })
    .catch((error: unknown) => {
      pending = null; // let a later export try again
      throw error;
    });
  return pending;
}

/** Embed the text font into an output document, subsetted to what is used. */
export async function embedTextFont(doc: PDFDocument): Promise<PDFFont> {
  // fontkit is ~700 KB and only custom fonts need it, so it is a chunk of its
  // own that most sessions never fetch.
  const [{ default: fontkit }, bytes] = await Promise.all([
    import('@pdf-lib/fontkit'),
    fetchFont(),
  ]);
  doc.registerFontkit(fontkit);
  return doc.embedFont(new Uint8Array(bytes), { subset: true });
}
