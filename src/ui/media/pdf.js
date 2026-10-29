// pdf.js for viewing PDF files (proposals/2026-10-29-pdf-and-picture-files.md).
// The phone's page only runs scripts that are part of the bundle, so pdf.js
// cannot start its own worker: its worker code is bundled too and runs on
// the page (pdf.js uses globalThis.pdfjsWorker when it is set). The legacy
// build carries what older WebViews lack.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as worker from 'pdfjs-dist/legacy/build/pdf.worker.mjs'

globalThis.pdfjsWorker = worker

// A PDF from its bytes, with close() to free it. pdf.js takes ownership of
// the buffer, so it gets a copy.
export async function openPdf (bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false })
  const pdf = await task.promise
  pdf.close = () => task.destroy()
  return pdf
}
