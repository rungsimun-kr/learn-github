import { BlendMode, LineCapStyle, type PDFFont } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Annotation, Point } from './annotations';
import { drawAnnotation, needsFont, type DrawTarget } from './drawAnnotations';
import type { PageGeometry } from './geometry';

interface Call {
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any;
  path?: string;
}

/** A stand-in for `PDFPage` that records what would have been drawn. */
function recorder() {
  const calls: Call[] = [];
  const target = {
    drawRectangle: (options: unknown) => calls.push({ method: 'drawRectangle', options }),
    drawEllipse: (options: unknown) => calls.push({ method: 'drawEllipse', options }),
    drawLine: (options: unknown) => calls.push({ method: 'drawLine', options }),
    drawText: (text: string, options: unknown) =>
      calls.push({ method: 'drawText', options: { ...(options as object), text } }),
    drawSvgPath: (path: string, options: unknown) =>
      calls.push({ method: 'drawSvgPath', options, path }),
  } as unknown as DrawTarget;

  return {
    target,
    calls,
    only(method: string) {
      const matched = calls.filter((call) => call.method === method);
      expect(matched).toHaveLength(1);
      return matched[0];
    },
  };
}

/**
 * Undo the vertical flip `drawSvgPath` applies, recovering the PDF-space points
 * the path was built from.
 */
function pathPoints(path: string): Point[] {
  const numbers = path.match(/-?[\d.]+/g)?.map(Number) ?? [];
  const points: Point[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    // `|| 0` keeps negating a zero from producing -0, which breaks toEqual.
    points.push({ x: numbers[i], y: -numbers[i + 1] || 0 });
  }
  return points;
}

const upright: PageGeometry = { width: 200, height: 400, rotation: 0 };

const base = { id: 'a', color: '#ff0000', opacity: 1 } as const;

describe('rectangles and ellipses', () => {
  const box = { x: 10, y: 20, width: 60, height: 40 };

  it('multiplies a translucent fill so it highlights rather than covers', () => {
    const { target, only } = recorder();
    drawAnnotation(
      target,
      { ...base, kind: 'rect', box, opacity: 0.4, filled: true, thickness: 2 },
      upright,
      null,
    );

    const { options } = only('drawRectangle');
    expect(options).toMatchObject({ x: 10, y: 20, width: 60, height: 40, opacity: 0.4 });
    expect(options.blendMode).toBe(BlendMode.Multiply);
    expect(options.borderWidth).toBeUndefined();
  });

  it('blends an opaque fill normally, so it can cover what is underneath', () => {
    const { target, only } = recorder();
    drawAnnotation(
      target,
      { ...base, kind: 'rect', box, opacity: 1, filled: true, thickness: 2 },
      upright,
      null,
    );
    expect(only('drawRectangle').options.blendMode).toBe(BlendMode.Normal);
  });

  it('strokes an outline shape instead of filling it', () => {
    const { target, only } = recorder();
    drawAnnotation(
      target,
      { ...base, kind: 'rect', box, opacity: 1, filled: false, thickness: 3 },
      upright,
      null,
    );

    const { options } = only('drawRectangle');
    expect(options.borderWidth).toBe(3);
    expect(options.borderColor).toBeDefined();
    expect(options.color).toBeUndefined();
  });

  it('converts an ellipse box into a centre and radii', () => {
    const { target, only } = recorder();
    drawAnnotation(
      target,
      { ...base, kind: 'ellipse', box, opacity: 1, filled: true, thickness: 2 },
      upright,
      null,
    );
    expect(only('drawEllipse').options).toMatchObject({ x: 40, y: 40, xScale: 30, yScale: 20 });
  });
});

