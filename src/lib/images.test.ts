import { describe, expect, it } from 'vitest';
import { pageSizeFor, readImageDpi, readJpegOrientation, sniffImageFormat } from './images';

const bytes = (...values: number[]) => new Uint8Array(values);

/** Pad a signature out so length checks have something to read. */
const padded = (...values: number[]) => {
  const out = new Uint8Array(64);
  out.set(values);
  return out;
};

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

describe('sniffImageFormat', () => {
  // Extensions lie; only the leading bytes are worth trusting, because a
  // mislabelled file would make the wrong pdf-lib embedder throw.
  it('recognises JPEG', () => {
    expect(sniffImageFormat(padded(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
  });

  it('recognises PNG', () => {
    expect(sniffImageFormat(padded(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
  });

  it('recognises GIF', () => {
    expect(sniffImageFormat(padded(...ascii('GIF89a')))).toBe('gif');
  });

  it('recognises BMP', () => {
    expect(sniffImageFormat(padded(...ascii('BM')))).toBe('bmp');
  });

  it('recognises WebP by its RIFF container', () => {
    expect(sniffImageFormat(padded(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe('webp');
  });

  it('does not mistake another RIFF file for WebP', () => {
    expect(sniffImageFormat(padded(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBeNull();
  });

  it('recognises AVIF and HEIC by their ftyp brand', () => {
    expect(sniffImageFormat(padded(0, 0, 0, 0, ...ascii('ftypavif')))).toBe('avif');
    expect(sniffImageFormat(padded(0, 0, 0, 0, ...ascii('ftypheic')))).toBe('heic');
    expect(sniffImageFormat(padded(0, 0, 0, 0, ...ascii('ftypmif1')))).toBe('heic');
  });

  it('returns null for a PDF, so the PDF path keeps it', () => {
    expect(sniffImageFormat(padded(...ascii('%PDF-1.7')))).toBeNull();
  });

  it('returns null for rubbish and for a file too short to identify', () => {
    expect(sniffImageFormat(padded(...ascii('hello world')))).toBeNull();
    expect(sniffImageFormat(bytes(0xff))).toBeNull();
    expect(sniffImageFormat(bytes())).toBeNull();
  });
});

describe('readJpegOrientation', () => {
  /** A JPEG carrying one EXIF IFD entry for the orientation tag. */
  function jpegWithOrientation(value: number, little = true): Uint8Array {
    const exif = [
      ...ascii('Exif'),
      0,
      0,
      ...(little ? ascii('II') : ascii('MM')),
      ...(little ? [0x2a, 0x00] : [0x00, 0x2a]),
      ...(little ? [8, 0, 0, 0] : [0, 0, 0, 8]),
      ...(little ? [1, 0] : [0, 1]), // one entry
      ...(little ? [0x12, 0x01] : [0x01, 0x12]), // tag 0x0112
      ...(little ? [3, 0] : [0, 3]), // type SHORT
      ...(little ? [1, 0, 0, 0] : [0, 0, 0, 1]), // count
      ...(little ? [value, 0, 0, 0] : [0, value, 0, 0]),
    ];
    const length = exif.length + 2;
    return new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, (length >> 8) & 0xff, length & 0xff,
      ...exif,
      0xff, 0xda, 0x00, 0x02,
    ]);
  }

  it('reads an orientation stored little-endian', () => {
    expect(readJpegOrientation(jpegWithOrientation(6))).toBe(6);
  });

  it('reads an orientation stored big-endian', () => {
    expect(readJpegOrientation(jpegWithOrientation(8, false))).toBe(8);
  });

  it('defaults to upright when there is no EXIF at all', () => {
    // A bare JFIF file: pdf-lib can embed these as-is.
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
  });

  it('defaults to upright rather than throwing on a truncated file', () => {
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00]))).toBe(1);
  });
});

describe('readImageDpi', () => {
  /** APP0 JFIF header with the given density units and value. */
  function jfif(units: number, density: number): Uint8Array {
    return new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10,
      ...ascii('JFIF'), 0x00,
      1, 2,
      units,
      (density >> 8) & 0xff, density & 0xff,
      (density >> 8) & 0xff, density & 0xff,
      0, 0,
    ]);
  }

  it('reads dots per inch straight out of a JFIF header', () => {
    expect(readImageDpi(jfif(1, 300), 'jpeg')).toBe(300);
  });

  it('converts a per-centimetre density', () => {
    expect(readImageDpi(jfif(2, 118), 'jpeg')).toBeCloseTo(299.72, 1);
  });

  it('ignores a density that only expresses an aspect ratio', () => {
    expect(readImageDpi(jfif(0, 1), 'jpeg')).toBeNull();
  });

  /** A PNG with a pHYs chunk declaring pixels per metre. */
  function png(perMetre: number | null): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (perMetre === null) {
      return new Uint8Array([...signature, 0, 0, 0, 0, ...ascii('IDAT'), 0, 0, 0, 0]);
    }
    const value = [
      (perMetre >>> 24) & 0xff,
      (perMetre >>> 16) & 0xff,
      (perMetre >>> 8) & 0xff,
      perMetre & 0xff,
    ];
    return new Uint8Array([
      ...signature,
      0, 0, 0, 9, ...ascii('pHYs'),
      ...value, ...value, 1,
      0, 0, 0, 0,
    ]);
  }

  it('reads a PNG pHYs chunk as dots per inch', () => {
    // 11811 pixels per metre is the usual way of storing 300 dpi.
    expect(readImageDpi(png(11811), 'png')).toBeCloseTo(300, 0);
  });

  it('returns null when a PNG declares no resolution', () => {
    expect(readImageDpi(png(null), 'png')).toBeNull();
  });

  it('has nothing to read for formats that do not carry it', () => {
    expect(readImageDpi(png(11811), 'webp')).toBeNull();
  });
});

describe('pageSizeFor', () => {
  it('falls back to 96 dpi, so a screenshot is its on-screen size', () => {
    // 960 CSS pixels wide is 10 inches, which is 720 points.
    expect(pageSizeFor(960, 480, null)).toEqual({ width: 720, height: 360 });
  });

  it('honours the image\'s own resolution, so a 300 dpi A4 scan stays A4', () => {
    const size = pageSizeFor(2480, 3508, 300);
    expect(size.width).toBeCloseTo(595, 0);
    expect(size.height).toBeCloseTo(842, 0);
  });

  it('clamps a huge photo without distorting it', () => {
    const size = pageSizeFor(8000, 6000, 72);
    expect(Math.max(size.width, size.height)).toBeCloseTo(1684, 0);
    // The aspect ratio survives the clamp exactly.
    expect(size.width / size.height).toBeCloseTo(8000 / 6000, 6);
  });

  it('leaves a page that is already small enough alone', () => {
    expect(pageSizeFor(600, 400, 72)).toEqual({ width: 600, height: 400 });
  });

  it('keeps a portrait image portrait', () => {
    const size = pageSizeFor(1000, 3000, 96);
    expect(size.height).toBeGreaterThan(size.width);
  });

  it('never produces a zero-sized page', () => {
    const size = pageSizeFor(1, 1, 5000);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it('treats a nonsense resolution as missing', () => {
    expect(pageSizeFor(960, 480, 0)).toEqual(pageSizeFor(960, 480, null));
    expect(pageSizeFor(960, 480, -300)).toEqual(pageSizeFor(960, 480, null));
  });
});
