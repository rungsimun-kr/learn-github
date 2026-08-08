import { uid } from './uid';

/** A point in PDF user space on the unrotated page: origin bottom-left, units of points. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned box in the same space, always with positive width and height. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Common {
  id: string;
  /** `#rrggbb`. */
  color: string;
  opacity: number;
}

export interface TextAnnotation extends Common {
  kind: 'text';
  box: Box;
  text: string;
  fontSize: number;
}

export interface ShapeAnnotation extends Common {
  kind: 'rect' | 'ellipse';
  box: Box;
  /** Filled shapes are drawn with a Multiply blend, so they read as a highlighter. */
  filled: boolean;
  thickness: number;
}

export interface LineAnnotation extends Common {
  kind: 'line';
  a: Point;
  b: Point;
  thickness: number;
  arrowStart: boolean;
  arrowEnd: boolean;
}

export interface InkAnnotation extends Common {
  kind: 'ink';
  points: Point[];
  thickness: number;
}

export type Annotation = TextAnnotation | ShapeAnnotation | LineAnnotation | InkAnnotation;

/** Tools the page editor offers. `select` draws nothing; it moves what is there. */
export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'ink';

/** The style controls, shared by every tool and remembered between drawings. */
export interface AnnotationStyle {
  color: string;
  opacity: number;
  thickness: number;
  fontSize: number;
  filled: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
}

export const PALETTE = [
  { value: '#ffd60a', label: 'Yellow' },
  { value: '#34c759', label: 'Green' },
  { value: '#2f6feb', label: 'Blue' },
  { value: '#e5484d', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#111827', label: 'Black' },
  { value: '#ffffff', label: 'White' },
] as const;

export const DEFAULT_STYLE: AnnotationStyle = {
  color: '#ffd60a',
  opacity: 0.4,
  thickness: 2,
  fontSize: 14,
  filled: true,
  arrowStart: false,
  arrowEnd: true,
};

/** Shapes carry a fill; lines, ink and text are drawn at full strength by default. */
export function styleForTool(style: AnnotationStyle, tool: Tool): AnnotationStyle {
  if (tool === 'rect' || tool === 'ellipse') return style;
  return { ...style, opacity: 1 };
}

export function createShape(
  kind: 'rect' | 'ellipse',
  box: Box,
  style: AnnotationStyle,
): ShapeAnnotation {
  return {
    id: uid('an'),
    kind,
    box,
    color: style.color,
    opacity: style.filled ? style.opacity : 1,
    filled: style.filled,
    thickness: style.thickness,
  };
}

export function createLine(
  a: Point,
  b: Point,
  style: AnnotationStyle,
  arrows: { start: boolean; end: boolean },
): LineAnnotation {
  return {
    id: uid('an'),
    kind: 'line',
    a,
    b,
    color: style.color,
    opacity: 1,
    thickness: style.thickness,
    arrowStart: arrows.start,
    arrowEnd: arrows.end,
  };
}

export function createInk(points: Point[], style: AnnotationStyle): InkAnnotation {
  return {
    id: uid('an'),
    kind: 'ink',
    points,
    color: style.color,
    opacity: 1,
    thickness: style.thickness,
  };
}

export function createText(box: Box, style: AnnotationStyle): TextAnnotation {
  return {
    id: uid('an'),
    kind: 'text',
    box,
    text: '',
    color: style.color === '#ffd60a' ? '#e5484d' : style.color,
    opacity: 1,
    fontSize: style.fontSize,
  };
}

/** Does this annotation have a resizable box, as opposed to draggable endpoints? */
export function hasBox(annotation: Annotation): annotation is TextAnnotation | ShapeAnnotation {
  return annotation.kind === 'text' || annotation.kind === 'rect' || annotation.kind === 'ellipse';
}

/** `#rrggbb` to the 0-1 channel triple pdf-lib wants. */
export function parseColor(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}
