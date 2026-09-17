import { PDFDocument } from 'pdf-lib';

/** Image formats we can turn into a page. */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'avif' | 'heic';

/** Formats the browser can decode for us. HEIC is recognised only to explain itself. */
const DECODABLE: ReadonlySet<ImageFormat> = new Set(['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif']);

/** CSS pixels are 1/96 inch; used when an image declares no resolution of its own. */
const FALLBACK_DPI = 96;
const POINTS_PER_INCH = 72;

/** A2. Past this a photo would make a page nobody wants; the aspect stays exact. */
const MAX_PAGE_POINTS = 1684;

/** Re-encoding beyond this is pointless and the page would be enormous. */
const MAX_PIXELS = 40_000_000;

const JPEG_QUALITY = 0.92;

/**
 * Identify a file by its leading bytes.
 *
 * Extensions lie — a `.png` that is really a JPEG would make `embedPng` throw —
 * so the signature is the only thing worth trusting.
 */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (starts(0x42, 0x4d)) return 'bmp';

  // RIFF....WEBP
  if (starts(0x52, 0x49, 0x46, 0x46) && ascii(bytes, 8, 4) === 'WEBP') return 'webp';

  // ISO base media: ....ftyp<brand>
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'avif';
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'heic';
  }

  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** A failure with a message that is safe to show the user as-is. */
export class ImageLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageLoadError';
  }
}

/**
 * The orientation a JPEG's EXIF block asks for, or 1 when it says nothing.
 *
 * pdf-lib embeds JPEG bytes verbatim and ignores EXIF, so a photo taken in
 * portrait on a phone would come out on its side. Anything other than 1 has to
 * go through the canvas, which bakes the rotation into the pixels.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // skip SOI

  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    // Start of scan: pixel data begins, no more metadata worth reading.
    if (marker === 0xda) break;

    const length = view.getUint16(offset + 2);
    if (length < 2) break;

    if (marker === 0xe1 && ascii(bytes, offset + 4, 4) === 'Exif') {
      const found = readExifOrientation(view, offset + 10, offset + 2 + length);
      if (found !== null) return found;
    }
    offset += 2 + length;
  }
  return 1;
}

/** Walk the TIFF header inside an EXIF APP1 segment for tag 0x0112. */
function readExifOrientation(view: DataView, tiffStart: number, end: number): number | null {
  if (tiffStart + 8 > end || tiffStart + 8 > view.byteLength) return null;

  const marker = view.getUint16(tiffStart);
  if (marker !== 0x4949 && marker !== 0x4d4d) return null;
  const little = marker === 0x4949;

  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return null;
  const ifdOffset = view.getUint32(tiffStart + 4, little);

  const ifd = tiffStart + ifdOffset;
  if (ifd + 2 > end || ifd + 2 > view.byteLength) return null;

  const entries = view.getUint16(ifd, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end || entry + 12 > view.byteLength) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * The resolution an image declares, in dots per inch, or null when it says
 * nothing. Lets a 300-dpi A4 scan import as an actual A4 page.
 */
export function readImageDpi(bytes: Uint8Array, format: ImageFormat): number | null {
  if (format === 'jpeg') return readJfifDpi(bytes);
  if (format === 'png') return readPngDpi(bytes);
  return null;
}

function readJfifDpi(bytes: Uint8Array): number | null {
  // APP0: FFE0, length, "JFIF\0", version(2), units(1), xDensity(2), yDensity(2)
  if (!(bytes[2] === 0xff && bytes[3] === 0xe0)) return null;
  if (ascii(bytes, 6, 4) !== 'JFIF') return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 18) return null;

  const units = view.getUint8(13);
  const density = view.getUint16(14);
  if (density === 0) return null;

  if (units === 1) return density; // per inch
  if (units === 2) return density * 2.54; // per centimetre
  return null; // units 0 means "aspect ratio only", which tells us no size
}

function readPngDpi(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8; // past the signature

  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === 'pHYs') {
      if (offset + 8 + 9 > view.byteLength) return null;
      const perUnitX = view.getUint32(offset + 8);
      const unit = view.getUint8(offset + 16);
      // unit 1 is metres; anything else is an unspecified aspect ratio.
      return unit === 1 && perUnitX > 0 ? (perUnitX * 0.0254) : null;
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    offset += 12 + length;
  }
  return null;
}

