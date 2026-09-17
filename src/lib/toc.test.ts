import { describe, expect, it } from 'vitest';
import { fitTitle, layoutToc, seedFromFiles, type TocEntry } from './toc';
import type { PageItem } from '../types';

const page = (id: string, docId: string): PageItem => ({
  id,
  docId,
  pageIndex: 0,
  rotation: 0,
  annotations: [],
  selected: false,
});

const entry = (id: string, title: string, pageId: string): TocEntry => ({ id, title, pageId });

const A4 = { width: 595, height: 842 };

describe('seedFromFiles', () => {
  const docs = new Map([
    ['d1', { name: 'report.pdf' }],
    ['d2', { name: 'appendix.pdf' }],
  ]);

  it('makes one entry per file, pointing at that file\'s first page', () => {
    const pages = [page('p1', 'd1'), page('p2', 'd1'), page('p3', 'd2'), page('p4', 'd2')];
    expect(seedFromFiles(pages, docs)).toMatchObject([
      { title: 'report', pageId: 'p1' },
      { title: 'appendix', pageId: 'p3' },
    ]);
  });

  it('follows the page order, not the order the files were added', () => {
    // The appendix was dragged to the front; its entry should lead.
    const pages = [page('p3', 'd2'), page('p1', 'd1')];
    expect(seedFromFiles(pages, docs).map((e) => e.title)).toEqual(['appendix', 'report']);
  });

  it('points at the first page of a file even when it is split up', () => {
    const pages = [page('p1', 'd1'), page('p3', 'd2'), page('p2', 'd1')];
    expect(seedFromFiles(pages, docs)).toHaveLength(2);
  });

  it('copes with a file it cannot name', () => {
    expect(seedFromFiles([page('p1', 'gone')], docs)[0].title).toBe('Untitled');
  });

  it('has nothing to seed from an empty document', () => {
    expect(seedFromFiles([], docs)).toEqual([]);
  });
});

describe('layoutToc page numbers', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page(`p${i + 1}`, 'd1'));

  it('counts the contents page itself, so numbers match the reader\'s counter', () => {
    // Content page 1 becomes page 2 once one contents page sits in front.
    const layout = layoutToc([entry('t1', 'Start', 'p1')], pages, A4);
    expect(layout.pageCount).toBe(1);
    expect(layout.pages[0][0].pageNumber).toBe(2);
    expect(layout.pages[0][0].contentIndex).toBe(0);
  });

  it('shifts every number by however many contents pages there are', () => {
    const many = Array.from({ length: 200 }, (_, i) => page(`q${i}`, 'd1'));
    const entries = many.map((p, i) => entry(`t${i}`, `Item ${i}`, p.id));
    const layout = layoutToc(entries, many, A4);

    expect(layout.pageCount).toBeGreaterThan(1);
    const rows = layout.pages.flat();
    expect(rows[0].pageNumber).toBe(layout.pageCount + 1);
    expect(rows.at(-1)!.pageNumber).toBe(many.length + layout.pageCount);
  });

  it('puts the rows in page order however they were typed', () => {
    const entries = [
      entry('t1', 'Last', 'p9'),
      entry('t2', 'First', 'p2'),
      entry('t3', 'Middle', 'p5'),
    ];
    const rows = layoutToc(entries, pages, A4).pages.flat();
    expect(rows.map((row) => row.entry.title)).toEqual(['First', 'Middle', 'Last']);
    // Which means the printed numbers always ascend.
    expect(rows.map((row) => row.pageNumber)).toEqual([3, 6, 10]);
  });

  it('leaves out an entry whose page has been deleted, and says so', () => {
    const entries = [entry('t1', 'Still here', 'p1'), entry('t2', 'Deleted', 'ghost')];
    const layout = layoutToc(entries, pages, A4);
    expect(layout.pages.flat()).toHaveLength(1);
    expect(layout.dropped).toBe(1);
  });

  it('handles a contents list with nothing in it', () => {
    const layout = layoutToc([], pages, A4);
    expect(layout.pageCount).toBe(1);
    expect(layout.pages.flat()).toEqual([]);
    expect(layout.dropped).toBe(0);
  });
});

describe('layoutToc pagination', () => {
  const pages = Array.from({ length: 400 }, (_, i) => page(`p${i}`, 'd1'));
  const entriesFor = (count: number) =>
    Array.from({ length: count }, (_, i) => entry(`t${i}`, `Item ${i}`, `p${i}`));

  it('keeps a short list on one page', () => {
    expect(layoutToc(entriesFor(5), pages, A4).pageCount).toBe(1);
  });

  it('spills onto more pages once the first is full', () => {
    const layout = layoutToc(entriesFor(120), pages, A4);
    expect(layout.pageCount).toBeGreaterThan(1);
    expect(layout.pages.flat()).toHaveLength(120);
  });

  it('never loses or repeats an entry when it spills', () => {
    const layout = layoutToc(entriesFor(95), pages, A4);
    const ids = layout.pages.flat().map((row) => row.entry.id);
    expect(ids).toHaveLength(95);
    expect(new Set(ids).size).toBe(95);
  });

  it('fits fewer rows on a shorter page', () => {
    const tall = layoutToc(entriesFor(120), pages, A4).pageCount;
    const short = layoutToc(entriesFor(120), pages, { width: 595, height: 400 }).pageCount;
    expect(short).toBeGreaterThan(tall);
  });

  it('keeps every row on the page rather than running off the bottom', () => {
    const layout = layoutToc(entriesFor(120), pages, A4);
    for (const row of layout.pages.flat()) {
      expect(row.y).toBeGreaterThanOrEqual(0);
      expect(row.y).toBeLessThan(layout.headingY);
    }
  });
});

describe('fitTitle', () => {
  // Stand-in for font metrics: every character is 10 units wide.
  const measure = (text: string) => text.length * 10;

  it('leaves a title that already fits alone', () => {
    expect(fitTitle('Short', 100, measure)).toBe('Short');
  });

  it('truncates with an ellipsis rather than overrunning the line', () => {
    const fitted = fitTitle('A very long chapter title indeed', 100, measure);
    expect(fitted.endsWith('…')).toBe(true);
    expect(measure(fitted)).toBeLessThanOrEqual(100);
  });

  it('does not leave a space stranded before the ellipsis', () => {
    expect(fitTitle('Chapter one two', 90, measure)).not.toContain(' …');
  });

  it('survives a width too small for anything', () => {
    expect(fitTitle('Anything', 5, measure)).toBe('A…');
  });
});
