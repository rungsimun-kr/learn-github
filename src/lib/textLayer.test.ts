import { describe, expect, it } from 'vitest';
import { countMeaningful, hasUsableText, tidy, MIN_TEXT_CHARS } from './textLayer';

describe('countMeaningful', () => {
  it('ignores whitespace of every kind', () => {
    expect(countMeaningful('  a\tb\n\nc  ')).toBe(3);
  });

  it('counts Thai characters like any other', () => {
    expect(countMeaningful('สวัสดี ครับ')).toBe(10);
  });

  it('is zero for a blank page', () => {
    expect(countMeaningful('   \n\n \t ')).toBe(0);
  });
});

describe('hasUsableText', () => {
  // This decision is what keeps a digital book from being needlessly OCR'd,
  // and a scan from being silently skipped.
  it('rejects a page that yielded nothing', () => {
    expect(hasUsableText('')).toBe(false);
    expect(hasUsableText('\n \n')).toBe(false);
  });

  it('rejects the stray characters a scan often carries', () => {
    // A page number and a scanner artefact are not a text layer.
    expect(hasUsableText('12')).toBe(false);
    expect(hasUsableText('· 47 ·')).toBe(false);
  });

  it('accepts a page with a real sentence on it', () => {
    expect(hasUsableText('The quick brown fox jumps over the lazy dog.')).toBe(true);
    expect(hasUsableText('เมื่อแสงแรกของวันสาดส่องลงมาบนยอดเขา')).toBe(true);
  });

  it('sits exactly on the documented threshold', () => {
    expect(hasUsableText('x'.repeat(MIN_TEXT_CHARS - 1))).toBe(false);
    expect(hasUsableText('x'.repeat(MIN_TEXT_CHARS))).toBe(true);
  });

  it('takes a stricter or looser bar from the caller', () => {
    expect(hasUsableText('short', 3)).toBe(true);
    expect(hasUsableText('short', 99)).toBe(false);
  });
});

describe('tidy', () => {
  it('collapses runs of spaces without joining separate lines', () => {
    expect(tidy('a    b\nc')).toBe('a b\nc');
  });

  it('normalises Windows line endings', () => {
    expect(tidy('a\r\nb')).toBe('a\nb');
  });

  it('keeps a paragraph break but drops bigger gaps', () => {
    expect(tidy('a\n\nb\n\n\n\nc')).toBe('a\n\nb\n\nc');
  });

  it('trims the edges', () => {
    expect(tidy('\n\n  hello  \n\n')).toBe('hello');
  });

  it('leaves already-clean text alone', () => {
    expect(tidy('one\ntwo\n\nthree')).toBe('one\ntwo\n\nthree');
  });
});
