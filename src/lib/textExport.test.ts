import { describe, expect, it } from 'vitest';
import type { PageText } from './ocr';
import { buildMarkdown, textDownload } from './textExport';

const fromPdf = (label: number, text: string): PageText => ({
  label,
  text,
  source: 'pdf',
  ms: 1,
});

const fromOcr = (label: number, text: string, confidence = 90): PageText => ({
  label,
  text,
  source: 'ocr',
  confidence,
  ms: 500,
});

describe('buildMarkdown', () => {
  it('titles the document and numbers every page', () => {
    const out = buildMarkdown('book.pdf', [fromPdf(1, 'first'), fromPdf(2, 'second')]);
    expect(out).toContain('# book.pdf');
    expect(out).toContain('## Page 1');
    expect(out).toContain('## Page 2');
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('says how much was exact and how much was guessed', () => {
    const out = buildMarkdown('mixed.pdf', [
      fromPdf(1, 'exact text from the file'),
      fromOcr(2, 'recognised text', 80),
      fromOcr(3, 'more recognised text', 90),
    ]);
    expect(out).toContain('3 pages');
    expect(out).toContain('1 read directly from the PDF');
    expect(out).toContain('2 recognised by OCR');
    // The reader should know how much to trust it: (80 + 90) / 2.
    expect(out).toContain('average confidence 85%');
  });

  it('marks only the OCR pages, so exact text is distinguishable', () => {
    const out = buildMarkdown('mixed.pdf', [fromPdf(1, 'a'), fromOcr(2, 'b')]);
    expect(out).toContain('## Page 1\n');
    expect(out).not.toContain('## Page 1 *(OCR)*');
    expect(out).toContain('## Page 2 *(OCR)*');
  });

  it('leaves out the OCR caveat when nothing was guessed', () => {
    const out = buildMarkdown('digital.pdf', [fromPdf(1, 'a'), fromPdf(2, 'b')]);
    expect(out).not.toContain('may contain mistakes');
    expect(out).not.toContain('OCR');
  });

  it('is explicit about a page that yielded nothing', () => {
    expect(buildMarkdown('book.pdf', [fromOcr(1, '   ')])).toContain('*(no text found)*');
  });

  it('keeps Thai text intact', () => {
    const thai = 'เมื่อแสงแรกของวันสาดส่องลงมาบนยอดเขา';
    expect(buildMarkdown('ไทย.pdf', [fromOcr(1, thai)])).toContain(thai);
  });

  it('numbers by the label, so a partial run stays honest about which pages', () => {
    // Cancelling mid-run leaves gaps; the numbers must still be the real ones.
    const out = buildMarkdown('book.pdf', [fromOcr(1, 'a'), fromOcr(2, 'b'), fromOcr(9, 'i')]);
    expect(out).toContain('## Page 9');
    expect(out).not.toContain('## Page 3');
  });

  it('ends with exactly one newline', () => {
    const out = buildMarkdown('book.pdf', [fromPdf(1, 'text')]);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

describe('textDownload', () => {
  it('names the file after the document', () => {
    expect(textDownload('My Book', '# x').filename).toBe('My Book text.md');
  });

  it('strips characters a filesystem would reject', () => {
    expect(textDownload('a/b:c', '# x').filename).toBe('a-b-c text.md');
  });

  it('declares UTF-8, so Thai survives the round trip', () => {
    expect(textDownload('x', '# x').blob.type).toContain('charset=utf-8');
  });
});