/**
 * Page size in points for an image of this pixel size at this resolution.
 *
 * The aspect ratio is always exact; only the physical size is clamped, so a
 * huge photo cannot produce a page a metre across.
 */
export function pageSizeFor(
  widthPx: number,
  heightPx: number,
  dpi: number | null,
): { width: number; height: number } {
  const resolution = dpi && dpi > 0 ? dpi : FALLBACK_DPI;
  let width = (widthPx / resolution) * POINTS_PER_INCH;
  let height = (heightPx / resolution) * POINTS_PER_INCH;

  const longest = Math.max(width, height);
  if (longest > MAX_PAGE_POINTS) {
    const shrink = MAX_PAGE_POINTS / longest;
    width *= shrink;
    height *= shrink;
  }

  // A zero-size page is invalid; never round below a single point.
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

interface Encoded {
  bytes: Uint8Array;
  kind: 'jpeg' | 'png';
  width: number;
  height: number;
  dpi: number | null;
}

/**
 * Decode through the browser and re-encode.
 *
 * Used for formats pdf-lib cannot embed directly, and for JPEGs whose EXIF asks
 * for a rotation — `imageOrientation: 'from-image'` bakes that in.
 */
async function viaCanvas(file: File, format: ImageFormat): Promise<Encoded> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new ImageLoadError(
      `"${file.name}" could not be decoded by this browser. (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }

  try {
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new ImageLoadError('This browser could not provide a canvas to draw on.');
    context.drawImage(bitmap, 0, 0, width, height);

    // Formats that can carry transparency keep it; photographs become JPEG so
    // they do not balloon into a lossless re-encode.
    const keepAlpha = format === 'png' || format === 'webp' || format === 'gif' || format === 'avif';
    const kind = keepAlpha ? 'png' : 'jpeg';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, `image/${kind}`, JPEG_QUALITY),
    );
    if (!blob) throw new ImageLoadError(`"${file.name}" could not be converted.`);

    // Re-encoding drops the original resolution tag, and scaling would
    // invalidate it anyway.
    return { bytes: new Uint8Array(await blob.arrayBuffer()), kind, width, height, dpi: null };
  } finally {
    bitmap.close();
  }
}

/** Is this something we should try to turn into a page? */
export function looksLikeImage(file: File, bytes: Uint8Array): boolean {
  return sniffImageFormat(bytes) !== null || file.type.startsWith('image/');
}

/**
 * Turn an image into a single-page PDF, sized to the image.
 *
 * Once this has run the result is an ordinary PDF, so every other feature —
 * merging, rotating, annotating, OCR, export — works on it unchanged.
 */
export async function imageToPdfBytes(file: File, bytes: Uint8Array): Promise<Uint8Array> {
  const format = sniffImageFormat(bytes);

  if (format === 'heic') {
    throw new ImageLoadError(
      `"${file.name}" is a HEIC image, which this browser cannot open. Export or share it as JPEG first.`,
    );
  }
  if (format === null || !DECODABLE.has(format)) {
    throw new ImageLoadError(
      `"${file.name}" is not a PDF or a supported image (JPEG, PNG, WebP, GIF, BMP, AVIF).`,
    );
  }

  const encoded = await prepare(file, format, bytes);
  const doc = await PDFDocument.create();
  const image =
    encoded.kind === 'jpeg' ? await doc.embedJpg(encoded.bytes) : await doc.embedPng(encoded.bytes);

  const size = pageSizeFor(encoded.width, encoded.height, encoded.dpi);
  const page = doc.addPage([size.width, size.height]);
  page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });

  return doc.save();
}

async function prepare(file: File, format: ImageFormat, bytes: Uint8Array): Promise<Encoded> {
  // JPEG and PNG can be embedded byte for byte — no re-encode, no quality lost,
  // and the PDF stays about the size of the original file.
  if (format === 'jpeg' && readJpegOrientation(bytes) === 1) {
    const doc = await PDFDocument.create();
    const probe = await doc.embedJpg(bytes);
    return {
      bytes,
      kind: 'jpeg',
      width: probe.width,
      height: probe.height,
      dpi: readImageDpi(bytes, format),
    };
  }

  if (format === 'png') {
    const doc = await PDFDocument.create();
    const probe = await doc.embedPng(bytes);
    return {
      bytes,
      kind: 'png',
      width: probe.width,
      height: probe.height,
      dpi: readImageDpi(bytes, format),
    };
  }

  return viaCanvas(file, format);
}
