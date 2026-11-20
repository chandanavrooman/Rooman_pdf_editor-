import type { FontId } from './fontCatalog'
import { fontInfo } from './fontCatalog'
import type { Cell } from './tables'
import { wrapLines } from './textLayout'

/** One table cell as the user edits it. Style is per cell so new rows / columns can copy their neighbours exactly. */
export interface TCell {
  text: string
  /** shading (#rrggbb); undefined = no fill */
  fill?: string
  fontId: FontId
  size: number
  bold: boolean
  italic: boolean
  color: string
  /** line spacing in points */
  leading: number
  padL: number
  padR: number
  /** distance from the cell's top edge to the first baseline */
  firstBaseline: number
}
export interface TRow {
  /** the row is never shorter than this (the content can make it taller) */
  minH: number
  cells: TCell[]
}
export interface TableBorder {
  color: string
  width: number
  /** also draw the vertical rules between columns (the outer frame is always drawn) */
  inner: boolean
}
export interface TableData {
  /** column widths, left to right */
  cols: number[]
  rows: TRow[]
  border: TableBorder
  /** the area of the ORIGINAL table, blanked with `bg` before the table is drawn again */
  cover: { x: number; y: number; w: number; h: number; bg: string }
  /** top-left corner of the table */
  origin: { x: number; y: number }
  /** space between the last line of text and the bottom of the row */
  padBottom: number
  /** false until the user changes something: an untouched table is never redrawn */
  modified: boolean
}

export type Measure = (cell: TCell, s: string) => number

export interface TablePlan {
  cover: { x: number; y: number; w: number; h: number; bg: string }
  fills: { x: number; y: number; w: number; h: number; color: string }[]
  lines: { x0: number; y0: number; x1: number; y1: number; color: string; width: number }[]
  texts: { x: number; baseline: number; str: string; cell: TCell }[]
  colX: number[]
  rowY: number[]
  rowH: number[]
  bounds: { x: number; y: number; w: number; h: number }
}

const MIN_COL = 24
/** the original text wraps up to the very edge of the cell's text box; a hair of slack keeps its line breaks identical */
const WRAP_SLACK = 0.6
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
const copyCell = (c: TCell): TCell => ({ ...c })
const descent = (c: TCell) => fontInfo(c.fontId).desc * c.size

/** Lay the table out: wrapped lines per cell, row heights that fit the text, positions of every edge. */
export function layoutTable(t: TableData, measure: Measure): TablePlan {
  const colX = [t.origin.x]
  for (const w of t.cols) colX.push(colX[colX.length - 1] + w)
  const lines: string[][][] = t.rows.map((row) => row.cells.map((c, ci) => (c.text.trim() ? wrapLines(c.text, Math.max(8, t.cols[ci] - c.padL - c.padR + WRAP_SLACK), (s) => measure(c, s)) : [])))
  const rowH = t.rows.map((row, r) => {
    let need = row.minH
    row.cells.forEach((c, ci) => {
      const n = lines[r][ci].length
      if (n) need = Math.max(need, c.firstBaseline + (n - 1) * c.leading + Math.max(descent(c), t.padBottom))
    })
    return need
  })
  const rowY = [t.origin.y]
  for (const h of rowH) rowY.push(rowY[rowY.length - 1] + h)
  const W = sum(t.cols)
  const H = sum(rowH)
  const plan: TablePlan = { cover: t.cover, fills: [], lines: [], texts: [], colX, rowY, rowH, bounds: { x: t.origin.x, y: t.origin.y, w: W, h: H } }
  t.rows.forEach((row, r) =>
    row.cells.forEach((c, ci) => {
      if (c.fill) plan.fills.push({ x: colX[ci], y: rowY[r], w: t.cols[ci], h: rowH[r], color: c.fill })
    }),
  )
  const { color, width } = t.border
  // horizontal rules at every row edge, outer frame verticals, optional inner column rules
  for (const y of rowY) plan.lines.push({ x0: colX[0], y0: y, x1: colX[colX.length - 1], y1: y, color, width })
  plan.lines.push({ x0: colX[0], y0: rowY[0], x1: colX[0], y1: rowY[rowY.length - 1], color, width })
  plan.lines.push({ x0: colX[colX.length - 1], y0: rowY[0], x1: colX[colX.length - 1], y1: rowY[rowY.length - 1], color, width })
  if (t.border.inner) for (let i = 1; i < colX.length - 1; i++) plan.lines.push({ x0: colX[i], y0: rowY[0], x1: colX[i], y1: rowY[rowY.length - 1], color, width })
  t.rows.forEach((row, r) =>
    row.cells.forEach((c, ci) =>
      lines[r][ci].forEach((str, i) => {
        if (str) plan.texts.push({ x: colX[ci] + c.padL, baseline: rowY[r] + c.firstBaseline + i * c.leading, str, cell: c })
      }),
    ),
  )
  return plan
}

