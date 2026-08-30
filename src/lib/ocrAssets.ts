/**
 * Where the OCR engine's binaries live.
 *
 * tesseract.js defaults to pulling its worker, WASM core and language data off
 * a CDN. We serve our own copies from `public/tesseract/` instead: the app then
 * works offline, and nothing about a document's contents implies a third-party
 * request while it is being read.
 *
 * These have to be **absolute** URLs. `corePath` and `langPath` are consumed
 * inside the web worker, where a relative path would resolve against the
 * worker's own location (`/tesseract/`) rather than the page's.
 */
function asset(path: string): string {
  return new URL(`tesseract/${path}`, document.baseURI).href;
}

export const OCR_ASSETS = {
  get workerPath() {
    return asset('worker.min.js');
  },
  /**
   * A directory, not a file: tesseract.js appends the variant it picks after
   * feature-detecting SIMD, so all three LSTM cores are vendored beside it.
   */
  get corePath() {
    return asset('');
  },
  get langPath() {
    return asset('tessdata');
  },
} as const;

export const OCR_LANGUAGES = [
  { value: 'tha+eng', label: 'Thai + English' },
  { value: 'tha', label: 'Thai only' },
  { value: 'eng', label: 'English only' },
] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]['value'];
