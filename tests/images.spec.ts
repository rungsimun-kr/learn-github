import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function save(data: Uint8Array | Buffer, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-images-'));
  const path = join(dir, name);
  await writeFile(path, data);
  return path;
}

async function readDownload(download: Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Paint an image in the browser and bring the bytes back.
 *
 * `band` colours the top edge, which is how the EXIF test tells which way up
 * the picture ended.
 */
async function makeImage(
  page: Page,
  options: { width: number; height: number; type: 'png' | 'jpeg'; band?: string },
): Promise<Buffer> {
  const dataUrl = await page.evaluate((o) => {
    const canvas = document.createElement('canvas');
    canvas.width = o.width;
    canvas.height = o.height;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, o.width, o.height);
    if (o.band) {
      c.fillStyle = o.band;
      c.fillRect(0, 0, o.width, Math.max(2, Math.round(o.height * 0.25)));
    }
    c.fillStyle = '#202020';
    c.font = `${Math.round(o.height / 8)}px sans-serif`;
    c.fillText('image page', 12, Math.round(o.height * 0.6));
    return canvas.toDataURL(`image/${o.type}`, 0.92);
  }, options);

  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/**
 * Splice an EXIF APP1 segment declaring an orientation into a JPEG.
 *
 * This is what a phone camera produces, and pdf-lib embeds JPEG bytes verbatim
 * without reading it — so without the canvas path the photo lands sideways.
 */
function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const exif = Buffer.from([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x49, 0x49, 0x2a, 0x00, // little-endian TIFF header
    0x08, 0x00, 0x00, 0x00, // offset of the first IFD
    0x01, 0x00, // one entry
    0x12, 0x01, // tag 0x0112, Orientation
    0x03, 0x00, // type SHORT
    0x01, 0x00, 0x00, 0x00, // count
    orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
  const length = exif.length + 2;
  const header = Buffer.from([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]);
  // After the SOI marker, before everything else.
  return Buffer.concat([jpeg.subarray(0, 2), header, exif, jpeg.subarray(2)]);
}

/** Sample the rendered page, in fractions of its size. */
async function samplePixels(page: Page, spots: Array<[number, number]>): Promise<string[]> {
  return page.evaluate((points) => {
    const image = document.querySelector<HTMLImageElement>('.page-card .thumb img');
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

const isRed = (sample: string) => {
  const [r, g, b] = sample.split(',').map(Number);
  return r > 180 && g < 120 && b < 120;
};

async function downloadPdf(page: Page): Promise<PDFDocument> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  return PDFDocument.load(await readDownload(download));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Drop PDFs or images here' })).toBeVisible();
});

test('a PNG becomes a page the same shape as the image', async ({ page }) => {
  const path = await save(await makeImage(page, { width: 400, height: 300, type: 'png' }), 'shot.png');
  await page.locator('input[type="file"]').setInputFiles(path);

  await expect(page.locator('.page-card')).toHaveCount(1);
  await expect(page.locator('.page-card .thumb img')).toBeVisible();
  await expect(page.locator('.status-bar')).toContainText('1 page');

  const result = await downloadPdf(page);
  expect(result.getPageCount()).toBe(1);
  const { width, height } = result.getPage(0).getSize();
  expect(width / height).toBeCloseTo(400 / 300, 2);
  // 400 CSS pixels at the 96 dpi fallback is 300 points.
  expect(width).toBeCloseTo(300, 0);
});

test('a JPEG becomes a page too', async ({ page }) => {
  const path = await save(await makeImage(page, { width: 600, height: 600, type: 'jpeg' }), 'photo.jpg');
  await page.locator('input[type="file"]').setInputFiles(path);

  await expect(page.locator('.page-card')).toHaveCount(1);
  const result = await downloadPdf(page);
  const { width, height } = result.getPage(0).getSize();
  expect(width).toBeCloseTo(height, 1);
});

test('an image sits alongside PDF pages and can be reordered', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    doc.addPage([300, 400]).drawText(`PDF ${i + 1}`, { x: 30, y: 200, size: 24, font, color: rgb(0, 0, 0) });
  }
  const pdfPath = await save(await doc.save(), 'doc.pdf');
  const imagePath = await save(
    await makeImage(page, { width: 500, height: 400, type: 'png' }),
    'extra.png',
  );

  await page.locator('input[type="file"]').setInputFiles(pdfPath);
  await expect(page.locator('.page-card')).toHaveCount(2);
  await page.locator('input[type="file"]').setInputFiles(imagePath);
  await expect(page.locator('.page-card')).toHaveCount(3);

  // The image is a page like any other: it carries its own filename and moves.
  await expect(page.locator('.page-source')).toHaveText(['doc.pdf', 'doc.pdf', 'extra.png']);
  // Dropping on a card's centre lands after it, so this tucks the image between
  // the two PDF pages.
  await page.dragAndDrop('.page-card:nth-child(3)', '.page-card:nth-child(1)');
  await expect(page.locator('.page-source')).toHaveText(['doc.pdf', 'extra.png', 'doc.pdf']);

  const result = await downloadPdf(page);
  expect(result.getPageCount()).toBe(3);
  // The image page really is sandwiched: it is the only one that is not 300pt.
  expect(Math.round(result.getPage(0).getWidth())).toBe(300);
  expect(Math.round(result.getPage(1).getWidth())).toBe(375);
  expect(Math.round(result.getPage(2).getWidth())).toBe(300);
});

test('a photo rotated by EXIF comes out upright', async ({ page }) => {
  // Stored landscape with a red band along the top, tagged "rotate 90° CW".
  // Displayed correctly that is a portrait page with red down the right edge.
  const landscape = await makeImage(page, {
    width: 800,
    height: 400,
    type: 'jpeg',
    band: '#e01010',
  });
  const path = await save(withExifOrientation(landscape, 6), 'phone.jpg');

  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('.page-card .thumb img')).toBeVisible();

  const [rightEdge, leftEdge] = await samplePixels(page, [
    [0.9, 0.5],
    [0.2, 0.5],
  ]);
  expect(isRed(rightEdge)).toBe(true);
  expect(isRed(leftEdge)).toBe(false);

  const result = await downloadPdf(page);
  const { width, height } = result.getPage(0).getSize();
  expect(height).toBeGreaterThan(width);
  expect(height / width).toBeCloseTo(2, 1);
});

test('a HEIC file explains itself instead of failing vaguely', async ({ page }) => {
  // The bytes Chrome cannot decode, and what an iPhone produces by default.
  const heic = Buffer.alloc(64);
  heic.write('ftypheic', 4, 'latin1');
  const path = await save(heic, 'IMG_0001.heic');

  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.getByRole('alert')).toContainText('HEIC');
  await expect(page.getByRole('alert')).toContainText('JPEG');
  await expect(page.locator('.page-card')).toHaveCount(0);
});
