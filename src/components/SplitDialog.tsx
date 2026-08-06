import { useMemo, useState } from 'react';
import Modal from './Modal';
import { chunkEvery, eachPage, parseRanges, type PageRange } from '../lib/ranges';

type Mode = 'ranges' | 'every' | 'each';

interface SplitDialogProps {
  pageCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (ranges: PageRange[]) => void;
}

export default function SplitDialog({ pageCount, busy, onClose, onConfirm }: SplitDialogProps) {
  const [mode, setMode] = useState<Mode>('ranges');
  const [input, setInput] = useState('1-' + pageCount);
  const [size, setSize] = useState('1');
  const [combine, setCombine] = useState(false);

  const result = useMemo<{ ranges: PageRange[] } | { error: string }>(() => {
    try {
      if (mode === 'each') return { ranges: eachPage(pageCount) };
      if (mode === 'every') return { ranges: chunkEvery(pageCount, Number(size)) };

      const ranges = parseRanges(input, pageCount);
      if (!combine) return { ranges };
      return {
        ranges: [
          {
            label: ranges.map((range) => range.label).join(', '),
            indices: ranges.flatMap((range) => range.indices),
          },
        ],
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [mode, input, size, combine, pageCount]);

  const ranges = 'ranges' in result ? result.ranges : null;
  const pageTotal = ranges?.reduce((sum, range) => sum + range.indices.length, 0) ?? 0;

  return (
    <Modal
      title="Split or extract pages"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!ranges || ranges.length === 0 || busy}
            onClick={() => ranges && onConfirm(ranges)}
          >
            {busy ? 'Working…' : 'Export'}
          </button>
        </>
      }
    >
      <fieldset className="field-group">
        <legend>How would you like to split it?</legend>

        <label className="radio">
          <input
            type="radio"
            name="split-mode"
            checked={mode === 'ranges'}
            onChange={() => setMode('ranges')}
          />
          <span>Specific pages and ranges</span>
        </label>

        {mode === 'ranges' ? (
          <div className="indent">
            <input
              className="text-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="1-5, 8, 10-12"
              aria-label="Pages to extract"
            />
            <p className="hint">
              This document has {pageCount} page{pageCount === 1 ? '' : 's'}. Use <code>4</code> for a
              single page, <code>2-6</code> for a range, <code>6-2</code> to reverse one, and{' '}
              <code>4-</code> for "page 4 to the end".
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={combine}
                onChange={(event) => setCombine(event.target.checked)}
              />
              <span>Combine everything into one PDF instead of one file per range</span>
            </label>
          </div>
        ) : null}

        <label className="radio">
          <input
            type="radio"
            name="split-mode"
            checked={mode === 'every'}
            onChange={() => setMode('every')}
          />
          <span>Fixed-size chunks</span>
        </label>

        {mode === 'every' ? (
          <div className="indent">
            <label className="inline-field">
              <input
                type="number"
                min={1}
                max={pageCount}
                className="text-input narrow"
                value={size}
                onChange={(event) => setSize(event.target.value)}
              />
              <span>pages per file</span>
            </label>
          </div>
        ) : null}

        <label className="radio">
          <input
            type="radio"
            name="split-mode"
            checked={mode === 'each'}
            onChange={() => setMode('each')}
          />
          <span>Every page as its own file</span>
        </label>
      </fieldset>

      {'error' in result ? (
        <p className="inline-error" role="alert">
          {result.error}
        </p>
      ) : (
        <p className="summary">
          {ranges!.length === 1
            ? `One PDF with ${pageTotal} page${pageTotal === 1 ? '' : 's'}.`
            : `${ranges!.length} PDFs (${pageTotal} pages in total), delivered as a .zip.`}
        </p>
      )}
    </Modal>
  );
}
