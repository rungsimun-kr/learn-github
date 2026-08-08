import { BlendMode, LineCapStyle, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { parseColor, type Annotation, type Point } from './annotations';
import {
  arrowHeadWings,
  boxPdfToView,
  textRotation,
  viewToPdf,
  type PageGeometry,
} from './geometry';

/**
 * The subset of `PDFPage` this module touches. Narrowing it keeps the drawing
 * logic testable against a recording stub instead of a whole document.
 */
export type DrawTarget = Pick<
  PDFPage,
  'drawRectangle' | 'drawEllipse' | 'drawLine' | 'drawSvgPath' | 'drawText'
>;

function toRgb(hex: string) {
  const { r, g, b } = parseColor(hex);
  return rgb(r, g, b);
}

/**
 * `drawSvgPath` wraps the path in a `1 0 0 -1 0 0 cm` flip, so a path
 * coordinate `(px, py)` lands at PDF `(x + px, y − py)`. Anchoring at the
 * origin and negating y therefore lets us write paths straight in PDF space.
 */
function pathThrough(points: readonly Point[], close: boolean): string {
  const steps = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${-point.y}`);
  return `${steps.join(' ')}${close ? ' Z' : ''}`;
}

function drawArrowHead(
  target: DrawTarget,
  tip: Point,
  from: Point,
  thickness: number,
  color: string,
): void {
  target.drawSvgPath(pathThrough([tip, ...arrowHeadWings(tip, from, thickness)], true), {
    x: 0,
    y: 0,
    color: toRgb(color),
    borderWidth: 0,
  });
}

/**
 * Flatten one annotation into the page's content stream.
 *
 * Everything arrives in PDF user space already, so the only transform left is
 * for text, which has to be turned to stay upright on a rotated page.
 */
export function drawAnnotation(
  target: DrawTarget,
  annotation: Annotation,
  geometry: PageGeometry,
  font: PDFFont | null,
): void {
  const color = toRgb(annotation.color);

  switch (annotation.kind) {
    case 'rect':
    case 'ellipse': {
      const { box, filled, thickness, opacity } = annotation;
      // A translucent fill multiplies, so it highlights rather than obscures;
      // at full opacity it blends normally and covers what is underneath.
      const shared = filled
        ? { color, opacity, blendMode: opacity < 1 ? BlendMode.Multiply : BlendMode.Normal }
        : { borderColor: color, borderWidth: thickness };

      if (annotation.kind === 'rect') {
        target.drawRectangle({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          ...shared,
        });
      } else {
        target.drawEllipse({
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          xScale: box.width / 2,
          yScale: box.height / 2,
          ...shared,
        });
      }
      return;
    }

    case 'line': {
      const { a, b, thickness, arrowStart, arrowEnd } = annotation;
      target.drawLine({
        start: a,
        end: b,
        thickness,
        color,
        lineCap: LineCapStyle.Round,
      });
      if (arrowEnd) drawArrowHead(target, b, a, thickness, annotation.color);
      if (arrowStart) drawArrowHead(target, a, b, thickness, annotation.color);
      return;
    }

    case 'ink': {
      if (annotation.points.length < 2) return;
      target.drawSvgPath(pathThrough(annotation.points, false), {
        x: 0,
        y: 0,
        borderColor: color,
        borderWidth: annotation.thickness,
        borderLineCap: LineCapStyle.Round,
      });
      return;
    }

    case 'text': {
      if (!font || annotation.text.trim() === '') return;
      const { box, fontSize } = annotation;

      // Place the first baseline one line below the box's top edge, working in
      // view space so "top" means what the user saw, then convert the anchor.
      const view = boxPdfToView(box, geometry);
      const anchor = viewToPdf({ x: view.x, y: view.y + fontSize }, geometry);

      target.drawText(annotation.text, {
        x: anchor.x,
        y: anchor.y,
        size: fontSize,
        font,
        color,
        lineHeight: fontSize * 1.35,
        maxWidth: view.width,
        rotate: degrees(textRotation(geometry)),
      });
      return;
    }
  }
}

/** Does any page in this set carry text, and therefore need a font embedded? */
export function needsFont(annotations: readonly Annotation[]): boolean {
  return annotations.some(
    (annotation) => annotation.kind === 'text' && annotation.text.trim() !== '',
  );
}
