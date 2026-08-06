import { describe, expect, it } from 'vitest';
import { chunkEvery, eachPage, parseRanges } from './ranges';

describe('parseRanges', () => {
  it('reads single pages and ranges as 0-based indices', () => {
    expect(parseRanges('1-3, 8, 10-12', 12)).toEqual([
      { label: '1-3', indices: [0, 1, 2] },
      { label: '8', indices: [7] },
      { label: '10-12', indices: [9, 10, 11] },
    ]);
  });

  it('tolerates messy whitespace and trailing commas', () => {
    expect(parseRanges('  2 - 4 ,,\n 6 ,', 6)).toEqual([
      { label: '2-4', indices: [1, 2, 3] },
      { label: '6', indices: [5] },
    ]);
  });

  it('reverses a descending range', () => {
    expect(parseRanges('5-1', 5)).toEqual([{ label: '5-1', indices: [4, 3, 2, 1, 0] }]);
  });

  it('treats a one-page range as a single page', () => {
    expect(parseRanges('3-3', 5)).toEqual([{ label: '3-3', indices: [2] }]);
  });

  it('fills in an open start or end', () => {
    expect(parseRanges('3-', 5)).toEqual([{ label: '3-5', indices: [2, 3, 4] }]);
    expect(parseRanges('-2', 5)).toEqual([{ label: '1-2', indices: [0, 1] }]);
  });

  it('keeps overlapping ranges as the user wrote them', () => {
    expect(parseRanges('1-2, 2-3', 3)).toEqual([
      { label: '1-2', indices: [0, 1] },
      { label: '2-3', indices: [1, 2] },
    ]);
  });

  it('accepts an en dash, which is what pasted text often contains', () => {
    expect(parseRanges('2–4', 4)).toEqual([{ label: '2-4', indices: [1, 2, 3] }]);
  });

  it.each(['', '   ', ','])('rejects empty input %o', (input) => {
    expect(() => parseRanges(input, 5)).toThrow(/at least one page/i);
  });

  it.each(['0', '6', '1-9', 'x', '1-2-3', '1..3', '-'])('rejects %o', (input) => {
    expect(() => parseRanges(input, 5)).toThrow();
  });

  it('names the page count when a page is out of bounds', () => {
    expect(() => parseRanges('7', 5)).toThrow(/5 pages/);
  });

  it('refuses to work on an empty document', () => {
    expect(() => parseRanges('1', 0)).toThrow(/no pages/i);
  });
});

describe('chunkEvery', () => {
  it('splits into equal chunks', () => {
    expect(chunkEvery(6, 2)).toEqual([
      { label: '1-2', indices: [0, 1] },
      { label: '3-4', indices: [2, 3] },
      { label: '5-6', indices: [4, 5] },
    ]);
  });

  it('leaves a short final chunk', () => {
    expect(chunkEvery(5, 2).at(-1)).toEqual({ label: '5', indices: [4] });
  });

  it('returns one chunk when the size covers the document', () => {
    expect(chunkEvery(3, 10)).toEqual([{ label: '1-3', indices: [0, 1, 2] }]);
  });

  it.each([0, -1, 1.5])('rejects a size of %o', (size) => {
    expect(() => chunkEvery(6, size)).toThrow(/whole number/i);
  });
});

describe('eachPage', () => {
  it('produces one single-page range per page', () => {
    expect(eachPage(3)).toEqual([
      { label: '1', indices: [0] },
      { label: '2', indices: [1] },
      { label: '3', indices: [2] },
    ]);
  });

  it('is empty for an empty document', () => {
    expect(eachPage(0)).toEqual([]);
  });
});
