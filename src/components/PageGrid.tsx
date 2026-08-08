import { useState, type DragEvent } from 'react';
import type { LoadedDoc, PageItem } from '../types';
import PageCard from './PageCard';

interface PageGridProps {
  pages: PageItem[];
  docs: Map<string, LoadedDoc>;
  showSource: boolean;
  onToggle: (id: string, shiftKey: boolean) => void;
  onRotate: (id: string, delta: 90 | -90) => void;
  onDelete: (id: string) => void;
  onNudge: (id: string, direction: -1 | 1) => void;
  onOpen: (id: string) => void;
  onReorder: (draggedId: string, targetId: string, side: 'before' | 'after') => void;
}

interface DropTarget {
  id: string;
  side: 'before' | 'after';
}

export default function PageGrid({
  pages,
  docs,
  showSource,
  onToggle,
  onRotate,
  onDelete,
  onNudge,
  onOpen,
  onReorder,
}: PageGridProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const handleDragStart = (event: DragEvent<HTMLElement>, id: string) => {
    setDraggingId(id);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag unless some data is set.
    event.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, id: string) => {
    if (!draggingId || draggingId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < box.left + box.width / 2 ? 'before' : 'after';
    setDropTarget((current) =>
      current?.id === id && current.side === side ? current : { id, side },
    );
  };

  const handleDrop = (event: DragEvent<HTMLElement>, id: string) => {
    event.preventDefault();
    const source = draggingId ?? event.dataTransfer.getData('text/plain');
    const side = dropTarget?.id === id ? dropTarget.side : 'before';
    if (source && source !== id) onReorder(source, id, side);
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  return (
    <ol className="page-grid" onDragLeave={() => setDropTarget(null)}>
      {pages.map((page, index) => (
        <PageCard
          key={page.id}
          page={page}
          doc={docs.get(page.docId)}
          position={index + 1}
          total={pages.length}
          showSource={showSource}
          dropSide={dropTarget?.id === page.id ? dropTarget.side : null}
          onToggle={onToggle}
          onRotate={onRotate}
          onDelete={onDelete}
          onNudge={onNudge}
          onOpen={onOpen}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
    </ol>
  );
}
