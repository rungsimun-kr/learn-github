import {
  PDFArray,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { LoadedDoc, PageItem } from '../types';
import { uid } from './uid';

/**
 * One line in the contents.
 *
 * The target is a `PageItem.id`, never a position. An entry tied to a position
 * would point at the wrong page the moment anything is dragged; tied to the
 * page itself it follows the page around, the same way annotations do.
 */
export interface TocEntry {
  id: string;
  title: string;
  pageId: string;
}

export interface TocSettings {
  heading: string;
  entries: TocEntry[];
  /** Add the visible contents page(s) to the front. */
  addPage: boolean;
  /** Add the bookmarks that show in a reader's sidebar. */
  addBookmarks: boolean;
}

export const DEFAULT_TOC_HEADING = 'Contents';

export function emptyToc(): TocSettings {
  return { heading: DEFAULT_TOC_HEADING, entries: [], addPage: true, addBookmarks: true };
}

/**
 * One entry per source file, pointing at that file's first page.
 *
 * Free, because every page already records which file it came from — merging
 * five documents gives five entries without anyone typing anything.
 */
export function seedFromFiles(
  pages: readonly PageItem[],
  docs: ReadonlyMap<string, Pick<LoadedDoc, 'name'>>,
): TocEntry[] {
  const seen = new Set<string>();
  const entries: TocEntry[] = [];

  for (const page of pages) {
    if (seen.has(page.docId)) continue;
    seen.add(page.docId);
    entries.push({
      id: uid('toc'),
      title: stripExtension(docs.get(page.docId)?.name ?? 'Untitled'),
      pageId: page.id,
    });
  }
  return entries;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || name;
}

export interface TocLayoutOptions {
  fontSize?: number;
  headingSize?: number;
  margin?: number;
}

export interface TocRow {
  entry: TocEntry;
  /** 1-based page number as printed, counting the contents pages themselves. */
  pageNumber: number;
  /** Index into the *content* page list, before the contents pages are added. */
  contentIndex: number;
  /** Baseline of the row, in points from the bottom of the page. */
  y: number;
}

export interface TocLayout {
  /** How many contents pages are needed. */
  pageCount: number;
  /** Rows for each contents page, in order. */
  pages: TocRow[][];
  fontSize: number;
  headingSize: number;
  margin: number;
  /** Baseline of the heading on the first contents page. */
  headingY: number;
  width: number;
  height: number;
  /** Entries whose page is gone, and which were therefore left out. */
  dropped: number;
}

/**
 * Work out how many contents pages are needed and what goes on each.
 *
 * The page count has to be settled before any number is printed, because the
 * contents pages push everything after them down — a two-page contents means
 * the first chapter is on page 3, not page 1. Keeping this pure is what lets
 * that arithmetic be tested directly, which is where the off-by-one would be.
 */
export function layoutToc(
  entries: readonly TocEntry[],
  pages: readonly PageItem[],
  size: { width: number; height: number },
  options: TocLayoutOptions = {},
): TocLayout {
  const fontSize = options.fontSize ?? 12;
  const headingSize = options.headingSize ?? 22;
  const margin = options.margin ?? 64;

  // A little more than double gives the list room to breathe, which is most
  // of what makes a page read as typeset rather than printed in a hurry.
  const rowHeight = fontSize * 2.3;
  const headingY = size.height - margin - headingSize;
  // The heading only takes room on the first page; give every page the same
  // usable band so a row never lands under the heading.
  const firstRowY = headingY - headingSize - fontSize;
  const usable = firstRowY - margin;
  const perPage = Math.max(1, Math.floor(usable / rowHeight) + 1);

  const positions = new Map(pages.map((page, index) => [page.id, index]));
  const resolved = entries
    .map((entry) => ({ entry, contentIndex: positions.get(entry.pageId) }))
    .filter(
      (row): row is { entry: TocEntry; contentIndex: number } => row.contentIndex !== undefined,
    );

  // A contents list reads in page order, so the numbers down the right-hand
  // side ascend. Sorting here means the dialog needs no reordering controls.
  resolved.sort((left, right) => left.contentIndex - right.contentIndex);

  const dropped = entries.length - resolved.length;
  const pageCount = Math.max(1, Math.ceil(resolved.length / perPage));

  const laid: TocRow[][] = [];
  for (let index = 0; index < pageCount; index++) {
    const slice = resolved.slice(index * perPage, (index + 1) * perPage);
    laid.push(
      slice.map((row, position) => ({
        entry: row.entry,
        contentIndex: row.contentIndex,
        // The printed number counts the contents pages, matching what the
        // reader's own page counter will say.
        pageNumber: row.contentIndex + pageCount + 1,
        y: firstRowY - position * rowHeight,
      })),
    );
  }

  return {
    pageCount,
    pages: laid,
    fontSize,
    headingSize,
    margin,
    headingY,
    width: size.width,
    height: size.height,
    dropped,
  };
}

/** Trim a title to fit, ending in an ellipsis rather than running off the line. */
export function fitTitle(
  title: string,
  maxWidth: number,
  measure: (text: string) => number,
): string {
  if (measure(title) <= maxWidth) return title;

  let text = title;
  while (text.length > 1 && measure(`${text}…`) > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text.trimEnd()}…`;
}

/**
 * A destination at the top of a page.
 *
 * The zoom is null so the reader keeps whatever zoom the person chose, rather
 * than yanking it to some fixed value on every jump.
 */
function topOfPage(doc: PDFDocument, page: PDFPage): PDFArray {
  const dest = PDFArray.withContext(doc.context);
  dest.push(page.ref);
  dest.push(PDFName.of('XYZ'));
  dest.push(PDFNumber.of(0));
  dest.push(PDFNumber.of(page.getHeight()));
  dest.push(PDFNull);
  return dest;
}

/**
 * How many dots fill the gap between a title and its page number.
 *
 * Pulled out on its own so the live preview and the printed page compute the
 * same leader instead of two independent approximations that quietly drift
 * apart from each other.
 */
export function computeDotLeader(gapStart: number, gapEnd: number, dotWidth: number): string {
  if (gapEnd <= gapStart || dotWidth <= 0) return '';
  const count = Math.floor((gapEnd - gapStart) / dotWidth);
  return count > 0 ? '.'.repeat(count) : '';
}

/** Attach a clickable region to a page. */
function addLink(
  doc: PDFDocument,
  page: PDFPage,
  rect: [number, number, number, number],
  destination: PDFArray,
): void {
  const annotation = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    // No visible frame; the row itself is the affordance.
    Border: [0, 0, 0],
    A: doc.context.obj({ S: 'GoTo', D: destination }),
  });

  const existing = page.node.get(PDFName.of('Annots'));
  if (existing instanceof PDFArray) {
    existing.push(doc.context.register(annotation));
    return;
  }
  const annots = PDFArray.withContext(doc.context);
  annots.push(doc.context.register(annotation));
  page.node.set(PDFName.of('Annots'), annots);
}

/** The two weights a contents page draws with. */
export interface TocFonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * Draw the contents pages and insert them at the front.
 *
 * Called once the content pages exist, because only then are there refs to
 * link to. The heading and every title are set in the bold weight — that
 * contrast against the regular page numbers is what makes a title read as a
 * heading rather than another line in a list — and the heading is centred
 * over a thin rule, the two touches that make the page read as typeset
 * rather than a plain list.
 */
export function drawTocPages(
  doc: PDFDocument,
  layout: TocLayout,
  heading: string,
  fonts: TocFonts,
  targets: readonly PDFPage[],
): void {
  const measure = (text: string, size = layout.fontSize) =>
    fonts.regular.widthOfTextAtSize(text, size);
  const measureBold = (text: string, size = layout.fontSize) =>
    fonts.bold.widthOfTextAtSize(text, size);
  const left = layout.margin;
  const right = layout.width - layout.margin;
  const dotWidth = measure('.');
  const ink = rgb(0.1, 0.1, 0.1);

  layout.pages.forEach((rows, index) => {
    // Insert in order, so the first contents page ends up first.
    const page = doc.insertPage(index, [layout.width, layout.height]);
    page.setFont(fonts.regular);

    if (index === 0 && heading.trim() !== '') {
      const headingWidth = measureBold(heading, layout.headingSize);
      const headingX = left + Math.max(0, (right - left - headingWidth) / 2);
      page.drawText(heading, {
        x: headingX,
        y: layout.headingY,
        size: layout.headingSize,
        font: fonts.bold,
        color: ink,
      });

      const ruleY = layout.headingY - layout.headingSize * 0.4;
      page.drawLine({
        start: { x: left, y: ruleY },
        end: { x: right, y: ruleY },
        thickness: 1,
        color: rgb(0.75, 0.75, 0.75),
      });
    }

    for (const row of rows) {
      const number = String(row.pageNumber);
      const numberWidth = measure(number);
      // Titles are bold, so they measure against the bold font, not the one
      // the numbers and dots use.
      const titleSpace = right - left - numberWidth - dotWidth * 4;
      const title = fitTitle(row.entry.title, titleSpace, (text) => measureBold(text));
      const titleWidth = measureBold(title);

      page.drawText(title, {
        x: left,
        y: row.y,
        size: layout.fontSize,
        font: fonts.bold,
        color: ink,
      });
      page.drawText(number, {
        x: right - numberWidth,
        y: row.y,
        size: layout.fontSize,
        font: fonts.regular,
        color: ink,
      });

      const dots = computeDotLeader(left + titleWidth + dotWidth, right - numberWidth - dotWidth, dotWidth);
      if (dots) {
        page.drawText(dots, {
          x: left + titleWidth + dotWidth,
          y: row.y,
          size: layout.fontSize,
          font: fonts.regular,
          color: rgb(0.62, 0.62, 0.62),
        });
      }

      const target = targets[row.contentIndex];
      if (target) {
        // The whole row is the target, not just the words on it.
        addLink(
          doc,
          page,
          [left, row.y - layout.fontSize * 0.35, right, row.y + layout.fontSize],
          topOfPage(doc, target),
        );
      }
    }
  });
}

/**
 * Write the bookmark tree a reader shows in its sidebar.
 *
 * Titles go through `PDFHexString.fromText`: a PDF text string outside Latin-1
 * has to be UTF-16BE with a byte-order mark, and `PDFString.of` would quietly
 * turn Thai into mojibake.
 */
export function writeOutline(
  doc: PDFDocument,
  rows: ReadonlyArray<{ title: string; page: PDFPage }>,
): void {
  if (rows.length === 0) return;

  const outlines = doc.context.nextRef();
  const refs = rows.map(() => doc.context.nextRef());

  rows.forEach((row, index) => {
    const item = doc.context.obj({
      Title: PDFHexString.fromText(row.title),
      Parent: outlines,
      Dest: topOfPage(doc, row.page),
    });
    // Siblings are linked after the fact, since the first and last item each
    // lack one side of the chain.
    if (index > 0) item.set(PDFName.of('Prev'), refs[index - 1]);
    if (index < refs.length - 1) item.set(PDFName.of('Next'), refs[index + 1]);
    doc.context.assign(refs[index], item);
  });

  doc.context.assign(
    outlines,
    doc.context.obj({
      Type: 'Outlines',
      First: refs[0],
      Last: refs[refs.length - 1],
      Count: refs.length,
    }),
  );
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  // Open the sidebar, so the bookmarks are found rather than hidden.
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

export type { PDFRef };
