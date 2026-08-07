import { useState } from 'react';
import Modal from './Modal';
import type { ImageFormat } from '../types';

export interface ImageExportSettings {
  format: ImageFormat;
  scale: number;
  quality: number;
  selectionOnly: boolean;
}

interface ExportImagesDialogProps {
  totalPages: number;
  selectedPages: number;
  busy: boolean;
  progress: string | null;
  onClose: () => void;
  onConfirm: (settings: ImageExportSettings) => void;
}

// PDF user space is 72 dpi, so the scale factor doubles as a dpi multiplier.
const RESOLUTIONS = [
  { scale: 1, label: 'Screen — 72 dpi' },
  { scale: 2, label: 'Good — 144 dpi' },
  { scale: 4, label: 'Print — 288 dpi' },
];

export default function ExportImagesDialog({
  totalPages,
  selectedPages,
  busy,
  progress,
  onClose,
  onConfirm,
}: ExportImagesDialogProps) {
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(0.92);
  const [selectionOnly, setSelectionOnly] = useState(selectedPages > 0);

  const count = selectionOnly ? selectedPages : totalPages;

  return (
    <Modal
      title="Export pages as images"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || count === 0}
            onClick={() => onConfirm({ format, scale, quality, selectionOnly })}
          >
            {busy ? (progress ?? 'Working…') : 'Export'}
          </button>
        </>
      }
    >
      <fieldset className="field-group">
        <legend>Which pages?</legend>
        <label className="radio">
          <input
            type="radio"
            name="image-scope"
            checked={!selectionOnly}
            onChange={() => setSelectionOnly(false)}
          />
          <span>All {totalPages} pages</span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="image-scope"
            checked={selectionOnly}
            disabled={selectedPages === 0}
            onChange={() => setSelectionOnly(true)}
          />
          <span>
            Selected pages{selectedPages > 0 ? ` (${selectedPages})` : ' — none selected yet'}
          </span>
        </label>
      </fieldset>

      <fieldset className="field-group">
        <legend>Format</legend>
        <label className="radio">
          <input
            type="radio"
            name="image-format"
            checked={format === 'png'}
            onChange={() => setFormat('png')}
          />
          <span>PNG — lossless, larger files</span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="image-format"
            checked={format === 'jpeg'}
            onChange={() => setFormat('jpeg')}
          />
          <span>JPEG — smaller, white background</span>
        </label>

        {format === 'jpeg' ? (
          <label className="inline-field indent">
            <span>Quality</span>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.02}
              value={quality}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
            <span className="hint">{Math.round(quality * 100)}%</span>
          </label>
        ) : null}
      </fieldset>

      <label className="inline-field">
        <span>Resolution</span>
        <select
          className="text-input"
          value={scale}
          onChange={(event) => setScale(Number(event.target.value))}
        >
          {RESOLUTIONS.map((option) => (
            <option key={option.scale} value={option.scale}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <p className="summary">
        {count === 1
          ? `One ${format.toUpperCase()} image.`
          : `${count} ${format.toUpperCase()} images, delivered as a .zip.`}
      </p>
    </Modal>
  );
}
