interface ToolbarProps {
  totalPages: number;
  selectedCount: number;
  insertPosition: number;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  onAdd: () => void;
  onInsert: () => void;
  onAnnotate: () => void;
  onRotate: (delta: 90 | -90) => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDownload: () => void;
  onSplit: () => void;
  onExportImages: () => void;
  onExtractText: () => void;
  onContents: () => void;
  onClear: () => void;
}

export default function Toolbar(props: ToolbarProps) {
  const {
    totalPages,
    selectedCount,
    insertPosition,
    canUndo,
    canRedo,
    busy,
    onAdd,
    onInsert,
    onAnnotate,
    onRotate,
    onDelete,
    onSelectAll,
    onSelectNone,
    onUndo,
    onRedo,
    onDownload,
    onSplit,
    onExportImages,
    onExtractText,
    onContents,
    onClear,
  } = props;

  const empty = totalPages === 0;
  const noSelection = selectedCount === 0;

  return (
    <div className="toolbar" role="toolbar" aria-label="Editing tools">
      <div className="toolbar-group">
        <button type="button" className="button primary" onClick={onAdd} disabled={busy}>
          Add files
        </button>
        <button
          type="button"
          className="button"
          onClick={onInsert}
          disabled={busy || empty}
          title={`Insert another file's pages at position ${insertPosition}`}
        >
          Insert at {insertPosition}
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="button"
          onClick={onAnnotate}
          disabled={busy || empty}
          title="Draw text, boxes and arrows on a page"
        >
          ✎ Annotate
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onRotate(-90)}
          disabled={busy || noSelection}
          title="Rotate the selected pages left"
        >
          ⟲ Rotate
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onRotate(90)}
          disabled={busy || noSelection}
          title="Rotate the selected pages right"
        >
          ⟳ Rotate
        </button>
        <button
          type="button"
          className="button danger"
          onClick={onDelete}
          disabled={busy || noSelection}
        >
          Delete
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" className="button" onClick={onSelectAll} disabled={busy || empty}>
          Select all
        </button>
        <button
          type="button"
          className="button"
          onClick={onSelectNone}
          disabled={busy || noSelection}
        >
          Clear selection
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="button"
          onClick={onUndo}
          disabled={busy || !canUndo}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          className="button"
          onClick={onRedo}
          disabled={busy || !canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </button>
      </div>

      <div className="toolbar-group toolbar-end">
        <button
          type="button"
          className="button"
          onClick={onContents}
          disabled={busy || empty}
          title="Add a contents page and bookmarks that jump to a page"
        >
          Contents…
        </button>
        <button type="button" className="button" onClick={onExtractText} disabled={busy || empty}>
          Extract text…
        </button>
        <button type="button" className="button" onClick={onExportImages} disabled={busy || empty}>
          Export images…
        </button>
        <button type="button" className="button" onClick={onSplit} disabled={busy || empty}>
          Split…
        </button>
        <button type="button" className="button primary" onClick={onDownload} disabled={busy || empty}>
          {selectedCount > 0 ? `Download ${selectedCount} selected` : 'Download PDF'}
        </button>
        <button type="button" className="button ghost" onClick={onClear} disabled={busy || empty}>
          Start over
        </button>
      </div>
    </div>
  );
}
