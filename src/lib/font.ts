import type { PDFDocument, PDFFont } from 'pdf-lib';
import fontUrl from '../assets/fonts/Sarabun-Regular.ttf?url';
import boldFontUrl from '../assets/fonts/Sarabun-Bold.ttf?url';

/**
 * Text annotations need a Unicode font. The standard PDF fonts are WinAnsi
 * only and *throw* on Thai — or on anything outside Latin-1 — so we embed
 * Sarabun (SIL Open Font License), which covers Thai and Latin.
 *
 * Only the URL is in the bundle; the font is fetched the first time a
 * document that needs it is exported, and never for documents that don't.
 */
function makeLoader(url: string): () => Promise<ArrayBuffer> {
  let pending: Promise<ArrayBuffer> | null = null;
  return () => {
    pending ??= fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`the text font could not be loaded (${response.status})`);
        return response.arrayBuffer();
      })
      .catch((error: unknown) => {
        pending = null; // let a later export try again
        throw error;
      });
    return pending;
  };
}

const fetchRegular = makeLoader(fontUrl);
const fetchBold = makeLoader(boldFontUrl);

async function embed(doc: PDFDocument, fetchBytes: () => Promise<ArrayBuffer>): Promise<PDFFont> {
  // fontkit is ~700 KB and only custom fonts need it, so it is a chunk of its
  // own that most sessions never fetch.
  const [{ default: fontkit }, bytes] = await Promise.all([
    import('@pdf-lib/fontkit'),
    fetchBytes(),
  ]);
  doc.registerFontkit(fontkit);
  return doc.embedFont(new Uint8Array(bytes), { subset: true });
}

/** Embed the regular-weight text font into an output document, subsetted to what is used. */
export async function embedTextFont(doc: PDFDocument): Promise<PDFFont> {
  return embed(doc, fetchRegular);
}

/**
 * Embed the bold weight — used for the contents page's heading and entry
 * titles, so a title reads as a heading rather than another list line.
 */
export async function embedBoldTextFont(doc: PDFDocument): Promise<PDFFont> {
  return embed(doc, fetchBold);
}
