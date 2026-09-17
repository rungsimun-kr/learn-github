import { useMemo } from 'react';
import Modal from './Modal';
import { layoutToc, seedFromFiles, type TocEntry, type TocSettings } from '../lib/toc';
import { uid } from '../lib/uid';
import type { LoadedDoc, PageItem } from '../types';

interface TocDialogProps {
  pages: readonly PageItem[];
  docs: ReadonlyMap<string, LoadedDoc>;
  toc: TocSettings;
  onChange: (toc: TocSettings) => void;
  onClose: () => void;
}

export default function TocDialog({ pages, docs, toc, onChange, onClose }: TocDialogProps) {
  /** Where each page currently sits, so an entry can show and set a number. */
  const positions = useMemo(
    () => new Map(pages.map((page, index) => [page.id, index])),
    [pages],
  );

  const preview = useMemo(
    () => layoutToc(toc.entries, pages, { width: 595, height: 842 }),
    [toc.entries, pages],
  );

  const patch = (change: Partial<TocSettings>) => onChange({ ...toc, ...change });

  const setEntry = (id: string, change: Partial<TocEntry>) =>
    patch({
      entries: toc.entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    });

  const rows = preview.pages.flat();
  const live = rows.length;

  // Show the entries in the order the contents page will print them — by page —
  // so the dialog and the result never disagree. Entries whose page is gone
  // sort last, where the warning below explains them.
  const ordered = useMemo(() => {
    const rank = (entry: TocEntry) => positions.get(entry.pageId) ?? Number.MAX_SAFE_INTEGER;
    return [...toc.entries].sort((left, right) => rank(left) - rank(right));
  }, [toc.entries, positions]);

  return (
    <Modal
      title="Contents"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button"
            onClick={() => patch({ entries: seedFromFiles(pages, docs) })}
            disabled={pages.length === 0}
            title="Replace the list with one entry per file you added"
          >
            Rebuild from files
          </button>
          <button type="button" className="button primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <label className="inline-field">
        <span>Heading</span>
        <input
          className="text-input"
          value={toc.heading}
          onChange={(event) => patch({ heading: event.target.value })}
          placeholder="Contents"
        />
      </label>

      <fieldset className="field-group">
        <legend>Include</legend>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={toc.addPage}
            onChange={(event) => patch({ addPage: event.target.checked })}
          />
          <span>A contents page at the front, with each line clickable</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={toc.addBookmarks}
            onChange={(event) => patch({ addBookmarks: event.target.checked })}
          />
          <span>Bookmarks in the reader's sidebar</span>
        </label>
      </fieldset>

      {toc.entries.length === 0 ? (
        <p className="summary">
          No entries yet. <strong>Rebuild from files</strong> makes one per file you added, or add
          them one at a time and type your own titles.
        </p>
      ) : (
        <ol className="toc-entries">
          {ordered.map((entry) => {
            const position = positions.get(entry.pageId);
            const missing = position === undefined;

            return (
              <li key={entry.id} className={`toc-entry${missing ? ' is-missing' : ''}`}>
                <input
                  className="text-input"
                  value={entry.title}
                  onChange={(event) => setEntry(entry.id, { title: event.target.value })}
                  aria-label="Entry title"
                  placeholder="Title"
                />
                <input
                  className="text-input narrow"
                  type="number"
                  min={1}
                  max={pages.length}
                  value={missing ? '' : position + 1}
                  aria-label="Goes to page"
                  onChange={(event) => {
                    const target = pages[Number(event.target.value) - 1];
                    if (target) setEntry(entry.id, { pageId: target.id });
                  }}
                />
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Remove ${entry.title || 'entry'}`}
                  onClick={() =>
                    patch({ entries: toc.entries.filter((other) => other.id !== entry.id) })
                  }
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="toc-actions">
        <button
          type="button"
          className="button"
          disabled={pages.length === 0}
          onClick={() =>
            patch({
              entries: [
                ...toc.entries,
                { id: uid('toc'), title: '', pageId: pages[0].id },
              ],
            })
          }
        >
          Add entry
        </button>
      </div>

      <p className="summary">
        {live === 0
          ? 'Nothing will be added until there is at least one entry.'
          : `${live} entr${live === 1 ? 'y' : 'ies'}` +
            (toc.addPage
              ? ` across ${preview.pageCount} contents page${preview.pageCount === 1 ? '' : 's'}`
              : '') +
            '.'}
        {preview.dropped > 0
          ? ` ${preview.dropped} entr${preview.dropped === 1 ? 'y points' : 'ies point'} at a page that is no longer here and will be left out.`
          : null}
      </p>
    </Modal>
  );
}
