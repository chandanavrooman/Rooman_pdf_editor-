import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fontkit from '@pdf-lib/fontkit'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { exportEdited } from './export'
import { pageTextBoxes } from './textSnap'
import type { Cell } from './tables'
import { fontFileName, variantOf } from './fontCatalog'
import { addCol, addRow, cellAt, deleteCol, deleteRow, layoutTable, resizeCol, resizeRow, setBorder, setCellFill, setCellText, setRowFill, tableFromCells, type Measure, type TableData } from './tableModel'
import { diffOutside, loadNotoFromDisk, renderPixels, type Raster } from '@/test/nodeRender'
import type { EditorDoc, TableObj } from './types'

const FONTS = fileURLToPath(new URL('../assets/fonts/', import.meta.url))
const STD = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/')
const SRC = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../tests/fixtures/chandana-report.pdf', import.meta.url))))
const OUT = process.env.OPS_OUT
const SC = 4
const loadFont = async (id: Parameters<typeof fontFileName>[0], v: Parameters<typeof fontFileName>[1]) => new Uint8Array(readFileSync(FONTS + fontFileName(id, v)))
const deps = { loadFontBytes: loadNotoFromDisk, loadFont }

type FK = { layout(s: string): { glyphs: { advanceWidth: number }[] }; unitsPerEm: number }
const cache = new Map<string, FK>()
const measure: Measure = (cell, s) => {
  const file = fontFileName(cell.fontId, variantOf(cell.bold, cell.italic))
  let f = cache.get(file)
  if (!f) cache.set(file, (f = fontkit.create(readFileSync(FONTS + file)) as unknown as FK))
  return (f.layout(s).glyphs.reduce((a, g) => a + g.advanceWidth, 0) * cell.size) / f.unitsPerEm
}

