import type { Annotation } from '../lib/annotations';
import { arrowHeadWings, boxPdfToView, pdfToView, viewSize, type PageGeometry } from '../lib/geometry';

interface AnnotationLayerProps {
  annotations: readonly Annotation[];
  geometry: PageGeometry;
  /** Drawn in progress but not yet committed. */
  draft?: Annotation | null;
  selectedId?: string | null;
  /** Hidden while its textarea is open, so the two do not double up. */
  hideTextId?: string | null;
}

const points = (list: { x: number; y: number }[]) =>
  list.map((point) => `${point.x},${point.y}`).join(' ');

/**
 * Renders annotations over a page.
 *
 * The SVG's viewBox is the page in view-space points, so stored coordinates map
 * onto it after nothing more than `pdfToView` — no scaling per shape, and the
 * same component serves the full-size editor and the grid thumbnails.
 */
export default function AnnotationLayer({
  annotations,
  geometry,
  draft,
  selectedId,
  hideTextId,
}: AnnotationLayerProps) {
  const size = viewSize(geometry);
  const all = draft ? [...annotations, draft] : annotations;

  return (
    <svg
      className="annotation-layer"
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {all.map((annotation) => {
        const selected = annotation.id === selectedId;

        if (annotation.kind === 'line') {
          const a = pdfToView(annotation.a, geometry);
          const b = pdfToView(annotation.b, geometry);
          const head = (tip: typeof a, from: typeof a) =>
            points([tip, ...arrowHeadWings(tip, from, annotation.thickness)]);

          return (
            <g key={annotation.id} className={selected ? 'is-selected' : undefined}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={annotation.color}
                strokeWidth={annotation.thickness}
                strokeLinecap="round"
              />
              {annotation.arrowEnd ? <polygon points={head(b, a)} fill={annotation.color} /> : null}
              {annotation.arrowStart ? (
                <polygon points={head(a, b)} fill={annotation.color} />
              ) : null}
            </g>
          );
        }

        if (annotation.kind === 'ink') {
          if (annotation.points.length < 2) return null;
          return (
            <polyline
              key={annotation.id}
              className={selected ? 'is-selected' : undefined}
              points={points(annotation.points.map((point) => pdfToView(point, geometry)))}
              fill="none"
              stroke={annotation.color}
              strokeWidth={annotation.thickness}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }

        const box = boxPdfToView(annotation.box, geometry);

        if (annotation.kind === 'text') {
          if (annotation.id === hideTextId || annotation.text === '') return null;
          return (
            <foreignObject
              key={annotation.id}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
            >
              <div
                className="annotation-text"
                style={{
                  color: annotation.color,
                  fontSize: `${annotation.fontSize}px`,
                  lineHeight: 1.35,
                }}
              >
                {annotation.text}
              </div>
            </foreignObject>
          );
        }

        const paint = annotation.filled
          ? { fill: annotation.color, fillOpacity: annotation.opacity, stroke: 'none' }
          : {
              fill: 'none',
              stroke: annotation.color,
              strokeWidth: annotation.thickness,
            };
        // Mirrors the Multiply blend the exported PDF uses for translucent fills.
        const style =
          annotation.filled && annotation.opacity < 1
            ? { mixBlendMode: 'multiply' as const }
            : undefined;

        return annotation.kind === 'rect' ? (
          <rect
            key={annotation.id}
            className={selected ? 'is-selected' : undefined}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            style={style}
            {...paint}
          />
        ) : (
          <ellipse
            key={annotation.id}
            className={selected ? 'is-selected' : undefined}
            cx={box.x + box.width / 2}
            cy={box.y + box.height / 2}
            rx={box.width / 2}
            ry={box.height / 2}
            style={style}
            {...paint}
          />
        );
      })}
    </svg>
  );
}
