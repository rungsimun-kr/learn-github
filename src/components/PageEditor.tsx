import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  createInk,
  createLine,
  createShape,
  createText,
  hasBox,
  type Annotation,
  type AnnotationStyle,
  type Point,
  type Tool,
} from '../lib/annotations';
import {
  boxPdfToView,
  boxViewToPdf,
  hitTest,
  moveAnnotation,
  pdfToView,
  viewSize,
  viewToPdf,
  type PageGeometry,
} from '../lib/geometry';
import { getPageGeometry, renderPageUrl } from '../lib/render';
import type { LoadedDoc, PageItem } from '../types';
import AnnotationLayer from './AnnotationLayer';
import AnnotationToolbar from './AnnotationToolbar';

interface PageEditorProps {
  page: PageItem;
  doc: LoadedDoc;
  position: number;
  total: number;
  tool: Tool;
  style: AnnotationStyle;
  onTool: (tool: Tool) => void;
  onStyle: (patch: Partial<AnnotationStyle>) => void;
  onChange: (annotations: Annotation[]) => void;
  onNavigate: (delta: -1 | 1) => void;
  onClose: () => void;
}

/** A drag in progress. Kept out of the page list so one drag is one undo step. */
type Drag =
  | { type: 'create'; start: Point }
  | { type: 'ink' }
  | { type: 'move'; id: string; last: Point }
  | { type: 'resize'; id: string; anchor: Point }
  | { type: 'endpoint'; id: string; which: 'a' | 'b' };

const HANDLE = 5;
const MIN_DRAG = 3;
const TEXT_BOX = { width: 180, height: 60 };
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];

