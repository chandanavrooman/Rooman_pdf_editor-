import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pageTextBoxes } from './textSnap'
import { analyzeOps } from './pdfOps'
import type { Cell } from './tables'

const STD = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/')
const FIX = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/${n}`, import.meta.url))))
const open = (b: Uint8Array) => pdfjs.getDocument({ data: b.slice(0), standardFontDataUrl: STD, verbosity: 0, useSystemFonts: false }).promise as unknown as Promise<PDFDocumentProxy>

describe('5 table detection on chandana-report.pdf', () => {
  it('reads the filled row bands (and the ruled lines) from the page', async () => {
    const d = await open(FIX('chandana-report.pdf'))
    const page = await d.getPage(1)
    const { shapes } = await analyzeOps(page, page.getViewport({ scale: 1 }))
    console.info(`shapes: ${shapes.rects.length} filled rects, ${shapes.hlines.length} horizontal rules, ${shapes.vlines.length} vertical rules`)
    console.info('rect rows (page space y, h, colour):', shapes.rects.map((r) => `${r.y.toFixed(1)}/${r.h.toFixed(1)}/${r.color}`).join('  '))
    expect(shapes.rects.length).toBeGreaterThanOrEqual(10)
    expect(shapes.hlines.length).toBeGreaterThanOrEqual(10)
  })

  it('cuts the table into 10 rows × 2 columns and gives every run its cell', async () => {
    const d = await open(FIX('chandana-report.pdf'))
    const items = await pageTextBoxes(d, 0, { tables: true, pixels: async () => null })
    const cells = new Map<string, Cell>()
    for (const it of items) if (it.cell) cells.set(it.cell.id, it.cell)
    const list = [...cells.values()].sort((a, b) => a.row - b.row || a.col - b.col)
    console.info(`detected ${list.length} cells with text; grid ${list[0].rows} rows × ${list[0].cols} columns (${list[0].how})`)
    for (const c of list) console.info(`  R${c.row + 1}·C${c.col + 1}  x ${c.x.toFixed(1)}–${(c.x + c.w).toFixed(1)}  y ${c.y.toFixed(1)}–${(c.y + c.h).toFixed(1)}  fill ${c.fill}  ${c.runs.length} line(s): ${c.runs.map((r) => r.str).join(' / ').slice(0, 90)}`)
    expect(list[0].rows).toBe(10)
    expect(list[0].cols).toBe(2)
    expect(list).toHaveLength(20)
    // the title is NOT part of the table
    expect(items.find((i) => i.str === 'Work Report')?.cell).toBeUndefined()
    // header
    expect(list[0].runs.map((r) => r.str)).toEqual(['Project'])
    expect(list[1].runs.map((r) => r.str)).toEqual(['Key Contributions & Deliverables'])
    // the "Dashboard…WCAG" line lives in the same cell as the two lines around it
    const dash = items.find((i) => i.str.startsWith('Dashboard, Universal'))!
    expect(dash.cell?.runs.map((r) => r.str.slice(0, 10))).toEqual(['Core front', 'Dashboard,', '2.1 AA), a'])
    expect(dash.cell?.row).toBe(1)
    expect(dash.cell?.col).toBe(1)
    // the shaded rows are recognised as shaded cells
    const agent = items.find((i) => i.str === 'Rooman Agent')!
    expect(agent.cell?.fill?.toLowerCase()).toBe('#f2f5fb')
    expect(items.find((i) => i.str === 'Books')?.cell?.fill?.toLowerCase()).toBe('#ffffff')
    // a two-line project name stays together
    expect(items.find((i) => i.str === 'BOS (Business Operating')?.cell?.runs.map((r) => r.str)).toEqual(['BOS (Business Operating', 'System)'])
    // inner width of the right column = what the original text wrapped to (≈318.5pt)
    const inner = dash.cell!.x + dash.cell!.w - dash.cell!.padR - dash.origin!.x
    console.info(`right column inner width ${inner.toFixed(2)}pt (original lines wrap at 318.5pt)`)
    expect(Math.abs(inner - 318.5)).toBeLessThan(1)
  })

  it('a page without a table has no cells', async () => {
    const d = await open(FIX('single.pdf'))
    const items = await pageTextBoxes(d, 0, { tables: true, pixels: async () => null })
    expect(items.some((i) => i.cell)).toBe(false)
  })
})
