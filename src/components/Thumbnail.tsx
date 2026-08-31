import { useEffect, useRef, useState } from 'react';
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

/** How far outside the viewport to start rendering, so scrolling stays ahead. */
const PRELOAD_MARGIN = '800px';

/**
 * Page preview. The image is rendered once per source page and cached; the
 * editor's rotation is applied with CSS so turning a page is free.
 *
 * Rendering waits until the card is near the viewport. A 500-page book would
 * otherwise queue 500 render jobs on load and leave the grid unusable for
 * minutes before anyone had scrolled past the first row.
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
  const [visible, setVisible] = useState(false);
  const [geometry, setGeometry] = useState<PageGeometry | null>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const hasMarks = (annotations?.length ?? 0) > 0;

  useEffect(() => {
    if (visible) return;
    const node = holderRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!doc || !visible) return;
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
  }, [doc, pageIndex, visible]);

  useEffect(() => {
    if (!doc || !hasMarks || !visible) return;
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
  }, [doc, pageIndex, rotation, hasMarks, visible]);

  return (
    <div className={`thumb${url ? '' : ' thumb-empty'}`} ref={holderRef}>
      {failed ? 'Preview unavailable' : null}
      {url ? (
        <span className="thumb-frame" style={{ transform: `rotate(${rotation}deg)` }}>
          <img src={url} alt={label} draggable={false} />
          {hasMarks && geometry ? (
            <AnnotationLayer annotations={annotations ?? []} geometry={geometry} />
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
