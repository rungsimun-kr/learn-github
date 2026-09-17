interface DropZoneProps {
  onBrowse: () => void;
}

/** Empty state — the first thing a visitor sees. */
export default function DropZone({ onBrowse }: DropZoneProps) {
  return (
    <div className="dropzone">
      <div className="dropzone-inner">
        <p className="dropzone-icon" aria-hidden="true">
          📄
        </p>
        <h2>Drop PDFs or images here</h2>
        <p>
          Add one file to cut it up, or several to join them. Pages from every file land in a single
          list you can reorder, rotate, and export — and an image becomes a page of its own.
        </p>
        <button type="button" className="button primary large" onClick={onBrowse}>
          Choose files
        </button>
        <p className="fine-print">
          Nothing is uploaded. Your files are opened and edited inside this browser tab.
        </p>
      </div>
    </div>
  );
}
