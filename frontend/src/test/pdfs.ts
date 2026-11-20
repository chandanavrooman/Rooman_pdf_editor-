import { PDFDocument, PDFName, PDFString, PDFNumber, PDFArray, PDFDict, StandardFonts, degrees, rgb } from 'pdf-lib'

/** Build a real multi-page PDF; page i contains the text "Page i of N <label>". */
export async function makePdf(pages: number, opts: { label?: string; size?: [number, number]; rotations?: number[]; filler?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage(opts.size ?? [595, 842])
    page.drawText(`Page ${i} of ${pages}${opts.label ? ' ' + opts.label : ''}`, { x: 50, y: page.getHeight() - 80, size: 24, font, color: rgb(0, 0, 0) })
    for (let k = 0; k < (opts.filler ?? 0); k++) page.drawText(`filler ${i}-${k} ` + 'lorem ipsum dolor sit amet '.repeat(3), { x: 50, y: 700 - k * 12, size: 8, font })
    if (opts.rotations?.[i - 1]) page.setRotation(degrees(opts.rotations[i - 1]))
  }
  return doc.save()
}

/** PDF with a bookmark tree: titles -> 0-based page index. */
export async function makePdfWithBookmarks(pages: number, marks: { title: string; page: number }[]): Promise<Uint8Array> {
  const bytes = await makePdf(pages)
  const doc = await PDFDocument.load(bytes)
  const ctx = doc.context
  const root = ctx.obj({ Type: 'Outlines' }) as PDFDict
  const rootRef = ctx.register(root)
  const refs = marks.map(() => ctx.nextRef())
  marks.forEach((m, i) => {
    const dict = ctx.obj({
      Title: PDFString.of(m.title),
      Parent: rootRef,
      Dest: ctx.obj([doc.getPage(m.page).ref, PDFName.of('Fit')]) as PDFArray,
    }) as PDFDict
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1])
    if (i < marks.length - 1) dict.set(PDFName.of('Next'), refs[i + 1])
    ctx.assign(refs[i], dict)
  })
  root.set(PDFName.of('First'), refs[0])
  root.set(PDFName.of('Last'), refs[refs.length - 1])
  root.set(PDFName.of('Count'), PDFNumber.of(marks.length))
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
  return doc.save()
}
