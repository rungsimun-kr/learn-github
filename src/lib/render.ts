import type { ImageFormat, LoadedDoc } from '../types';

const THUMBNAIL_WIDTH = 240;
const MAX_CONCURRENT_RENDERS = 3;

let active = 0;
const waiting: Array<() => void> = [];

/**
 * Rendering a 300-page document would otherwise kick off 300 worker jobs at
 * once and lock the tab up; let a few through at a time.
 */
async function withRenderSlot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await job();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/**
 * Draw a page onto a fresh canvas.
 *
 * `rotation` is the editor's delta; pdf.js wants the absolute angle, so it is
 * added to the rotation already baked into the page.
 */
export async function renderPage(
  doc: LoadedDoc,
  pageIndex: number,
  options: { scale?: number; width?: number; rotation?: number; background?: string },
): Promise<HTMLCanvasElement> {
  const page = await doc.jsDoc.getPage(pageIndex + 1);
  const rotation = (((page.rotate + (options.rotation ?? 0)) % 360) + 360) % 360;

  const unscaled = page.getViewport({ scale: 1, rotation });
  const scale = options.width ? options.width / unscaled.width : (options.scale ?? 1);
  const viewport = page.getViewport({ scale, rotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  // pdf.js paints the page onto a transparent canvas unless told otherwise;
  // JPEG has no alpha channel, so those exports ask for a white backdrop.
  await page.render({ canvas, viewport, background: options.background }).promise;
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, format: ImageFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The page could not be converted to an image.'))),
      `image/${format}`,
      quality,
    );
  });
}

/** Render a page as a PNG or JPEG image. JPEG gets a white backdrop. */
export async function renderPageImage(
  doc: LoadedDoc,
  pageIndex: number,
  options: { rotation?: number; scale: number; format: ImageFormat; quality?: number },
): Promise<Blob> {
  return withRenderSlot(async () => {
    const canvas = await renderPage(doc, pageIndex, {
      scale: options.scale,
      rotation: options.rotation,
      background: options.format === 'jpeg' ? '#ffffff' : undefined,
    });
    return canvasToBlob(canvas, options.format, options.quality ?? 0.92);
  });
}

const thumbnails = new Map<string, Promise<string>>();

function thumbnailKey(docId: string, pageIndex: number): string {
  return `${docId}:${pageIndex}`;
}

/**
 * Object URL of a small preview of the page, rendered once and reused.
 *
 * Rotation is deliberately not part of the key — the UI rotates the image with
 * CSS, so turning a page never costs another render.
 */
export function getThumbnail(doc: LoadedDoc, pageIndex: number): Promise<string> {
  const key = thumbnailKey(doc.id, pageIndex);
  const cached = thumbnails.get(key);
  if (cached) return cached;

  const pending = withRenderSlot(async () => {
    const canvas = await renderPage(doc, pageIndex, {
      width: THUMBNAIL_WIDTH,
      background: '#ffffff',
    });
    const blob = await canvasToBlob(canvas, 'png', 1);
    return URL.createObjectURL(blob);
  }).catch((error: unknown) => {
    // Don't cache a failure — a later mount should be able to try again.
    thumbnails.delete(key);
    throw error;
  });

  thumbnails.set(key, pending);
  return pending;
}

/** Free the previews of a document the user has removed. */
export function releaseThumbnails(docId: string): void {
  const prefix = `${docId}:`;
  for (const [key, pending] of thumbnails) {
    if (!key.startsWith(prefix)) continue;
    thumbnails.delete(key);
    void pending.then(URL.revokeObjectURL, () => {});
  }
}
