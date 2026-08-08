import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * A fixture whose pages are visually distinct (big numeral) and structurally
 * distinct (page N is N*10 points wide), so both the rendered thumbnails and
 * the exported PDF can be checked.
 */
async function makeFixture(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([(i + 1) * 10 + 200, 300]);
    page.drawText(String(i + 1), { x: 40, y: 120, size: 96, font, color: rgb(0.1, 0.1, 0.1) });
  }
  return doc.save();
}

async function writeFixture(pageCount: number, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-editor-'));
  const path = join(dir, name);
  await writeFile(path, await makeFixture(pageCount));
  return path;
}

async function addFile(page: Page, path: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(path);
}

async function readDownload(download: Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Drop PDFs here' })).toBeVisible();
});

test('renders thumbnails for a loaded PDF', async ({ page }) => {
  await addFile(page, await writeFixture(3, 'three.pdf'));

  await expect(page.locator('.page-card')).toHaveCount(3);
  // Proves the pdf.js worker resolved and rendered — the most fragile wiring.
  const firstThumb = page.locator('.page-card .thumb img').first();
  await expect(firstThumb).toBeVisible();
  await expect(firstThumb).toHaveJSProperty('naturalWidth', 240);
  await expect(page.locator('.status-bar')).toContainText('3 pages');
});

test('merges two files into one page list', async ({ page }) => {
  await addFile(page, await writeFixture(3, 'three.pdf'));
  await expect(page.locator('.page-card')).toHaveCount(3);

  await addFile(page, await writeFixture(2, 'two.pdf'));
  await expect(page.locator('.page-card')).toHaveCount(5);
  await expect(page.locator('.status-bar')).toContainText('2 files');
});

test('deletes, rotates and downloads the edited document', async ({ page }) => {
  await addFile(page, await writeFixture(4, 'four.pdf'));
  await expect(page.locator('.page-card')).toHaveCount(4);

  await page.getByRole('button', { name: 'Delete page 2' }).click();
  await expect(page.locator('.page-card')).toHaveCount(3);

  await page.getByRole('button', { name: 'Rotate page 1 right' }).click();
  // The whole frame turns, not just the bitmap, so annotations turn with it.
  await expect(page.locator('.page-card .thumb-frame').first()).toHaveCSS(
    'transform',
    'matrix(0, 1, -1, 0, 0, 0)',
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);

  expect(download.suggestedFilename()).toBe('four.pdf');
  const result = await PDFDocument.load(await readDownload(download));
  expect(result.getPageCount()).toBe(3);
  // Page 2 of the fixture (220pt wide) is the one that was deleted.
  expect(result.getPages().map((p) => Math.round(p.getWidth()))).toEqual([210, 230, 240]);
  expect(result.getPage(0).getRotation().angle).toBe(90);
});

test('undo restores a deleted page', async ({ page }) => {
  await addFile(page, await writeFixture(3, 'three.pdf'));
  await page.getByRole('button', { name: 'Delete page 1' }).click();
  await expect(page.locator('.page-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.page-card')).toHaveCount(3);
});

test('extracts a page range to a new PDF', async ({ page }) => {
  await addFile(page, await writeFixture(6, 'six.pdf'));
  await expect(page.locator('.page-card')).toHaveCount(6);

  await page.getByRole('button', { name: 'Split…' }).click();
  await page.getByLabel('Pages to extract').fill('2-4');
  await expect(page.locator('.summary')).toContainText('One PDF with 3 pages');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);

  expect(download.suggestedFilename()).toBe('six pages 2-4.pdf');
  const result = await PDFDocument.load(await readDownload(download));
  expect(result.getPages().map((p) => Math.round(p.getWidth()))).toEqual([220, 230, 240]);
});

test('splitting into several files produces a zip', async ({ page }) => {
  await addFile(page, await writeFixture(3, 'three.pdf'));
  await page.getByRole('button', { name: 'Split…' }).click();
  await page.getByRole('radio', { name: 'Every page as its own file' }).check();
  await expect(page.locator('.summary')).toContainText('3 PDFs');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);

  expect(download.suggestedFilename()).toBe('three split.zip');
  const bytes = await readDownload(download);
  expect(Buffer.from(bytes.subarray(0, 2)).toString()).toBe('PK');
});

test('reorders pages by dragging one onto another', async ({ page }) => {
  await addFile(page, await writeFixture(3, 'three.pdf'));
  await expect(page.locator('.page-card')).toHaveCount(3);

  // Dropping on the centre of a card places the dragged page after it.
  await page.dragAndDrop('.page-card:nth-child(1)', '.page-card:nth-child(3)');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);

  const result = await PDFDocument.load(await readDownload(download));
  expect(result.getPages().map((p) => Math.round(p.getWidth()))).toEqual([220, 230, 210]);
});

test('inserts another PDF after the selected page', async ({ page }) => {
  await addFile(page, await writeFixture(3, 'three.pdf'));
  await page.locator('.page-card').first().getByRole('checkbox').click();

  await expect(page.getByRole('button', { name: 'Insert at 2' })).toBeEnabled();
  await page.getByRole('button', { name: 'Insert at 2' }).click();
  await addFile(page, await writeFixture(2, 'two.pdf'));

  await expect(page.locator('.page-card')).toHaveCount(5);
  await expect(page.locator('.page-source')).toHaveText([
    'three.pdf',
    'two.pdf',
    'two.pdf',
    'three.pdf',
    'three.pdf',
  ]);
});

test('exports a selected page as a PNG', async ({ page }) => {
  await addFile(page, await writeFixture(2, 'two.pdf'));
  await page.locator('.page-card').first().getByRole('checkbox').click();

  await page.getByRole('button', { name: 'Export images…' }).click();
  await expect(page.getByRole('radio', { name: /Selected pages/ })).toBeChecked();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);

  expect(download.suggestedFilename()).toBe('two.png');
  const bytes = await readDownload(download);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test('rejects a file that is not a PDF', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-editor-'));
  const path = join(dir, 'notes.pdf');
  await writeFile(path, 'this is not a pdf');

  await addFile(page, path);
  await expect(page.getByRole('alert')).toContainText('is not a PDF file');
  await expect(page.locator('.page-card')).toHaveCount(0);
});
