import { PDFDocument, degrees } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, selectPages, type PdfSource } from './build';
import type { PageItem } from '../types';

/**
 * Fixture pages are given distinct widths — page N is N*10 points wide — so the
 * order of the assembled document can be read straight back off the output.
 */
async function makeFixture(pageCount: number, rotations: number[] = []): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([(i + 1) * 10, 100]);
    if (rotations[i]) page.setRotation(degrees(rotations[i]));
  }
  return doc;
}

function item(docId: string, pageIndex: number, rotation: PageItem['rotation'] = 0): PageItem {
  return { id: `${docId}:${pageIndex}:${rotation}`, docId, pageIndex, rotation, selected: false };
}

async function readBack(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => ({
    width: Math.round(page.getWidth()),
    rotation: page.getRotation().angle,
  }));
}

describe('buildPdf', () => {
  let docs: Map<string, PdfSource>;

  beforeAll(async () => {
    docs = new Map([
      ['a', { libDoc: await makeFixture(3) }],
      ['b', { libDoc: await makeFixture(2, [0, 90]) }],
    ]);
  });

  it('writes pages in list order, interleaving source documents', async () => {
    const pages = [item('b', 0), item('a', 2), item('b', 1), item('a', 0)];
    expect((await readBack(await buildPdf(pages, docs))).map((page) => page.width)).toEqual([
      10, 30, 20, 10,
    ]);
  });

  it('copies a source page more than once when it appears twice', async () => {
    const pages = [item('a', 1), item('a', 1), item('a', 1)];
    const result = await readBack(await buildPdf(pages, docs));
    expect(result).toHaveLength(3);
    expect(result.map((page) => page.width)).toEqual([20, 20, 20]);
  });

  it('rotating one copy does not rotate the other', async () => {
    const pages = [item('a', 0, 90), item('a', 0, 0)];
    expect((await readBack(await buildPdf(pages, docs))).map((page) => page.rotation)).toEqual([
      90, 0,
    ]);
  });

  it('stacks the delta on the rotation the page already had', async () => {
    // Fixture b page 2 starts at 90°.
    const pages = [item('b', 1, 90), item('b', 1, 180), item('b', 1, 270)];
    expect((await readBack(await buildPdf(pages, docs))).map((page) => page.rotation)).toEqual([
      180, 270, 0,
    ]);
  });

  it('leaves the source documents untouched', async () => {
    await buildPdf([item('a', 0, 90), item('a', 1, 180)], docs);
    const source = docs.get('a')!.libDoc;
    expect(source.getPageCount()).toBe(3);
    expect(source.getPages().map((page) => page.getRotation().angle)).toEqual([0, 0, 0]);
  });

  it('refuses to write an empty document', async () => {
    await expect(buildPdf([], docs)).rejects.toThrow(/no pages/i);
  });

  it('reports a page whose source file is gone', async () => {
    await expect(buildPdf([item('missing', 0)], docs)).rejects.toThrow(/no longer loaded/i);
  });

  it('produces bytes that open as a PDF', async () => {
    const bytes = await buildPdf([item('a', 0)], docs);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  });
});

describe('selectPages', () => {
  const pages = [item('a', 0), item('a', 1), item('a', 2)];

  it('picks pages by position, in the order given', () => {
    expect(selectPages(pages, [2, 0]).map((page) => page.pageIndex)).toEqual([2, 0]);
  });

  it('skips positions that do not exist', () => {
    expect(selectPages(pages, [1, 99])).toHaveLength(1);
  });
});
