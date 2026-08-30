import { safeFilename } from './download';
import type { PageText } from './ocr';

/** Resolution presets, expressed as the dpi they work out to. */
export const OCR_QUALITIES = [
  { scale: 150 / 72, label: 'Fast — 150 dpi', hint: 'roughly half the time, misses small print' },
  { scale: 220 / 72, label: 'Balanced — 220 dpi' },
  { scale: 300 / 72, label: 'Best — 300 dpi', hint: 'slowest, best on small or faint type' },
] as const;

/**
 * Assemble the extracted pages into one Markdown document.
 *
 * The header says how much was read exactly from the PDF versus guessed by OCR,
 * because the difference matters to anyone deciding how much to trust it.
 */
export function buildMarkdown(sourceName: string, results: readonly PageText[]): string {
  const ocr = results.filter((page) => page.source === 'ocr');
  const exact = results.length - ocr.length;

  const lines: string[] = [`# ${sourceName}`, ''];

  const summary: string[] = [`${results.length} page${results.length === 1 ? '' : 's'}`];
  if (exact > 0) summary.push(`${exact} read directly from the PDF`);
  if (ocr.length > 0) {
    const average =
      ocr.reduce((sum, page) => sum + (page.confidence ?? 0), 0) / ocr.length;
    summary.push(`${ocr.length} recognised by OCR (average confidence ${Math.round(average)}%)`);
  }
  lines.push(`*${summary.join(' · ')}.*`, '');

  if (ocr.length > 0) {
    lines.push(
      '> Pages marked *OCR* were read from an image and may contain mistakes.',
      '',
    );
  }

  for (const page of results) {
    lines.push(`## Page ${page.label}${page.source === 'ocr' ? ' *(OCR)*' : ''}`, '');
    lines.push(page.text.trim() === '' ? '*(no text found)*' : page.text.trim(), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function textDownload(sourceName: string, markdown: string): { blob: Blob; filename: string } {
  return {
    blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    filename: `${safeFilename(sourceName)} text.md`,
  };
}
