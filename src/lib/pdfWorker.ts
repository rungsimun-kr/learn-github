/**
 * Entry point for the pdf.js worker.
 *
 * We bundle our own worker module rather than pointing `workerSrc` at the file
 * pdf.js ships, so the language polyfill is installed inside the worker thread
 * too — the worker does the bulk of the parsing and hits those methods first.
 */
import './mapPolyfill';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
