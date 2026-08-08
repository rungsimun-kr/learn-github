import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** A plain white page, so any colour sampled later came from an annotation. */
async function writeFixture(pageCount = 1): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: 20, size: 9, font, color: rgb(0.6, 0.6, 0.6) });
  }
  const dir = await mkdtemp(join(tmpdir(), 'pdf-annotations-'));
  const path = join(dir, 'blank.pdf');
  await writeFile(path, await doc.save());
  return path;
}

async function readDownload(download: Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

async function openEditor(page: Page, path: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(path);
  await page.waitForSelector('.page-card .thumb img');
  await page.locator('.page-open').first().click();
  await page.waitForSelector('.editor-stage img');
  // Let the fit-to-window pass settle before measuring the stage.
  await page.waitForTimeout(400);
}

/** Drag across the page, in fractions of the displayed page's size. */
async function dragOnStage(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  const box = (await page.locator('.editor-stage').boundingBox())!;
  const at = ([fx, fy]: [number, number]) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const start = at(from);
  const end = at(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/**
 * Sample the rendered page at fractions of its size.
 *
 * Reading pixels back out of a re-imported export is what actually proves a
 * mark landed where the user put it — far more meaningful than matching the
 * operators pdf-lib happened to emit.
 */
async function samplePixels(page: Page, spots: Array<[number, number]>): Promise<string[]> {
  return page.evaluate((points) => {
    const image = document.querySelector<HTMLImageElement>('.editor-stage img');
    if (!image) throw new Error('no page image');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);

    return points.map(([fx, fy]) => {
      const x = Math.round(fx * (canvas.width - 1));
      const y = Math.round(fy * (canvas.height - 1));
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      return `${r},${g},${b}`;
    });
  }, spots);
}

/**
 * A 40%-opacity yellow multiplied over white lands near RGB(255, 239, 157), so
 * the test looks for "much more red than blue" rather than a saturated yellow.
 */
function isYellowish(sample: string): boolean {
  const [r, g, b] = sample.split(',').map(Number);
  return r > 200 && g > 180 && r - b > 40;
}

function isWhite(sample: string): boolean {
  return sample.split(',').map(Number).every((channel) => channel > 240);
}

/** Export, then reopen the exported file so we see it as a reader would. */
async function exportAndReopen(page: Page): Promise<Uint8Array> {
  await page.getByRole('button', { name: 'Done' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  const bytes = await readDownload(download);

  const dir = await mkdtemp(join(tmpdir(), 'pdf-annotations-out-'));
  const path = join(dir, 'exported.pdf');
  await writeFile(path, bytes);

  await page.getByRole('button', { name: 'Start over' }).click();
  await openEditor(page, path);
  return bytes;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Drop PDFs here' })).toBeVisible();
});

test('a highlight is baked into the exported PDF where it was drawn', async ({ page }) => {
  await openEditor(page, await writeFixture());

  await page.getByRole('radio', { name: 'Rectangle' }).click();
  await dragOnStage(page, [0.05, 0.05], [0.45, 0.45]);
  await expect(page.locator('.editor-stage .annotation-layer rect')).toHaveCount(1);

  await exportAndReopen(page);

  const [topLeft, bottomRight] = await samplePixels(page, [
    [0.25, 0.25],
    [0.75, 0.75],
  ]);
  expect(isYellowish(topLeft)).toBe(true);
  expect(isWhite(bottomRight)).toBe(true);
});

test('marks land in the right place on a rotated page', async ({ page }) => {
  // The regression the view↔PDF rotation table exists to prevent: a mark drawn
  // on a turned page must come back in the same visual corner.
  await page.locator('input[type="file"]').setInputFiles(await writeFixture());
  await page.waitForSelector('.page-card .thumb img');
  await page.getByRole('button', { name: 'Rotate page 1 right' }).click();

  await page.locator('.page-open').first().click();
  await page.waitForSelector('.editor-stage img');
  await page.waitForTimeout(400);

  // The page is now landscape; confirm the editor is showing it that way.
  const stage = (await page.locator('.editor-stage').boundingBox())!;
  expect(stage.width).toBeGreaterThan(stage.height);

  await page.getByRole('radio', { name: 'Rectangle' }).click();
  await dragOnStage(page, [0.05, 0.05], [0.45, 0.45]);

  await exportAndReopen(page);

  const [topLeft, bottomRight] = await samplePixels(page, [
    [0.25, 0.25],
    [0.75, 0.75],
  ]);
  expect(isYellowish(topLeft)).toBe(true);
  expect(isWhite(bottomRight)).toBe(true);
});

test('an arrow and a freehand stroke survive the export', async ({ page }) => {
  await openEditor(page, await writeFixture());

  await page.getByRole('radio', { name: 'Arrow' }).click();
  await page.getByRole('radio', { name: 'Red' }).click();
  await dragOnStage(page, [0.2, 0.8], [0.2, 0.2]);
  await expect(page.locator('.editor-stage .annotation-layer line')).toHaveCount(1);
  await expect(page.locator('.editor-stage .annotation-layer polygon')).toHaveCount(1);

  await page.getByRole('radio', { name: 'Freehand' }).click();
  await dragOnStage(page, [0.6, 0.3], [0.9, 0.7]);
  await expect(page.locator('.editor-stage .annotation-layer polyline')).toHaveCount(1);

  await exportAndReopen(page);

  // Both strokes are red; the untouched middle-right stays white.
  const [onArrow, blank] = await samplePixels(page, [
    [0.2, 0.5],
    [0.45, 0.9],
  ]);
  const [r, g, b] = onArrow.split(',').map(Number);
  expect(r).toBeGreaterThan(150);
  expect(g).toBeLessThan(150);
  expect(b).toBeLessThan(150);
  expect(isWhite(blank)).toBe(true);
});

test('a Thai text box exports with its font embedded', async ({ page }) => {
  await openEditor(page, await writeFixture());

  await page.getByRole('radio', { name: 'Text box' }).click();
  const box = (await page.locator('.editor-stage').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.3);

  await expect(page.locator('.annotation-input')).toBeVisible();
  await page.keyboard.type('ตรวจสอบยอดนี้');
  await page.getByRole('button', { name: 'Done' }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);

  // A standard PDF font cannot encode Thai, so the export must carry a real
  // embedded font programme or the glyphs would be lost.
  const doc = await PDFDocument.load(await readDownload(download));
  const objects = [...doc.context.enumerateIndirectObjects()].map(([, value]) => String(value));
  expect(objects.some((object) => object.includes('FontFile2'))).toBe(true);
  expect(objects.some((object) => object.includes('Sarabun'))).toBe(true);
});

test('marks show on the grid thumbnail and can be deleted', async ({ page }) => {
  await openEditor(page, await writeFixture());

  await page.getByRole('radio', { name: 'Rectangle' }).click();
  await dragOnStage(page, [0.1, 0.1], [0.6, 0.4]);
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.locator('.thumb .annotation-layer rect')).toHaveCount(1);

  // Reopen, select the mark and remove it.
  await page.locator('.page-open').first().click();
  await page.waitForSelector('.editor-stage img');
  await page.waitForTimeout(400);

  const box = (await page.locator('.editor-stage').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.25);
  await expect(page.locator('.handle')).toHaveCount(4);

  await page.getByRole('button', { name: 'Delete mark' }).click();
  await expect(page.locator('.editor-stage .annotation-layer rect')).toHaveCount(0);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.thumb .annotation-layer')).toHaveCount(0);
});

test('undo brings a deleted mark back', async ({ page }) => {
  await openEditor(page, await writeFixture());

  await page.getByRole('radio', { name: 'Rectangle' }).click();
  await dragOnStage(page, [0.1, 0.1], [0.6, 0.4]);
  await expect(page.locator('.editor-stage .annotation-layer rect')).toHaveCount(1);

  await page.getByRole('button', { name: 'Delete mark' }).click();
  await expect(page.locator('.editor-stage .annotation-layer rect')).toHaveCount(0);

  // Annotations live on the page item, so the app's own history covers them.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.thumb .annotation-layer rect')).toHaveCount(1);
});