describe('lines and arrowheads', () => {
  const line = (arrows: { start: boolean; end: boolean }): Annotation => ({
    ...base,
    kind: 'line',
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
    thickness: 2,
    arrowStart: arrows.start,
    arrowEnd: arrows.end,
  });

  it('draws a bare line with no arrowheads', () => {
    const { target, calls, only } = recorder();
    drawAnnotation(target, line({ start: false, end: false }), upright, null);

    expect(only('drawLine').options).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      thickness: 2,
      lineCap: LineCapStyle.Round,
    });
    expect(calls.filter((call) => call.method === 'drawSvgPath')).toHaveLength(0);
  });

  it('puts a filled head at the end, pointing the way the line goes', () => {
    const { target, only } = recorder();
    drawAnnotation(target, line({ start: false, end: true }), upright, null);

    const [tip, left, right] = pathPoints(only('drawSvgPath').path!);
    expect(tip).toEqual({ x: 100, y: 0 });
    // Both wings sit behind the tip and are symmetric about the line's axis.
    expect(left.x).toBeLessThan(tip.x);
    expect(right.x).toBeCloseTo(left.x, 9);
    expect(left.y).toBeCloseTo(-right.y, 9);
    expect(left.y).not.toBeCloseTo(0, 3);
  });

  it('draws two heads for a double-headed arrow', () => {
    const { target, calls } = recorder();
    drawAnnotation(target, line({ start: true, end: true }), upright, null);

    const heads = calls.filter((call) => call.method === 'drawSvgPath');
    expect(heads).toHaveLength(2);
    expect(pathPoints(heads[0].path!)[0]).toEqual({ x: 100, y: 0 });
    expect(pathPoints(heads[1].path!)[0]).toEqual({ x: 0, y: 0 });
  });

  it('scales the head with the line thickness', () => {
    const measure = (thickness: number) => {
      const { target, only } = recorder();
      drawAnnotation(
        target,
        { ...line({ start: false, end: true }), thickness } as Annotation,
        upright,
        null,
      );
      const [tip, wing] = pathPoints(only('drawSvgPath').path!);
      return Math.hypot(tip.x - wing.x, tip.y - wing.y);
    };
    expect(measure(8)).toBeGreaterThan(measure(2));
  });
});

describe('freehand ink', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 20 },
    { x: 30, y: 5 },
  ];

  it('strokes one polyline through every point', () => {
    const { target, only } = recorder();
    drawAnnotation(target, { ...base, kind: 'ink', points, thickness: 4 }, upright, null);

    const call = only('drawSvgPath');
    expect(pathPoints(call.path!)).toEqual(points);
    expect(call.path).not.toContain('Z');
    expect(call.options).toMatchObject({
      borderWidth: 4,
      borderLineCap: LineCapStyle.Round,
    });
    expect(call.options.color).toBeUndefined();
  });

  it('ignores a stroke that never went anywhere', () => {
    const { target, calls } = recorder();
    drawAnnotation(
      target,
      { ...base, kind: 'ink', points: [{ x: 1, y: 1 }], thickness: 4 },
      upright,
      null,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('text', () => {
  const font = {} as PDFFont;
  const text = (box = { x: 20, y: 300, width: 100, height: 50 }): Annotation => ({
    ...base,
    kind: 'text',
    box,
    text: 'สวัสดี hello',
    fontSize: 10,
  });

  it('anchors the first baseline one line below the top of the box', () => {
    const { target, only } = recorder();
    drawAnnotation(target, text(), upright, font);

    const { options } = only('drawText');
    // The box's top edge is at PDF y=350, so the baseline sits at 340.
    expect(options).toMatchObject({ x: 20, y: 340, size: 10, maxWidth: 100 });
    expect(options.text).toBe('สวัสดี hello');
  });

  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
  ])('turns text by %i° so it reads upright', (rotation, expected) => {
    const { target, only } = recorder();
    drawAnnotation(target, text(), { ...upright, rotation }, font);
    expect(only('drawText').options.rotate.angle).toBe(expected);
  });

  it('anchors to the visual top-left on a rotated page', () => {
    // On a page turned 90°, the view's top-left corner is the page's origin.
    const { target, only } = recorder();
    drawAnnotation(
      target,
      text({ x: 0, y: 0, width: 50, height: 100 }),
      { ...upright, rotation: 90 },
      font,
    );
    const { options } = only('drawText');
    expect(options.x).toBe(10);
    expect(options.y).toBe(0);
  });

  it('draws nothing without a font, rather than throwing at export time', () => {
    const { target, calls } = recorder();
    drawAnnotation(target, text(), upright, null);
    expect(calls).toHaveLength(0);
  });

  it('skips an empty box the user never typed into', () => {
    const { target, calls } = recorder();
    drawAnnotation(target, { ...text(), text: '   ' } as Annotation, upright, font);
    expect(calls).toHaveLength(0);
  });
});

describe('needsFont', () => {
  const shape: Annotation = {
    ...base,
    kind: 'rect',
    box: { x: 0, y: 0, width: 1, height: 1 },
    filled: true,
    thickness: 1,
  };
  const written: Annotation = {
    ...base,
    kind: 'text',
    box: { x: 0, y: 0, width: 1, height: 1 },
    text: 'hi',
    fontSize: 10,
  };

  it('is false when nothing was typed', () => {
    expect(needsFont([shape])).toBe(false);
    expect(needsFont([{ ...written, text: '' }])).toBe(false);
  });

  it('is true as soon as one text box has content', () => {
    expect(needsFont([shape, written])).toBe(true);
  });
});
