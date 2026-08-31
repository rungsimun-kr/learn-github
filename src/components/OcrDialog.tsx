import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { OCR_LANGUAGES } from '../lib/ocrAssets';
import { OCR_QUALITIES } from '../lib/textExport';
import type { ExtractProgress, PageText } from '../lib/ocr';

export interface OcrSettings {
  language: string;
  scale: number;
  selectionOnly: boolean;
  reOcrTextPages: boolean;
}

interface OcrDialogProps {
  totalPages: number;
  selectedPages: number;
  running: boolean;
  progress: ExtractProgress | null;
  sample: { pages: PageText[]; secondsPerPage: number } | null;
  onClose: () => void;
  onSample: (settings: OcrSettings) => void;
  onStart: (settings: OcrSettings) => void;
  onCancel: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const minutes = seconds / 60;
  if (minutes < 90) return `about ${Math.round(minutes)} minutes`;
  return `about ${(minutes / 60).toFixed(1)} hours`;
}

const PHASES: Record<ExtractProgress['phase'], string> = {
  scanning: 'Checking which pages already have text…',
  'starting-engine': 'Starting the OCR engine…',
  reading: 'Reading pages…',
  done: 'Finished.',
};

export default function OcrDialog({
  totalPages,
  selectedPages,
  running,
  progress,
  sample,
  onClose,
  onSample,
  onStart,
  onCancel,
}: OcrDialogProps) {
  const [language, setLanguage] = useState<string>(OCR_LANGUAGES[0].value);
  const [scale, setScale] = useState<number>(OCR_QUALITIES[1].scale);
  const [selectionOnly, setSelectionOnly] = useState(selectedPages > 0);
  const [reOcrTextPages, setReOcrTextPages] = useState(false);
  const [sampling, setSampling] = useState(false);

  const count = selectionOnly ? selectedPages : totalPages;
  const settings: OcrSettings = { language, scale, selectionOnly, reOcrTextPages };

  // Track elapsed time so the estimate is measured, not guessed.
  const startedRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) {
      startedRef.current = null;
      setElapsed(0);
      return;
    }
    startedRef.current ??= performance.now();
    const timer = setInterval(() => {
      if (startedRef.current !== null) {
        setElapsed((performance.now() - startedRef.current) / 1000);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (sample) setSampling(false);
  }, [sample]);

  const remaining =
    progress && progress.done > 0 && progress.done < progress.total
      ? ((progress.total - progress.done) * elapsed) / progress.done
      : null;

  return (
    <Modal
      title="Extract text"
      onClose={running ? onCancel : onClose}
      footer={
        running ? (
          <button type="button" className="button danger" onClick={onCancel}>
            Stop and keep what is done
          </button>
        ) : (
          <>
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="button"
              disabled={count === 0 || sampling}
              onClick={() => {
                setSampling(true);
                onSample(settings);
              }}
              title="Read a few pages first to check the settings"
            >
              {sampling ? 'Trying…' : 'Try 3 pages'}
            </button>
            <button
              type="button"
              className="button primary"
              disabled={count === 0}
              onClick={() => onStart(settings)}
            >
              Extract {count} page{count === 1 ? '' : 's'}
            </button>
          </>
        )
      }
    >
      {running && progress ? (
        <div className="ocr-progress">
          <p>{PHASES[progress.phase]}</p>
          <progress value={progress.done} max={progress.total} />
          <p className="hint">
            {progress.done} of {progress.total} pages
            {progress.needingOcr > 0 ? ` · ${progress.needingOcr} need OCR` : null}
            {remaining !== null ? ` · ${formatDuration(remaining)} left` : null}
          </p>
          {progress.page ? (
            <pre className="ocr-preview">{progress.page.text.slice(0, 400) || '(no text)'}</pre>
          ) : null}
          <p className="hint">Keep this tab open — the work happens here, in your browser.</p>
        </div>
      ) : (
        <>
          <fieldset className="field-group">
            <legend>Which pages?</legend>
            <label className="radio">
              <input
                type="radio"
                name="ocr-scope"
                checked={!selectionOnly}
                onChange={() => setSelectionOnly(false)}
              />
              <span>All {totalPages} pages</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="ocr-scope"
                checked={selectionOnly}
                disabled={selectedPages === 0}
                onChange={() => setSelectionOnly(true)}
              />
              <span>
                Selected pages{selectedPages > 0 ? ` (${selectedPages})` : ' — none selected yet'}
              </span>
            </label>
          </fieldset>

          <label className="inline-field">
            <span>Language</span>
            <select
              className="text-input"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {OCR_LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-field">
            <span>Quality</span>
            <select
              className="text-input"
              value={scale}
              onChange={(event) => setScale(Number(event.target.value))}
            >
              {OCR_QUALITIES.map((option) => (
                <option key={option.label} value={option.scale}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={reOcrTextPages}
              onChange={(event) => setReOcrTextPages(event.target.checked)}
            />
            <span>
              Re-read pages that already have text — slower, but use it if the existing text layer is
              wrong
            </span>
          </label>

          {sample ? (
            <div className="ocr-sample">
              <p className="summary">
                {sample.secondsPerPage.toFixed(1)}s per page on this machine — around{' '}
                <strong>{formatDuration(sample.secondsPerPage * count)}</strong> for all {count}.
              </p>
              {sample.pages.map((page) => (
                <div key={page.label}>
                  <p className="hint">
                    Page {page.label} · {page.source === 'ocr' ? 'OCR' : 'already had text'}
                    {page.confidence !== undefined
                      ? ` · confidence ${Math.round(page.confidence)}%`
                      : null}
                  </p>
                  <pre className="ocr-preview">{page.text.slice(0, 300) || '(no text found)'}</pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="summary">
              Pages that already contain text are read directly and take no time at all. Only scanned
              pages go through OCR, which is slow — try a few pages first to see how slow, and to
              check the language is right.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
