import { useEffect, useRef, useState } from 'react';
import { computeDotLeader, fitTitle, type TocLayout } from '../lib/toc';

interface TocPreviewProps {
  layout: TocLayout;
  heading: string;
}

/** Target width in CSS pixels; the canvas backing store scales up from here. */
const PREVIEW_WIDTH = 300;
const INK = '#1a1a1a';
const RULE = '#bfbfbf';
const DOTS = '#9e9e9e';

/**
 * A live, canvas-drawn preview of one contents page.
 *
 * This mirrors the layout `drawTocPages` writes into the PDF, but draws with
 * the Canvas 2D API instead of pdf-lib: no PDF build and no font fetch beyond
 * the Sarabun webface already loaded for the annotation overlay, so it can
 * redraw on every keystroke instead of only after an export.
 *
 * It will never be pixel-identical to the PDF — canvas and PDF font metrics
 * never quite agree — but it shares the same row math (`TocLayout`), the same
 * title-fitting (`fitTitle`) and the same dot-leader count (`computeDotLeader`),
 * so what it shows is the same layout, just measured by a different engine.
 */
export default function TocPreview({ layout, heading }: TocPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [fontsReady, setFontsReady] = useState(document.fonts.status === 'loaded');

  // The first paint can happen before the Sarabun webfont has loaded, which
  // would measure and draw with a fallback face and then jump. Redraw once
  // it's actually in.
  useEffect(() => {
    if (fontsReady) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fontsReady]);

  // Stay on a page that still exists if entries shrink the document.
  useEffect(() => {
    if (pageIndex >= layout.pageCount) setPageIndex(Math.max(0, layout.pageCount - 1));
  }, [pageIndex, layout.pageCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scale = PREVIEW_WIDTH / layout.width;
    const dpr = window.devicePixelRatio || 1;
    const cssHeight = layout.height * scale;

    canvas.style.width = `${PREVIEW_WIDTH}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(PREVIEW_WIDTH * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    context.clearRect(0, 0, layout.width, layout.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, layout.width, layout.height);

    const left = layout.margin;
    const right = layout.width - layout.margin;
    // Canvas draws from the top down; the layout's y is from the bottom up.
    const flip = (y: number) => layout.height - y;

    const regularFont = (size: number) => `${size}px Sarabun, sans-serif`;
    const boldFont = (size: number) => `bold ${size}px Sarabun, sans-serif`;

    context.textBaseline = 'alphabetic';
    context.fillStyle = INK;

    const rows = layout.pages[pageIndex] ?? [];

    if (pageIndex === 0 && heading.trim() !== '') {
      context.font = boldFont(layout.headingSize);
      const headingWidth = context.measureText(heading).width;
      context.fillText(heading, left + Math.max(0, (right - left - headingWidth) / 2), flip(layout.headingY));

      const ruleY = flip(layout.headingY - layout.headingSize * 0.4);
      context.strokeStyle = RULE;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, ruleY);
      context.lineTo(right, ruleY);
      context.stroke();
    }

    context.font = regularFont(layout.fontSize);
    const dotWidth = context.measureText('.').width;

    for (const row of rows) {
      const number = String(row.pageNumber);
      context.font = regularFont(layout.fontSize);
      const numberWidth = context.measureText(number).width;

      context.font = boldFont(layout.fontSize);
      const titleSpace = right - left - numberWidth - dotWidth * 4;
      const title = fitTitle(row.entry.title || '(untitled)', titleSpace, (text) => {
        context.font = boldFont(layout.fontSize);
        return context.measureText(text).width;
      });
      const titleWidth = context.measureText(title).width;

      context.fillStyle = INK;
      context.font = boldFont(layout.fontSize);
      context.fillText(title, left, flip(row.y));

      context.font = regularFont(layout.fontSize);
      context.fillText(number, right - numberWidth, flip(row.y));

      const dots = computeDotLeader(left + titleWidth + dotWidth, right - numberWidth - dotWidth, dotWidth);
      if (dots) {
        context.fillStyle = DOTS;
        context.fillText(dots, left + titleWidth + dotWidth, flip(row.y));
        context.fillStyle = INK;
      }
    }
  }, [layout, heading, pageIndex, fontsReady]);

  return (
    <div className="toc-preview">
      <div className="toc-preview-page">
        <canvas ref={canvasRef} aria-label="Contents page preview" />
      </div>
      {layout.pageCount > 1 ? (
        <div className="toc-preview-pager">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous contents page"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
          >
            ◀
          </button>
          <span className="hint">
            Page {pageIndex + 1} of {layout.pageCount}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next contents page"
            disabled={pageIndex >= layout.pageCount - 1}
            onClick={() => setPageIndex((index) => Math.min(layout.pageCount - 1, index + 1))}
          >
            ▶
          </button>
        </div>
      ) : null}
    </div>
  );
}
