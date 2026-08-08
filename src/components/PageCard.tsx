import type { DragEvent } from 'react';
import type { LoadedDoc, PageItem } from '../types';
import Thumbnail from './Thumbnail';

interface PageCardProps {
  page: PageItem;
  doc: LoadedDoc | undefined;
  position: number;
  total: number;
  showSource: boolean;
  dropSide: 'before' | 'after' | null;
  onToggle: (id: string, shiftKey: boolean) => void;
  onRotate: (id: string, delta: 90 | -90) => void;
  onDelete: (id: string) => void;
  onNudge: (id: string, direction: -1 | 1) => void;
  onOpen: (id: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
  onDragOver: (event: DragEvent<HTMLElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, id: string) => void;
  onDragEnd: () => void;
}

export default function PageCard({
  page,
  doc,
  position,
  total,
  showSource,
  dropSide,
  onToggle,
  onRotate,
  onDelete,
  onNudge,
  onOpen,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: PageCardProps) {
  const sourceLabel = doc ? `${doc.name}, page ${page.pageIndex + 1}` : 'Missing file';
  const classes = ['page-card'];
  if (page.selected) classes.push('is-selected');
  if (dropSide) classes.push(`drop-${dropSide}`);

  return (
    <li
      className={classes.join(' ')}
      draggable
      onDragStart={(event) => onDragStart(event, page.id)}
      onDragOver={(event) => onDragOver(event, page.id)}
      onDrop={(event) => onDrop(event, page.id)}
      onDragEnd={onDragEnd}
      aria-label={`Page ${position} of ${total} — ${sourceLabel}`}
    >
      <label className="page-select">
        <input
          type="checkbox"
          checked={page.selected}
          onChange={() => {}}
          onClick={(event) => onToggle(page.id, event.shiftKey)}
        />
        <span className="page-number">{position}</span>
      </label>

      <button
        type="button"
        className="page-open"
        title="Open this page to draw on it"
        aria-label={`Annotate page ${position}`}
        onClick={() => onOpen(page.id)}
      >
        <Thumbnail
          doc={doc}
          pageIndex={page.pageIndex}
          rotation={page.rotation}
          label={`Preview of ${sourceLabel}`}
          annotations={page.annotations}
        />
      </button>

      {showSource ? (
        <p className="page-source" title={sourceLabel}>
          {doc?.name ?? 'Missing file'}
        </p>
      ) : null}

      <div className="page-actions">
        <button
          type="button"
          className="icon-button"
          title="Move left"
          aria-label={`Move page ${position} left`}
          disabled={position === 1}
          onClick={() => onNudge(page.id, -1)}
        >
          ◀
        </button>
        <button
          type="button"
          className="icon-button"
          title="Rotate left"
          aria-label={`Rotate page ${position} left`}
          onClick={() => onRotate(page.id, -90)}
        >
          ⟲
        </button>
        <button
          type="button"
          className="icon-button"
          title="Rotate right"
          aria-label={`Rotate page ${position} right`}
          onClick={() => onRotate(page.id, 90)}
        >
          ⟳
        </button>
        <button
          type="button"
          className="icon-button danger"
          title="Delete page"
          aria-label={`Delete page ${position}`}
          onClick={() => onDelete(page.id)}
        >
          🗑
        </button>
        <button
          type="button"
          className="icon-button"
          title="Move right"
          aria-label={`Move page ${position} right`}
          disabled={position === total}
          onClick={() => onNudge(page.id, 1)}
        >
          ▶
        </button>
      </div>
    </li>
  );
}