export default function PageEditor({
  page,
  doc,
  position,
  total,
  tool,
  style,
  onTool,
  onStyle,
  onChange,
  onNavigate,
  onClose,
}: PageEditorProps) {
  const [geometry, setGeometry] = useState<PageGeometry | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const annotationsRef = useRef(page.annotations);
  annotationsRef.current = page.annotations;

  const scale = fit * zoom;

  // Page metrics, refreshed whenever the page or its rotation changes.
  useEffect(() => {
    let cancelled = false;
    getPageGeometry(doc.jsDoc, page.pageIndex, page.rotation).then((value) => {
      if (!cancelled) setGeometry(value);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page.pageIndex, page.rotation]);

  // Fit the page to whatever space the window leaves us.
  useLayoutEffect(() => {
    if (!geometry) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    const measure = () => {
      const size = viewSize(geometry);
      const available = surface.getBoundingClientRect();
      setFit(Math.max(0.1, Math.min(available.width / size.width, available.height / size.height)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [geometry]);

  // Re-render the page bitmap at the current scale.
  useEffect(() => {
    if (!geometry || scale <= 0) return;
    let cancelled = false;
    let created: string | null = null;

    renderPageUrl(doc.jsDoc, page.pageIndex, {
      scale: Math.min(scale * (window.devicePixelRatio || 1), 6),
      rotation: page.rotation,
    }).then(
      (url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setImageUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return url;
        });
      },
      () => {},
    );

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // `scale` is rounded so a pixel of resize does not re-render the page.
  }, [doc, page.pageIndex, page.rotation, geometry, Math.round(scale * 20)]); // eslint-disable-line react-hooks/exhaustive-deps

  const size = geometry ? viewSize(geometry) : { width: 0, height: 0 };
  const selected = useMemo(
    () => page.annotations.find((annotation) => annotation.id === selectedId) ?? null,
    [page.annotations, selectedId],
  );

  const commit = useCallback((next: Annotation[]) => onChange(next), [onChange]);

  const update = useCallback(
    (id: string, change: (annotation: Annotation) => Annotation) => {
      commit(
        annotationsRef.current.map((annotation) =>
          annotation.id === id ? change(annotation) : annotation,
        ),
      );
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit(annotationsRef.current.filter((annotation) => annotation.id !== id));
      setSelectedId(null);
      setEditingId(null);
    },
    [commit],
  );

  /** Pointer position in view-space points. */
  const pointAt = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const stage = stageRef.current;
      if (!stage) return { x: 0, y: 0 };
      const box = stage.getBoundingClientRect();
      return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
    },
    [scale],
  );

  /** Corner handles of the selected annotation, in view space. */
  const handles = useMemo(() => {
    if (!selected || !geometry) return [] as Array<{ at: Point; drag: Drag }>;

    if (selected.kind === 'line') {
      return (['a', 'b'] as const).map((which) => ({
        at: pdfToView(selected[which], geometry),
        drag: { type: 'endpoint' as const, id: selected.id, which },
      }));
    }
    if (!hasBox(selected)) return [];

    const box = boxPdfToView(selected.box, geometry);
    const corners: Point[] = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    return corners.map((at, index) => ({
      at,
      // Resizing pins the opposite corner and follows the pointer with this one.
      drag: { type: 'resize' as const, id: selected.id, anchor: corners[(index + 2) % 4] },
    }));
  }, [selected, geometry]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!geometry || event.button !== 0) return;
    // Suppress the default focus shift. Without it, the click that follows this
    // pointerdown blurs a text box the same gesture just opened, and the
    // empty-box cleanup then throws it away before anyone can type.
    event.preventDefault();
    const point = pointAt(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (editingId) setEditingId(null);

    // A handle always wins over whatever is underneath it.
    const handle = handles.find(
      (entry) => Math.abs(entry.at.x - point.x) * scale <= HANDLE + 3 &&
        Math.abs(entry.at.y - point.y) * scale <= HANDLE + 3,
    );
    if (handle) {
      dragRef.current = handle.drag;
      return;
    }

    if (tool === 'select') {
      const hit = [...page.annotations]
        .reverse()
        .find((annotation) => hitTest(annotation, point, geometry, HANDLE / scale + 4));
      setSelectedId(hit?.id ?? null);
      dragRef.current = hit ? { type: 'move', id: hit.id, last: point } : null;
      return;
    }

    if (tool === 'text') {
      const box = boxViewToPdf(
        point,
        { x: point.x + TEXT_BOX.width, y: point.y + TEXT_BOX.height },
        geometry,
      );
      const annotation = createText(box, style);
      commit([...page.annotations, annotation]);
      setSelectedId(annotation.id);
      setEditingId(annotation.id);
      onTool('select');
      return;
    }

    if (tool === 'ink') {
      dragRef.current = { type: 'ink' };
      setDraft(createInk([viewToPdf(point, geometry)], style));
      return;
    }

    dragRef.current = { type: 'create', start: point };
    setSelectedId(null);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !geometry) return;
    const point = pointAt(event);

    switch (drag.type) {
      case 'create': {
        if (tool === 'rect' || tool === 'ellipse') {
          setDraft(createShape(tool, boxViewToPdf(drag.start, point, geometry), style));
        } else if (tool === 'line' || tool === 'arrow') {
          setDraft(
            createLine(viewToPdf(drag.start, geometry), viewToPdf(point, geometry), style, {
              start: tool === 'arrow' && style.arrowStart,
              end: tool === 'arrow',
            }),
          );
        }
        return;
      }
      case 'ink': {
        setDraft((current) => {
          if (!current || current.kind !== 'ink') return current;
          const next = viewToPdf(point, geometry);
          const last = current.points[current.points.length - 1];
          // Thin the stream out; a raw pointer trail is mostly redundant points.
          if (Math.hypot(next.x - last.x, next.y - last.y) < 1.5) return current;
          return { ...current, points: [...current.points, next] };
        });
        return;
      }
      case 'move': {
        const delta = { x: point.x - drag.last.x, y: point.y - drag.last.y };
        dragRef.current = { ...drag, last: point };
        update(drag.id, (annotation) => moveAnnotation(annotation, delta, geometry));
        return;
      }
      case 'resize': {
        update(drag.id, (annotation) =>
          hasBox(annotation)
            ? { ...annotation, box: boxViewToPdf(drag.anchor, point, geometry) }
            : annotation,
        );
        return;
      }
      case 'endpoint': {
        update(drag.id, (annotation) =>
          annotation.kind === 'line'
            ? { ...annotation, [drag.which]: viewToPdf(point, geometry) }
            : annotation,
        );
        return;
      }
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag || !geometry) return;

    if (drag.type === 'create' || drag.type === 'ink') {
      const finished = draft;
      setDraft(null);
      if (!finished) return;

      // Discard an accidental click that produced nothing worth keeping.
      const tooSmall =
        finished.kind === 'ink'
          ? finished.points.length < 2
          : hasBox(finished)
            ? finished.box.width * scale < MIN_DRAG || finished.box.height * scale < MIN_DRAG
            : finished.kind === 'line' &&
              Math.hypot(finished.b.x - finished.a.x, finished.b.y - finished.a.y) * scale < MIN_DRAG;
      if (tooSmall) return;

      commit([...annotationsRef.current, finished]);
      setSelectedId(finished.id);
      onTool('select');
    }
  };

  /** Double-clicking a text box reopens it for typing. */
  const onDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!geometry) return;
    const point = pointAt(event);
    const hit = [...page.annotations]
      .reverse()
      .find((annotation) => annotation.kind === 'text' && hitTest(annotation, point, geometry));
    if (hit) {
      setSelectedId(hit.id);
      setEditingId(hit.id);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (selectedId) setSelectedId(null);
        else onClose();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        remove(selectedId);
      } else if (event.key === 'ArrowLeft' && position > 1) {
        onNavigate(-1);
      } else if (event.key === 'ArrowRight' && position < total) {
        onNavigate(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, remove, onClose, onNavigate, position, total]);

  const editing = editingId
    ? (page.annotations.find((annotation) => annotation.id === editingId) ?? null)
    : null;
  const editingBox = editing && geometry && hasBox(editing) ? boxPdfToView(editing.box, geometry) : null;

  return (
    <div className="page-editor" role="dialog" aria-modal="true" aria-label={`Editing page ${position}`}>
      <header className="editor-header">
        <div className="editor-title">
          <strong>Page {position}</strong>
          <span className="hint">of {total}</span>
        </div>
        <AnnotationToolbar
          tool={tool}
          style={style}
          canDelete={selected !== null}
          onTool={onTool}
          onStyle={onStyle}
          onDelete={() => selectedId && remove(selectedId)}
        />
        <div className="editor-actions">
          <label className="inline-field">
            <span>Zoom</span>
            <select
              className="text-input"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            >
              {ZOOMS.map((value) => (
                <option key={value} value={value}>
                  {Math.round(value * 100)}%
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button primary" onClick={onClose}>
            Done
          </button>
        </div>
      </header>

      <div className="editor-surface" ref={surfaceRef}>
        {geometry ? (
          <div
            ref={stageRef}
            className={`editor-stage tool-${tool}`}
            style={{ width: size.width * scale, height: size.height * scale }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
          >
            {imageUrl ? <img src={imageUrl} alt={`Page ${position}`} draggable={false} /> : null}

            <AnnotationLayer
              annotations={page.annotations}
              geometry={geometry}
              draft={draft}
              selectedId={selectedId}
              hideTextId={editingId}
            />

            {handles.length > 0 ? (
              <svg
                className="handle-layer"
                viewBox={`0 0 ${size.width} ${size.height}`}
                preserveAspectRatio="none"
              >
                {handles.map((handle, index) => (
                  <rect
                    key={index}
                    className="handle"
                    x={handle.at.x - HANDLE / scale}
                    y={handle.at.y - HANDLE / scale}
                    width={(HANDLE * 2) / scale}
                    height={(HANDLE * 2) / scale}
                  />
                ))}
              </svg>
            ) : null}

            {editing && editingBox && editing.kind === 'text' ? (
              <textarea
                className="annotation-input"
                autoFocus
                value={editing.text}
                style={{
                  left: editingBox.x * scale,
                  top: editingBox.y * scale,
                  width: editingBox.width * scale,
                  height: editingBox.height * scale,
                  color: editing.color,
                  fontSize: editing.fontSize * scale,
                  lineHeight: 1.35,
                }}
                // Keep the stage's handlers out of it, so clicking into the box
                // neither starts a drawing nor loses the default focus.
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) =>
                  update(editing.id, (annotation) =>
                    annotation.kind === 'text'
                      ? { ...annotation, text: event.target.value }
                      : annotation,
                  )
                }
                onBlur={() => {
                  if (editing.text.trim() === '') remove(editing.id);
                  setEditingId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') event.currentTarget.blur();
                }}
              />
            ) : null}
          </div>
        ) : (
          <p className="hint">Loading page…</p>
        )}
      </div>

      <footer className="editor-footer">
        <button type="button" className="button" disabled={position === 1} onClick={() => onNavigate(-1)}>
          ‹ Previous
        </button>
        <span className="hint">
          {tool === 'select'
            ? 'Click a mark to select it, drag to move, drag a corner to resize.'
            : 'Drag on the page to draw. Double-click a text box to edit it.'}
        </span>
        <button
          type="button"
          className="button"
          disabled={position === total}
          onClick={() => onNavigate(1)}
        >
          Next ›
        </button>
      </footer>
    </div>
  );
}