// ───────────────────────────────────────── building a table from detected cells

const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)

/** Build the editable model from the cells the detector found (all cells of ONE table, in any order). */
export function tableFromCells(cells: Cell[]): TableData {
  const rows = Math.max(...cells.map((c) => c.row)) + 1
  const cols = Math.max(...cells.map((c) => c.col)) + 1
  const at = (r: number, c: number) => cells.find((x) => x.row === r && x.col === c)!
  const colW = Array.from({ length: cols }, (_, c) => at(0, c).w)
  const rowH = Array.from({ length: rows }, (_, r) => at(r, 0).h)
  const x0 = at(0, 0).x
  const y0 = at(0, 0).y

  type Seed = Pick<TCell, 'fontId' | 'size' | 'bold' | 'italic' | 'color' | 'leading' | 'padL' | 'padR' | 'firstBaseline'>
  const seeds = new Map<string, Seed>()
  const ratio = cells[0].leadingRatio
  for (const cell of cells) {
    const f = cell.runs[0]
    if (!f?.origin || !f.fontId || !f.fontSize) continue
    const bl = cell.runs.map((q) => q.origin!.baseline)
    const gaps = bl.slice(1).map((b, i) => b - bl[i]).filter((g) => g > 4)
    seeds.set(`${cell.row},${cell.col}`, {
      fontId: f.fontId,
      size: f.fontSize,
      bold: !!f.bold,
      italic: !!f.italic,
      color: f.color ?? '#000000',
      leading: gaps.length ? median(gaps) : (ratio ?? 1.2) * f.fontSize,
      padL: Math.max(0, f.origin.x - cell.x),
      padR: cell.padR,
      firstBaseline: bl[0] - cell.y,
    })
  }
  // empty cells copy the nearest filled cell of their column (then of their row)
  const seedFor = (r: number, c: number): Seed => {
    const own = seeds.get(`${r},${c}`)
    if (own) return own
    for (let d = 1; d < Math.max(rows, cols); d++)
      for (const [rr, cc] of [[r + d, c], [r - d, c], [r, c + d], [r, c - d]]) {
        const s = seeds.get(`${rr},${cc}`)
        if (s) return s
      }
    return { fontId: 'liberation-sans', size: 10, bold: false, italic: false, color: '#000000', leading: 12, padL: 6, padR: 6, firstBaseline: 12 }
  }
  const tableRows: TRow[] = Array.from({ length: rows }, (_, r) => ({
    minH: rowH[r],
    cells: Array.from({ length: cols }, (_, c) => {
      const cell = at(r, c)
      return { text: cell.runs.map((q) => q.str.trim()).join(' '), fill: cell.fill && cell.fill.toLowerCase() !== '#ffffff' ? cell.fill : undefined, ...seedFor(r, c) }
    }),
  }))
  // space under the last line, as the original rows have it
  const pads: number[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cell = at(r, c)
      const s = seeds.get(`${r},${c}`)
      if (s && cell.runs.length) pads.push(rowH[r] - (s.firstBaseline + (cell.runs.length - 1) * s.leading))
    }
  const rule = cells[0].rule ?? { color: '#c8cdd8', width: 0.5 }
  const W = sum(colW)
  const H = sum(rowH)
  return {
    cols: colW,
    rows: tableRows,
    border: { color: rule.color, width: rule.width, inner: false },
    cover: { x: x0 - 1, y: y0 - 1, w: W + 2, h: H + 2, bg: '#ffffff' },
    origin: { x: x0, y: y0 },
    // the SMALLEST space the original rows leave under their text: no existing row ever has to grow, new content still gets room
    padBottom: Math.max(2, pads.length ? Math.min(...pads) : 6),
    modified: false,
  }
}

// ───────────────────────────────────────── operations (all return a NEW table; every one marks it modified)

const mod = (t: TableData, patch: Partial<TableData>): TableData => ({ ...t, ...patch, modified: true })
const blank = (c: TCell): TCell => ({ ...copyCell(c), text: '' })
const clampIdx = (i: number, n: number) => Math.max(0, Math.min(n - 1, i))

/** New row above (`where = 'above'`) or below row `r`; it copies the style, fill and height of row `r`. */
export function addRow(t: TableData, r: number, where: 'above' | 'below'): TableData {
  const src = t.rows[clampIdx(r, t.rows.length)]
  const row: TRow = { minH: src.minH, cells: src.cells.map(blank) }
  const at = where === 'above' ? r : r + 1
  return mod(t, { rows: [...t.rows.slice(0, at), row, ...t.rows.slice(at)] })
}

