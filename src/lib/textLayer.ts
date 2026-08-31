import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Below this many non-whitespace characters, a page is treated as an image. */
export const MIN_TEXT_CHARS = 20;

/**
 * Pull the text a PDF already carries.
 *
 * Most documents that look like books are digital, not scanned, and asking for
 * this first is what turns a 500-page job from half an hour into a few seconds.
 * A scan returns nothing here and falls through to OCR.
 */
export async function extractTextLayer(
  jsDoc: PDFDocumentProxy,
  pageIndex: number,
): Promise<string> {
  const page = await jsDoc.getPage(pageIndex + 1);
  try {
    const content = await page.getTextContent();
    let out = '';
    for (const item of content.items) {
      // Marked-content entries carry structure, not characters.
      if (!('str' in item)) continue;
      out += item.str;
      if (item.hasEOL) out += '\n';
    }
    return tidy(out);
  } finally {
    page.cleanup();
  }
}

/** Characters that actually carry content, ignoring layout whitespace. */
export function countMeaningful(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function hasUsableText(text: string, minChars = MIN_TEXT_CHARS): boolean {
  return countMeaningful(text) >= minChars;
}

/** Collapse the ragged whitespace that both extraction and OCR produce. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
