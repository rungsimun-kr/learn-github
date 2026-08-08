import type { Annotation, Box, Point } from './annotations';

/**
 * A page's unrotated size plus the rotation the viewer sees it through.
 *
 * `width`/`height` are always the MediaBox dimensions, never the rotated ones —
 * that is the space pdf-lib draws in and the space annotations are stored in.
 */
export interface PageGeometry {
  width: number;
  height: number;
  /** Total clockwise rotation: the page's own plus the editor's delta. */
  rotation: number;
}

function normaliseRotation(rotation: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(rotation / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** The page's size as the viewer sees it — swapped on a quarter turn. */
export function viewSize(geometry: PageGeometry): { width: number; height: number } {
  const rotation = normaliseRotation(geometry.rotation);
  return rotation === 90 || rotation === 270
    ? { width: geometry.height, height: geometry.width }
    : { width: geometry.width, height: geometry.height };
}

/**
 * View space → PDF space.
 *
 * View space is what the user points at: top-left origin, y downwards, measured
 * in points across the *rotated* page. PDF space is bottom-left origin, y up,
 * on the unrotated page. /Rotate turns the page clockwise for display, and
 * these four cases are that transform inverted.
 */
export function viewToPdf(point: Point, geometry: PageGeometry): Point {
  const { width: w, height: h } = geometry;
  switch (normaliseRotation(geometry.rotation)) {
    case 90:
      return { x: point.y, y: point.x };
    case 180:
      return { x: w - point.x, y: point.y };
    case 270:
      return { x: w - point.y, y: h - point.x };
    default:
      return { x: point.x, y: h - point.y };
  }
}

/** PDF space → view space. The exact inverse of `viewToPdf`. */
export function pdfToView(point: Point, geometry: PageGeometry): Point {
  const { width: w, height: h } = geometry;
  switch (normaliseRotation(geometry.rotation)) {
    case 90:
      return { x: point.y, y: point.x };
    case 180:
      return { x: w - point.x, y: point.y };
    case 270:
      return { x: h - point.y, y: w - point.x };
    default:
      return { x: point.x, y: h - point.y };
  }
}

/**
 * Two dragged corners in view space → a stored box.
 *
 * The corners have to be mapped individually and the result normalised: a
 * quarter turn swaps the axes, so width and height cannot be carried across.
 */
export function boxViewToPdf(from: Point, to: Point, geometry: PageGeometry): Box {
  const a = viewToPdf(from, geometry);
  const b = viewToPdf(to, geometry);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** A stored box as the viewer sees it: top-left origin, ready for SVG. */
export function boxPdfToView(box: Box, geometry: PageGeometry): Box {
  const a = pdfToView({ x: box.x, y: box.y }, geometry);
  const b = pdfToView({ x: box.x + box.width, y: box.y + box.height }, geometry);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * How far text has to be turned in PDF space to read upright on the rotated
 * page. It matches the page rotation: a page shown turned 90° clockwise needs
 * its text turned 90° counter-clockwise in PDF space to cancel out.
 */
export function textRotation(geometry: PageGeometry): number {
  return normaliseRotation(geometry.rotation);
}

/** Half the angle at an arrow's tip, and the shortest head we will draw. */
export const ARROW_SPREAD = 0.42;
export const ARROW_MIN_LENGTH = 8;

/**
 * The two back corners of an arrowhead at `tip`, for a line arriving from
 * `from`. The maths is relative, so this serves the SVG preview in view space
 * and the PDF output in page space without either needing its own copy.
 */
export function arrowHeadWings(tip: Point, from: Point, thickness: number): [Point, Point] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const length = Math.max(ARROW_MIN_LENGTH, thickness * 3.5);
  const wing = (offset: number): Point => ({
    x: tip.x - length * Math.cos(angle + offset),
    y: tip.y - length * Math.sin(angle + offset),
  });
  return [wing(-ARROW_SPREAD), wing(ARROW_SPREAD)];
}

/** Shortest distance from a point to a line segment, in whichever space both share. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Is a view-space point on this annotation? `slack` widens thin targets. */
export function hitTest(
  annotation: Annotation,
  point: Point,
  geometry: PageGeometry,
  slack = 6,
): boolean {
  if (annotation.kind === 'line') {
    const a = pdfToView(annotation.a, geometry);
    const b = pdfToView(annotation.b, geometry);
    return distanceToSegment(point, a, b) <= Math.max(slack, annotation.thickness);
  }

  if (annotation.kind === 'ink') {
    const points = annotation.points.map((p) => pdfToView(p, geometry));
    const reach = Math.max(slack, annotation.thickness);
    return points.some(
      (current, index) =>
        index > 0 && distanceToSegment(point, points[index - 1], current) <= reach,
    );
  }

  const box = boxPdfToView(annotation.box, geometry);
  return (
    point.x >= box.x - slack &&
    point.x <= box.x + box.width + slack &&
    point.y >= box.y - slack &&
    point.y <= box.y + box.height + slack
  );
}

/** Shift an annotation by a view-space delta, keeping it stored in PDF space. */
export function moveAnnotation(
  annotation: Annotation,
  delta: Point,
  geometry: PageGeometry,
): Annotation {
  const shift = (p: Point): Point => {
    const view = pdfToView(p, geometry);
    return viewToPdf({ x: view.x + delta.x, y: view.y + delta.y }, geometry);
  };

  if (annotation.kind === 'line') {
    return { ...annotation, a: shift(annotation.a), b: shift(annotation.b) };
  }
  if (annotation.kind === 'ink') {
    return { ...annotation, points: annotation.points.map(shift) };
  }

  const view = boxPdfToView(annotation.box, geometry);
  return {
    ...annotation,
    box: boxViewToPdf(
      { x: view.x + delta.x, y: view.y + delta.y },
      { x: view.x + view.width + delta.x, y: view.y + view.height + delta.y },
      geometry,
    ),
  };
}