/** New column left or right of column `c`; it copies style, fill and width of column `c`. The table keeps its total width: all columns share the space. */
export function addCol(t: TableData, c: number, where: 'left' | 'right'): TableData {
  const k = clampIdx(c, t.cols.length)
  const at = where === 'left' ? k : k + 1
  const total = sum(t.cols)
  const widths = [...t.cols.slice(0, at), t.cols[k], ...t.cols.slice(at)]
  const scale = total / sum(widths)
  return mod(t, {
    cols: widths.map((w) => w * scale),
    rows: t.rows.map((row) => ({ ...row, cells: [...row.cells.slice(0, at), blank(row.cells[k]), ...row.cells.slice(at)] })),
  })
}

export function deleteRow(t: TableData, r: number): TableData {
  if (t.rows.length <= 1) return t
  return mod(t, { rows: t.rows.filter((_, i) => i !== r) })
}

/** Delete column `c`; its width goes to the neighbour, so the table keeps its overall width. */
export function deleteCol(t: TableData, c: number): TableData {
  if (t.cols.length <= 1) return t
  const cols = [...t.cols]
  const w = cols[c]
  const neighbour = c > 0 ? c - 1 : 1
  cols[neighbour] += w
  return mod(t, { cols: cols.filter((_, i) => i !== c), rows: t.rows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => i !== c) })) })
}

/** Drag the boundary on the right of column `c`: that column grows, the next one gives (or takes) the space. Without a next column the table grows. */
export function resizeCol(t: TableData, c: number, width: number): TableData {
  const w = Math.max(MIN_COL, width)
  const cols = [...t.cols]
  if (c < cols.length - 1) {
    const pair = cols[c] + cols[c + 1]
    const nw = Math.min(w, pair - MIN_COL)
    cols[c] = nw
    cols[c + 1] = pair - nw
  } else cols[c] = w
  return mod(t, { cols })
}

/** Drag the boundary below row `r`. Rows below move; the content can still make the row taller than this. */
export function resizeRow(t: TableData, r: number, height: number): TableData {
  return mod(t, { rows: t.rows.map((row, i) => (i === r ? { ...row, minH: Math.max(8, height) } : row)) })
}

export function setCellFill(t: TableData, r: number, c: number, fill: string | undefined): TableData {
  return mod(t, { rows: t.rows.map((row, i) => (i === r ? { ...row, cells: row.cells.map((cell, j) => (j === c ? { ...cell, fill } : cell)) } : row)) })
}
export function setRowFill(t: TableData, r: number, fill: string | undefined): TableData {
  return mod(t, { rows: t.rows.map((row, i) => (i === r ? { ...row, cells: row.cells.map((cell) => ({ ...cell, fill })) } : row)) })
}
export function setColFill(t: TableData, c: number, fill: string | undefined): TableData {
  return mod(t, { rows: t.rows.map((row) => ({ ...row, cells: row.cells.map((cell, j) => (j === c ? { ...cell, fill } : cell)) })) })
}
export function setBorder(t: TableData, b: Partial<TableBorder>): TableData {
  return mod(t, { border: { ...t.border, ...b } })
}
export function setCellText(t: TableData, r: number, c: number, text: string): TableData {
  return mod(t, { rows: t.rows.map((row, i) => (i === r ? { ...row, cells: row.cells.map((cell, j) => (j === c ? { ...cell, text } : cell)) } : row)) })
}

/** Which cell is at this point (page space)? Null outside the table. */
export function cellAt(plan: TablePlan, x: number, y: number): { r: number; c: number } | null {
  const c = plan.colX.findIndex((v, i) => i < plan.colX.length - 1 && x >= v && x < plan.colX[i + 1])
  const r = plan.rowY.findIndex((v, i) => i < plan.rowY.length - 1 && y >= v && y < plan.rowY[i + 1])
  return c < 0 || r < 0 ? null : { r, c }
}

// ───────────────────────────────────────── a brand-new, empty table

/** An empty `rows` × `cols` table with its top-left corner at (x, y) and the given overall width. Nothing is covered on the page. */
export function newTable(x: number, y: number, width: number, rows = 3, cols = 3): TableData {
  const cell: TCell = { text: '', fontId: 'liberation-sans', size: 10, bold: false, italic: false, color: '#000000', leading: 12, padL: 6, padR: 6, firstBaseline: 15 }
  return {
    cols: Array.from({ length: cols }, () => width / cols),
    rows: Array.from({ length: rows }, () => ({ minH: 22, cells: Array.from({ length: cols }, () => ({ ...cell })) })),
    border: { color: '#000000', width: 0.75, inner: true },
    cover: { x, y, w: 0, h: 0, bg: '#ffffff' },
    origin: { x, y },
    padBottom: 6,
    modified: true,
  }
}
