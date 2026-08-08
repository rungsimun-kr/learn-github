import { useEffect, useState } from 'react';
import type { Annotation } from '../lib/annotations';
import { getPageGeometry, getThumbnail } from '../lib/render';
import type { PageGeometry } from '../lib/geometry';
import type { LoadedDoc } from '../types';
import AnnotationLayer from './AnnotationLayer';

interface ThumbnailProps {
  doc: LoadedDoc | undefined;
  pageIndex: number;
  rotation: number;
  label: string;
  annotations?: readonly Annotation[];
}

/**
 * Page preview. The image is rendered once per source page and cached; the
 * editor's rotation is applied with CSS so turning a page is free.
 *
 * Annotations ride on top as an SVG overlay rather than being drawn into the
 * bitmap, so marking a page never costs a re-render either.
 */
export default function Thumbnail({
  doc,
  pageIndex,
  rotation,
  label,
  annotations,
}: ThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [geometry, setGeometry] = useState<PageGeometry | null>(null);
  const hasMarks = (annotations?.length ?? 0) > 0;

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

  useEffect(() => {
    if (!doc || !hasMarks) return;
    let cancelled = false;
    getPageGeometry(doc.jsDoc, pageIndex, rotation).then(
      (value) => {
        if (!cancelled) setGeometry(value);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, rotation, hasMarks]);

  if (failed) return <div className="thumb thumb-empty">Preview unavailable</div>;
  if (!url) return <div className="thumb thumb-empty" aria-hidden="true" />;

  return (
    <div className="thumb">
      <span className="thumb-frame" style={{ transform: `rotate(${rotation}deg)` }}>
        <img src={url} alt={label} draggable={false} />
        {hasMarks && geometry ? (
          <AnnotationLayer annotations={annotations ?? []} geometry={geometry} />
        ) : null}
      </span>
    </div>
  );
}
