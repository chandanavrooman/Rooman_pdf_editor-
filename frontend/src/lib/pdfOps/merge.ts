import { PDFDocument } from 'pdf-lib'
import { loadDoc, noProgress, pdfSave, PdfOpError, type OpFile, type ProgressFn } from './common'

/** Merge PDFs in the given order. */
export async function mergePdfs(files: OpFile[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  if (files.length < 2) throw new PdfOpError('Add at least two PDF files to merge.')
  const out = await PDFDocument.create()
  for (let i = 0; i < files.length; i++) {
    onProgress(i / files.length, `Adding ${files[i].name}`)
    const src = await loadDoc(files[i].bytes, `"${files[i].name}"`)
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  onProgress(0.95, 'Saving')
  const bytes = await pdfSave(out)
  onProgress(1)
  return bytes
}
