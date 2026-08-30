import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const SAMPLE_LINES = [
  'Chapter 1: The journey begins',
  'When the first light of day fell across the mountain,',
  'he knew that it was finally time to leave.',
];

/** A digital book: real text in the file, no images. */
async function writeDigital(pageCount: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595, 842]);
    SAMPLE_LINES.forEach((line, index) => {
      page.drawText(`${line} (page ${i + 1})`, {
        x: 60,
        y: 760 - index * 30,
        size: 13,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    });
  }
  return save(await doc.save(), 'digital.pdf');
}

/**
 * A scan: the text is painted into a bitmap in the browser and embedded as an
 * image, so the PDF carries no text at all and OCR is the only way to read it.
 */
async function writeScan(page: Page, pageCount: number): Promise<string> {
  const dataUrl = await page.evaluate((lines) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1240;
    canvas.height = 1754;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = '40px serif';
    lines.forEach((line, index) => context.fillText(line, 100, 220 + index * 90));
    return canvas.toDataURL('image/jpeg', 0.9);
  }, SAMPLE_LINES);

  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(dataUrl);
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return save(await doc.save(), 'scan.pdf');
}

async function save(bytes: Uint8Array, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-ocr-'));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function openDialog(page: Page, path: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(path);
  await page.waitForSelector('.page-card');
  await page.getByRole('button', { name: 'Extract text…' }).click();
  await expect(page.locator('.modal')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Drop PDFs here' })).toBeVisible();
});

test('a digital PDF is read directly, without starting the OCR engine', async ({ page }) => {
  // The shortcut that decides whether a 500-page book takes seconds or minutes.
  let engineRequested = false;
  page.on('request', (request) => {
    if (/tesseract-core|traineddata/.test(request.url())) engineRequested = true;
  });

  await openDialog(page, await writeDigital(3));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /^Extract 3 pages$/ }).click(),
  ]);

  const markdown = await readDownload(download);
  expect(download.suggestedFilename()).toBe('digital text.md');
  expect(markdown).toContain('3 read directly from the PDF');
  expect(markdown).not.toContain('recognised by OCR');
  expect(markdown).toContain('Chapter 1: The journey begins (page 1)');
  expect(markdown).toContain('## Page 3');
  expect(engineRequested).toBe(false);
});

test('a scanned page is read by OCR', async ({ page }) => {
  test.setTimeout(180_000);
  await openDialog(page, await writeScan(page, 2));

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 150_000 }),
    page.getByRole('button', { name: /^Extract 2 pages$/ }).click(),
  ]);

  const markdown = await readDownload(download);
  expect(markdown).toContain('2 recognised by OCR');
  expect(markdown).toContain('## Page 1 *(OCR)*');
  // Recognition is never exact, so assert on words rather than a whole line.
  expect(markdown).toMatch(/Chapter 1/);
  expect(markdown).toMatch(/journey begins/);
  expect(markdown).toMatch(/mountain/);
});

test('the sample run reports a measured speed before the real job', async ({ page }) => {
  test.setTimeout(180_000);
  await openDialog(page, await writeScan(page, 4));

  await page.getByRole('button', { name: 'Try 3 pages' }).click();
  await expect(page.locator('.ocr-sample')).toBeVisible({ timeout: 150_000 });

  // The projection has to come from a real measurement, not a constant.
  await expect(page.locator('.ocr-sample .summary')).toContainText('per page on this machine');
  await expect(page.locator('.ocr-preview').first()).toContainText('Chapter');
});

test('cancelling keeps the pages already read', async ({ page }) => {
  test.setTimeout(180_000);
  await openDialog(page, await writeScan(page, 12));
  await page.getByLabel('Quality').selectOption({ label: 'Best — 300 dpi' });
  await page.getByRole('button', { name: /^Extract 12 pages$/ }).click();

  // Wait until some pages are done, then stop.
  await expect(page.locator('.ocr-progress')).toBeVisible();
  await expect(page.locator('.ocr-progress .hint').first()).toContainText(/[1-9]\d* of 12/, {
    timeout: 150_000,
  });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Stop and keep what is done' }).click(),
  ]);

  const markdown = await readDownload(download);
  const kept = markdown.match(/^## Page /gm) ?? [];
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(12);
});