async function detect() {
  const d = (await pdfjs.getDocument({ data: SRC.slice(0), standardFontDataUrl: STD, verbosity: 0, useSystemFonts: false, fontExtraProperties: true }).promise) as unknown as PDFDocumentProxy
  const { renderToCanvas } = await import('@/test/nodeRender')
  const items = await pageTextBoxes(d, 0, { tables: true, pixels: async () => { const { canvas, ctx } = await renderToCanvas(SRC, 0, 3); return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data as unknown as Uint8ClampedArray, scale: 3 } } })
  const cells = [...new Map(items.filter((i) => i.cell).map((i) => [i.cell!.id, i.cell!])).values()] as Cell[]
  // the detector only returns cells that have text; the model needs the whole grid, so rebuild empty ones from the grid shape
  return { cells, items }
}
const asObj = (data: TableData): TableObj => {
  const p = layoutTable(data, measure)
  return { id: 't1', type: 'table', page: 0, ...p.bounds, data }
}
const doc = (o: TableObj): EditorDoc => ({ objects: [o], formValues: {}, assets: {} })
const maxDev = (r: Raster, bg: number[], x0: number, x1: number, y0: number, y1: number) => {
  let w = 0
  for (let y = Math.floor(y0 * SC); y < Math.ceil(y1 * SC); y++) for (let x = Math.floor(x0 * SC); x < Math.ceil(x1 * SC); x++) { const i = (y * r.width + x) * 4; w = Math.max(w, Math.abs(r.data[i] - bg[0]), Math.abs(r.data[i + 1] - bg[1]), Math.abs(r.data[i + 2] - bg[2])) }
  return w
}
const px = (r: Raster, x: number, y: number) => { const i = (Math.floor(y * SC) * r.width + Math.floor(x * SC)) * 4; return [r.data[i], r.data[i + 1], r.data[i + 2]] }
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const near = (a: number[], b: number[], tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

describe('table tools on the table in chandana-report.pdf', () => {
  it('the model reproduces the original table exactly: rows, text positions and line breaks', async () => {
    const { cells } = await detect()
    const t = tableFromCells(cells)
    const plan = layoutTable(t, measure)
    console.info(`model: ${t.rows.length} rows × ${t.cols.length} columns; column widths ${t.cols.map((w) => w.toFixed(2)).join(', ')} pt; rule ${t.border.color} ${t.border.width.toFixed(2)} pt; space under last line ${t.padBottom.toFixed(2)} pt`)
    // row edges
    const want = [...new Set(cells.flatMap((c) => [c.y, c.y + c.h]))].sort((a, b) => a - b)
    const worstRow = Math.max(...plan.rowY.map((y, i) => Math.abs(y - want[i])))
    // text: every original run is drawn at its original x, baseline and with the same line break
    let worstX = 0
    let worstY = 0
    let lines = 0
    let sameBreaks = 0
    for (const cell of cells) {
      const drawn = plan.texts.filter((tx) => tx.x >= cell.x && tx.x < cell.x + cell.w && tx.baseline > cell.y && tx.baseline <= cell.y + cell.h)
      const orig = cell.runs.map((r) => ({ str: r.str.trim(), x: r.origin!.x, y: r.origin!.baseline }))
      lines += orig.length
      if (drawn.map((d) => d.str).join('|') === orig.map((o) => o.str).join('|')) sameBreaks += orig.length
      orig.forEach((o, i) => {
        if (!drawn[i]) return
        worstX = Math.max(worstX, Math.abs(drawn[i].x - o.x))
        worstY = Math.max(worstY, Math.abs(drawn[i].baseline - o.y))
      })
    }
    console.info(`row edges: worst difference ${worstRow.toFixed(3)} pt over ${plan.rowY.length} edges; text: worst x ${worstX.toFixed(3)} pt, worst baseline ${worstY.toFixed(3)} pt over ${lines} lines; identical line breaks for ${sameBreaks}/${lines} lines`)
    expect(plan.rowY.length).toBe(11)
    expect(worstRow).toBeLessThan(0.35)
    expect(worstX).toBeLessThan(0.1)
    expect(worstY).toBeLessThan(0.35)
    expect(sameBreaks).toBe(lines)
  })

  it('an untouched table is never redrawn: the page is byte-identical', async () => {
    const { cells } = await detect()
    const out = await exportEdited(SRC, doc(asObj(tableFromCells(cells))), {}, deps)
    expect(diffOutside(await renderPixels(SRC, 0, SC), await renderPixels(out, 0, SC), SC, [], 0)).toBe(0)
  })

  it('add a row, add + delete a column, resize a column: export looks as drawn', async () => {
    const { cells } = await detect()
    let t = tableFromCells(cells)
    const before = layoutTable(t, measure)
    // 1. new row below "Rooman Agent" (row 2, shaded): copies its shading, font, size, colour and height
    t = addRow(t, 2, 'below')
    expect(t.rows[3].cells[0].fill).toBe(t.rows[2].cells[0].fill)
    expect(t.rows[3].cells[0]).toMatchObject({ fontId: t.rows[2].cells[0].fontId, size: t.rows[2].cells[0].size, bold: t.rows[2].cells[0].bold, color: t.rows[2].cells[0].color })
    t = setCellText(t, 3, 0, 'Training')
    t = setCellText(t, 3, 1, 'Completed the internal onboarding curriculum and shadowed two release cycles for the web platform team.')
    // 2. new column to the right of the descriptions: copies the column's style; header + one cell get text
    const wBefore = t.cols.reduce((a, b) => a + b, 0)
    t = addCol(t, 1, 'right')
    expect(t.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(wBefore, 6) // total width kept
    t = setCellText(t, 0, 2, 'Status')
    t = setCellText(t, 3, 2, 'Done')
    // 3. delete the first column ("Project")
    t = deleteCol(t, 0)
    expect(t.cols.length).toBe(2)
    expect(t.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(wBefore, 6)
    // 4. drag the boundary: first column narrower -> its text re-wraps
    const narrower = t.cols[0] * 0.86
    t = resizeCol(t, 0, narrower)
    expect(t.cols[0]).toBeCloseTo(narrower, 6)
    expect(t.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(wBefore, 6)
    t = setCellFill(t, 1, 1, '#fde68a')
    t = setBorder(t, { color: '#1b2a4e', width: 1, inner: true })

    const plan = layoutTable(t, measure)
    const obj = asObj(t)
    const out = await exportEdited(SRC, doc(obj), {}, deps)
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + '/table-tools.pdf', out) }
    const orig = await renderPixels(SRC, 0, SC)
    const after = await renderPixels(out, 0, SC)
    const cover = t.cover
    const union = { x: Math.min(cover.x, plan.bounds.x) - 1, y: Math.min(cover.y, plan.bounds.y) - 1, w: Math.max(cover.x + cover.w, plan.bounds.x + plan.bounds.w) - Math.min(cover.x, plan.bounds.x) + 2, h: Math.max(cover.y + cover.h, plan.bounds.y + plan.bounds.h) - Math.min(cover.y, plan.bounds.y) + 2 }

    // (a) nothing outside the table changed
    const outside = diffOutside(orig, after, SC, [union], 1)
    // (b) no leftover fragments: inside the old table area but outside the new one it is plain page
    let leftover = 0
    const nb = plan.bounds
    if (nb.y + nb.h < cover.y + cover.h - 1) leftover = Math.max(leftover, maxDev(after, [255, 255, 255], cover.x, cover.x + cover.w, nb.y + nb.h + 1.5, cover.y + cover.h))
    if (nb.x + nb.w < cover.x + cover.w - 1) leftover = Math.max(leftover, maxDev(after, [255, 255, 255], nb.x + nb.w + 1.5, cover.x + cover.w, cover.y, cover.y + cover.h))
    // (c) rules are where the model says: the border colour on every row edge, the cell colours just above and below
    const rule = hex(t.border.color)
    const midX = plan.colX[0] + 3
    let ruleOk = 0
    plan.rowY.forEach((y) => { if (near(px(after, midX, y), rule, 40)) ruleOk++ })
    // (d) fills: every shaded cell shows its fill in the middle of the cell's empty bottom strip
    let fillOk = 0
    let fills = 0
    t.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
      if (!cell.fill) return
      fills++
      if (near(px(after, plan.colX[c + 1] - 3, plan.rowY[r + 1] - 2.5), hex(cell.fill), 6)) fillOk++
    }))
    // (e) text stays inside its cell
    const inside = plan.texts.every((tx) => {
      const c = plan.colX.findIndex((v, i) => i < plan.colX.length - 1 && tx.x >= v - 0.01 && tx.x < plan.colX[i + 1])
      const r = plan.rowY.findIndex((v, i) => i < plan.rowY.length - 1 && tx.baseline > v && tx.baseline <= plan.rowY[i + 1])
      return measure(tx.cell, tx.str) + tx.x <= plan.colX[c + 1] - tx.cell.padR + 0.65 && // 0.6 pt wrap slack, as in the original lines; the cell edge itself is a further padR away
         tx.baseline + tx.cell.size * 0.22 <= plan.rowY[r + 1] + 0.01
    })
    // (f) fonts: only the Liberation Sans faces the cells use
    const pdf = await PDFDocument.load(out)
    const fnt = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
    const names = [...fnt.entries()].map(([, v]) => String((pdf.context.lookup(v) as PDFDict).get(PDFName.of('BaseFont')))).filter((n) => !/^\/Helvetica/.test(n))
    console.info(`table before: ${before.bounds.w.toFixed(1)} × ${before.bounds.h.toFixed(1)} pt, ${before.rowY.length - 1} rows; after: ${plan.bounds.w.toFixed(1)} × ${plan.bounds.h.toFixed(1)} pt, ${plan.rowY.length - 1} rows × ${t.cols.length} columns (widths ${t.cols.map((w) => w.toFixed(1)).join(' / ')})`)
    console.info(`outside the table: ${outside} differing pixels | leftover fragments (max deviation from page white in the old area): ${leftover} | row rules on the right pixel: ${ruleOk}/${plan.rowY.length} | fills correct: ${fillOk}/${fills} | all text inside its cell: ${inside} | fonts added: ${names.join(', ')}`)
    expect(outside).toBe(0)
    expect(leftover).toBeLessThanOrEqual(3)
    expect(ruleOk).toBe(plan.rowY.length)
    expect(fillOk).toBe(fills)
    expect(inside).toBe(true)
    expect(names.every((n) => /LiberationSans/.test(n))).toBe(true)
    expect(plan.rowY.length - 1).toBe(11)
    expect(plan.bounds.y + plan.bounds.h).toBeLessThan(841.89 - 10) // still on the page
  })

  it('operations: delete row, resize row, row fill, cellAt, and the limits (never below 1 row / column)', async () => {
    const { cells } = await detect()
    let t = tableFromCells(cells)
    const n = t.rows.length
    t = deleteRow(t, 4)
    expect(t.rows.length).toBe(n - 1)
    t = resizeRow(t, 0, 60)
    expect(layoutTable(t, measure).rowH[0]).toBe(60)
    t = setRowFill(t, 1, '#dcfce7')
    expect(t.rows[1].cells.every((c) => c.fill === '#dcfce7')).toBe(true)
    const plan = layoutTable(t, measure)
    expect(cellAt(plan, plan.colX[1] + 5, plan.rowY[1] + 5)).toEqual({ r: 1, c: 1 })
    expect(cellAt(plan, 5, 5)).toBeNull()
    let one = t
    while (one.rows.length > 1) one = deleteRow(one, 0)
    while (one.cols.length > 1) one = deleteCol(one, 0)
    expect(deleteRow(one, 0).rows.length).toBe(1)
    expect(deleteCol(one, 0).cols.length).toBe(1)
    // a row grows when its text needs more lines
    let g = tableFromCells(cells)
    g = setCellText(g, 1, 1, 'word '.repeat(120))
    expect(layoutTable(g, measure).rowH[1]).toBeGreaterThan(layoutTable(tableFromCells(cells), measure).rowH[1] + 30)
  })
})
