import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** A PDF whose pages say which one they are. */
async function writeDoc(label: string, pageCount: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([400, 600]).drawText(`${label} ${i + 1}`, {
      x: 40,
      y: 520,
      size: 22,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  const dir = await mkdtemp(join(tmpdir(), 'pdf-toc-'));
  const path = join(dir, `${label.toLowerCase()}.pdf`);
  await writeFile(path, await doc.save());
  return path;
}

async function readDownload(download: Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

interface Inspected {
  pageCount: number;
  /** 1-based page numbers each link on the first page points at. */
  linkTargets: number[];
  /** Bookmark titles with the 1-based page each points at. */
  bookmarks: Array<{ title: string; page: number }>;
}

/**
 * Open the export with pdf.js and resolve every destination.
 *
 * Clicking is not simulated — what actually matters is whether a real reader
 * resolves each link to the page the contents line names.
 */
async function inspect(bytes: Uint8Array): Promise<Inspected> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes }).promise;

  const first = await doc.getPage(1);
  const annotations = await first.getAnnotations();
  const linkTargets: number[] = [];
  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link' || !Array.isArray(annotation.dest)) continue;
    linkTargets.push((await doc.getPageIndex(annotation.dest[0])) + 1);
  }

  const outline = (await doc.getOutline()) ?? [];
  const bookmarks: Array<{ title: string; page: number }> = [];
  for (const item of outline) {
    const dest = item.dest as Array<Parameters<typeof doc.getPageIndex>[0]>;
    bookmarks.push({ title: item.title, page: (await doc.getPageIndex(dest[0])) + 1 });
  }

  return { pageCount: doc.numPages, linkTargets, bookmarks };
}

async function openContents(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Contents…' }).click();
  await expect(page.locator('.modal')).toBeVisible();
}

async function download(page: Page): Promise<Uint8Array> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  return readDownload(file);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Drop PDFs or images here' })).toBeVisible();
});

test('the contents list is seeded from the files that were merged', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Alpha', 3));
  await expect(page.locator('.page-card')).toHaveCount(3);
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Beta', 2));
  await expect(page.locator('.page-card')).toHaveCount(5);

  await openContents(page);

  // One entry per file, named after it, pointing at its first page.
  const titles = page.getByLabel('Entry title');
  await expect(titles).toHaveCount(2);
  await expect(titles.nth(0)).toHaveValue('alpha');
  await expect(titles.nth(1)).toHaveValue('beta');
  await expect(page.getByLabel('Goes to page').nth(0)).toHaveValue('1');
  await expect(page.getByLabel('Goes to page').nth(1)).toHaveValue('4');
});

test('every contents line links to the page it names', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Alpha', 3));
  await expect(page.locator('.page-card')).toHaveCount(3);
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Beta', 2));
  await expect(page.locator('.page-card')).toHaveCount(5);

  await openContents(page);
  // A Thai title, which only survives if the outline is written as UTF-16BE.
  await page.getByLabel('Entry title').nth(1).fill('บทที่ ๒ ภาคผนวก');
  await page.getByRole('button', { name: 'Done' }).click();

  const result = await inspect(await download(page));

  // Five content pages plus the contents page in front of them.
  expect(result.pageCount).toBe(6);
  // Content pages 1 and 4 are pages 2 and 5 once the contents page is added.
  expect(result.linkTargets).toEqual([2, 5]);
  expect(result.bookmarks).toEqual([
    { title: 'alpha', page: 2 },
    { title: 'บทที่ ๒ ภาคผนวก', page: 5 },
  ]);
});

test('entries follow their page when the pages are reordered', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Alpha', 2));
  await expect(page.locator('.page-card')).toHaveCount(2);
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Beta', 2));
  await expect(page.locator('.page-card')).toHaveCount(4);

  /** The page number shown against a given entry title. */
  const pageFor = (title: string) =>
    page.locator('.toc-entry').filter({ has: page.getByLabel('Entry title').and(page.locator(`[value="${title}"]`)) });

  await openContents(page);
  await expect(page.locator('.toc-entry').nth(1).getByLabel('Goes to page')).toHaveValue('3');
  await page.getByRole('button', { name: 'Done' }).click();

  // Dropping on a card's centre lands after it, so Beta's first page becomes
  // page 2 — and Beta's entry has to come with it.
  await page.dragAndDrop('.page-card:nth-child(3)', '.page-card:nth-child(1)');
  await openContents(page);
  await expect(pageFor('beta').getByLabel('Goes to page')).toHaveValue('2');
  await page.getByRole('button', { name: 'Done' }).click();

  const result = await inspect(await download(page));
  expect(result.linkTargets).toEqual([2, 3]);
});

test('bookmarks can be added without a contents page', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Alpha', 3));
  await expect(page.locator('.page-card')).toHaveCount(3);

  await openContents(page);
  await page.getByRole('checkbox', { name: /contents page at the front/ }).uncheck();
  await page.getByRole('button', { name: 'Done' }).click();

  const result = await inspect(await download(page));
  // No page was added, so nothing shifted and there is no page to link from.
  expect(result.pageCount).toBe(3);
  expect(result.linkTargets).toEqual([]);
  expect(result.bookmarks).toEqual([{ title: 'alpha', page: 1 }]);
});

test('an entry whose page was deleted is reported and left out', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Alpha', 2));
  await expect(page.locator('.page-card')).toHaveCount(2);
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Beta', 2));
  await expect(page.locator('.page-card')).toHaveCount(4);

  await openContents(page);
  await expect(page.getByLabel('Entry title')).toHaveCount(2);
  await page.getByRole('button', { name: 'Done' }).click();

  // Delete the page Beta's entry points at.
  await page.getByRole('button', { name: 'Delete page 3' }).click();
  await expect(page.locator('.page-card')).toHaveCount(3);

  await openContents(page);
  await expect(page.locator('.summary')).toContainText('no longer here');
  await page.getByRole('button', { name: 'Done' }).click();

  const result = await inspect(await download(page));
  expect(result.linkTargets).toEqual([2]);
  expect(result.bookmarks).toEqual([{ title: 'alpha', page: 2 }]);
});

test('a page selection is exported without a contents page', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(await writeDoc('Alpha', 4));
  await expect(page.locator('.page-card')).toHaveCount(4);

  await openContents(page);
  await page.getByRole('button', { name: 'Done' }).click();

  // Extracting two pages should not drag a table of contents along with them.
  await page.locator('.page-card').nth(1).getByRole('checkbox').click();
  await page.locator('.page-card').nth(2).getByRole('checkbox').click();

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download 2 selected' }).click(),
  ]);
  const result = await inspect(await readDownload(file));

  expect(result.pageCount).toBe(2);
  expect(result.bookmarks).toEqual([]);
});
