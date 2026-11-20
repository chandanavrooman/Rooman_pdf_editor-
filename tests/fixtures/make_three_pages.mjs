// Builds tests/fixtures/three-pages.pdf (A4, 3 pages) with pdf-lib. Run: node tests/fixtures/make_three_pages.mjs
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const doc = await PDFDocument.create()
const reg = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
for (let n = 1; n <= 3; n++) {
  const p = doc.addPage([595.28, 841.89])
  p.drawRectangle({ x: 60, y: 700, width: 475, height: 60, color: rgb(0.106, 0.165, 0.306) })
  p.drawText(`Chapter ${n}`, { x: 76, y: 724, size: 24, font: bold, color: rgb(1, 1, 1) })
  p.drawText(`This is page ${n} of 3`, { x: 60, y: 670, size: 14, font: reg, color: rgb(0.2, 0.2, 0.2) })
  for (let i = 0; i < 18; i++) p.drawText(`Line ${i + 1} on page ${n}: the quick brown fox jumps over the lazy dog.`, { x: 60, y: 640 - i * 18, size: 11, font: reg })
  p.drawRectangle({ x: 60, y: 120, width: 475, height: 150, color: rgb(0.949, 0.961, 0.984), borderColor: rgb(0.31, 0.38, 0.62), borderWidth: 1 })
  p.drawText(`Shaded box ${n}`, { x: 76, y: 240, size: 12, font: bold, color: rgb(0.18, 0.29, 0.62) })
  p.drawText(`Last line of page ${n} (near the bottom)`, { x: 60, y: 70, size: 11, font: reg, color: rgb(0.2, 0.2, 0.2) })
}
writeFileSync(fileURLToPath(new URL('./three-pages.pdf', import.meta.url)), await doc.save())
console.log('wrote three-pages.pdf')
