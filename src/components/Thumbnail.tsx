import { useEffect, useState } from 'react';
import type { LoadedDoc } from '../types';
import { getThumbnail } from '../lib/render';

interface ThumbnailProps {
  doc: LoadedDoc | undefined;
  pageIndex: number;
  rotation: number;
  label: string;
}

/**
 * Page preview. The image is rendered once per source page and cached; the
 * editor's rotation is applied with CSS so turning a page is free.
 */
export default function Thumbnail({ doc, pageIndex, rotation, label }: ThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setFailed(false);
    getThumbnail(doc, pageIndex).then(
      (value) => {
        if (!cancelled) setUrl(value);
      },
      (error: unknown) => {
        console.error('Failed to render page preview', error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex]);

  if (failed) return <div className="thumb thumb-empty">Preview unavailable</div>;
  if (!url) return <div className="thumb thumb-empty" aria-hidden="true" />;

  return (
    <div className="thumb">
      <img src={url} alt={label} style={{ transform: `rotate(${rotation}deg)` }} draggable={false} />
    </div>
  );
}
