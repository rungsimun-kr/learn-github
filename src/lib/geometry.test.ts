import { describe, expect, it } from 'vitest';
import type { Annotation } from './annotations';
import {
  boxPdfToView,
  boxViewToPdf,
  distanceToSegment,
  hitTest,
  moveAnnotation,
  pdfToView,
  textRotation,
  viewSize,
  viewToPdf,
  type PageGeometry,
} from './geometry';

/** A deliberately non-square page, so swapped axes cannot hide. */
const page = (rotation: number): PageGeometry => ({ width: 200, height: 400, rotation });
const ROTATIONS = [0, 90, 180, 270];

describe('viewSize', () => {
  it('reports the page as the viewer sees it', () => {
    expect(viewSize(page(0))).toEqual({ width: 200, height: 400 });
    expect(viewSize(page(180))).toEqual({ width: 200, height: 400 });
    expect(viewSize(page(90))).toEqual({ width: 400, height: 200 });
    expect(viewSize(page(270))).toEqual({ width: 400, height: 200 });
  });
});

describe('viewToPdf / pdfToView', () => {
  it('flips the y axis on an unrotated page', () => {
    // Top-left in view space is the top-left corner of the page in PDF space.
    expect(viewToPdf({ x: 0, y: 0 }, page(0))).toEqual({ x: 0, y: 400 });
    expect(viewToPdf({ x: 200, y: 400 }, page(0))).toEqual({ x: 200, y: 0 });
  });

  it.each(ROTATIONS)('sends the view origin to a page corner at %i°', (rotation) => {
    const corner = viewToPdf({ x: 0, y: 0 }, page(rotation));
    expect([0, 200]).toContain(corner.x);
    expect([0, 400]).toContain(corner.y);
  });

  it.each(ROTATIONS)('covers the whole page and nothing outside it at %i°', (rotation) => {
    const geometry = page(rotation);
    const { width, height } = viewSize(geometry);
    for (const corner of [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
      { x: width, y: height },
    ]) {
      const mapped = viewToPdf(corner, geometry);
      expect(mapped.x).toBeGreaterThanOrEqual(0);
      expect(mapped.x).toBeLessThanOrEqual(geometry.width);
      expect(mapped.y).toBeGreaterThanOrEqual(0);
      expect(mapped.y).toBeLessThanOrEqual(geometry.height);
    }
  });

  it.each(ROTATIONS)('round-trips every point at %i°', (rotation) => {
    const geometry = page(rotation);
    const { width, height } = viewSize(geometry);
    for (const point of [
      { x: 0, y: 0 },
      { x: 17, y: 3 },
      { x: width / 3, y: height / 7 },
      { x: width, y: height },
    ]) {
      const back = pdfToView(viewToPdf(point, geometry), geometry);
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it.each(ROTATIONS)('keeps neighbouring points neighbours at %i°', (rotation) => {
    const geometry = page(rotation);
    const a = viewToPdf({ x: 50, y: 60 }, geometry);
    const b = viewToPdf({ x: 53, y: 64 }, geometry);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(5, 9);
  });
});

describe('boxViewToPdf', () => {
  it('normalises a box dragged upwards and to the left', () => {
    expect(boxViewToPdf({ x: 80, y: 90 }, { x: 20, y: 30 }, page(0))).toEqual({
      x: 20,
      y: 310,
      width: 60,
      height: 60,
    });
  });

  it('swaps width and height on a quarter turn', () => {
    // A wide, short box in view space becomes tall and narrow on the page.
    const box = boxViewToPdf({ x: 10, y: 20 }, { x: 110, y: 50 }, page(90));
    expect(box.width).toBe(30);
    expect(box.height).toBe(100);
  });

  it.each(ROTATIONS)('round-trips a box at %i°', (rotation) => {
    const geometry = page(rotation);
    const stored = boxViewToPdf({ x: 12, y: 34 }, { x: 90, y: 100 }, geometry);
    expect(boxPdfToView(stored, geometry)).toEqual({ x: 12, y: 34, width: 78, height: 66 });
  });
});

describe('textRotation', () => {
  it.each(ROTATIONS)('cancels the page rotation at %i°', (rotation) => {
    expect(textRotation(page(rotation))).toBe(rotation);
  });

  it('normalises odd angles onto quarter turns', () => {
    expect(textRotation(page(-90))).toBe(270);
    expect(textRotation(page(450))).toBe(90);
  });
});

describe('distanceToSegment', () => {
  it('measures perpendicular distance inside the segment', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
  });

  it('clamps to the endpoints beyond the segment', () => {
    expect(distanceToSegment({ x: 14, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
  });

  it('handles a zero-length segment', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('hitTest', () => {
  const geometry = page(0);
  const rect: Annotation = {
    id: 'r',
    kind: 'rect',
    box: { x: 50, y: 300, width: 40, height: 40 },
    color: '#ffd60a',
    opacity: 0.4,
    filled: true,
    thickness: 2,
  };
  const line: Annotation = {
    id: 'l',
    kind: 'line',
    a: { x: 0, y: 400 },
    b: { x: 100, y: 400 },
    color: '#e5484d',
    opacity: 1,
    thickness: 2,
    arrowStart: false,
    arrowEnd: true,
  };

  it('finds a box under the pointer', () => {
    expect(hitTest(rect, { x: 60, y: 70 }, geometry)).toBe(true);
    expect(hitTest(rect, { x: 200, y: 70 }, geometry)).toBe(false);
  });

  it('gives thin lines a wider target than their stroke', () => {
    expect(hitTest(line, { x: 50, y: 4 }, geometry)).toBe(true);
    expect(hitTest(line, { x: 50, y: 40 }, geometry)).toBe(false);
  });
});

describe('moveAnnotation', () => {
  it('drags a box by a view-space delta', () => {
    const geometry = page(0);
    const rect: Annotation = {
      id: 'r',
      kind: 'rect',
      box: { x: 50, y: 300, width: 40, height: 40 },
      color: '#ffd60a',
      opacity: 0.4,
      filled: true,
      thickness: 2,
    };
    const moved = moveAnnotation(rect, { x: 10, y: 20 }, geometry);
    // Down in view space is down the page, so PDF y decreases.
    expect(moved.kind === 'rect' && moved.box).toEqual({
      x: 60,
      y: 280,
      width: 40,
      height: 40,
    });
  });

  it.each(ROTATIONS)('moves a line the same visual distance at %i°', (rotation) => {
    const geometry = page(rotation);
    const line: Annotation = {
      id: 'l',
      kind: 'line',
      a: { x: 20, y: 100 },
      b: { x: 60, y: 140 },
      color: '#e5484d',
      opacity: 1,
      thickness: 2,
      arrowStart: false,
      arrowEnd: false,
    };
    const moved = moveAnnotation(line, { x: 5, y: -7 }, geometry);
    if (moved.kind !== 'line') throw new Error('expected a line');

    const before = pdfToView(line.a, geometry);
    const after = pdfToView(moved.a, geometry);
    expect(after.x - before.x).toBeCloseTo(5, 9);
    expect(after.y - before.y).toBeCloseTo(-7, 9);
  });
});
