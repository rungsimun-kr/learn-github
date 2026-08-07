/** A contiguous (or single-page) selection of pages, parsed from user input. */
export interface PageRange {
  /** Normalised token, used to name the downloaded file. */
  label: string;
  /** 0-based page indices, in the order the user asked for them. */
  indices: number[];
}

const RANGE_RE = /^(\d*)\s*[-–]\s*(\d*)$/;

/**
 * Parse a page-range expression such as `1-5, 8, 10-12` into groups of 0-based
 * page indices, one group per comma-separated token.
 *
 * Accepted tokens, given a document of `pageCount` pages:
 *   `7`     a single page
 *   `2-6`   an ascending range, inclusive at both ends
 *   `6-2`   a descending range — the pages come out reversed
 *   `4-`    from page 4 to the last page
 *   `-4`    from the first page to page 4
 *
 * Throws an `Error` with a message meant to be shown to the user.
 */
export function parseRanges(input: string, pageCount: number): PageRange[] {
  if (pageCount < 1) throw new Error('There are no pages to select from.');

  const tokens = input
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new Error('Enter at least one page or range, for example "1-5, 8".');
  }

  return tokens.map((token) => parseToken(token, pageCount));
}

function parseToken(token: string, pageCount: number): PageRange {
  const inBounds = (page: number, raw: string) => {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(
        `"${raw}" is outside this document — it has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
      );
    }
    return page;
  };

  const rangeMatch = token.match(RANGE_RE);
  if (rangeMatch) {
    const [, rawStart, rawEnd] = rangeMatch;
    if (rawStart === '' && rawEnd === '') {
      throw new Error(`"${token}" is not a valid range. Try something like "2-6".`);
    }
    const start = rawStart === '' ? 1 : inBounds(Number(rawStart), token);
    const end = rawEnd === '' ? pageCount : inBounds(Number(rawEnd), token);

    const step = start <= end ? 1 : -1;
    const indices: number[] = [];
    for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
      indices.push(page - 1);
    }
    return { label: `${start}-${end}`, indices };
  }

  if (/^\d+$/.test(token)) {
    const page = inBounds(Number(token), token);
    return { label: String(page), indices: [page - 1] };
  }

  throw new Error(`"${token}" is not a page or a range. Use numbers like "3" or "4-9".`);
}

/** Split a document into consecutive chunks of at most `size` pages each. */
export function chunkEvery(pageCount: number, size: number): PageRange[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Pages per file must be a whole number of 1 or more.');
  }
  const ranges: PageRange[] = [];
  for (let start = 0; start < pageCount; start += size) {
    const end = Math.min(start + size, pageCount);
    const indices: number[] = [];
    for (let i = start; i < end; i++) indices.push(i);
    ranges.push({ label: end - start === 1 ? `${end}` : `${start + 1}-${end}`, indices });
  }
  return ranges;
}

/** One range per page — the "split every page into its own file" mode. */
export function eachPage(pageCount: number): PageRange[] {
  return Array.from({ length: pageCount }, (_, i) => ({
    label: String(i + 1),
    indices: [i],
  }));
}
