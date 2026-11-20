import type { PageShapes } from './pdfOps'
import type { SnapItem } from './textSnap'

/** One detected table cell, page space (points). Its text runs are an independent text block. */
export interface Cell {
  id: string
  table: number
  row: number
  col: number
  rows: number
  cols: number
  x: number
  y: number
  w: number
  h: number
  /** space between the cell edge and its text, left and right (taken from the table's first column) */
  padL: number
  padR: number
  /** background of the cell when a filled rectangle paints it */
  fill?: string
  /** colour and width of the table's rules (most common stroked rule inside the table) */
  rule?: { color: string; width: number }
  /** the text runs in this cell, top to bottom */
  runs: SnapItem[]
  /** every cell of this table (including empty ones) */
  grid: Cell[]
  /** typical line spacing / font size in this table, for cells that have only one line */
  leadingRatio?: number
  how: 'rows+columns' | 'ruled lines' | 'aligned columns'
}

const near = (a: number, b: number, t = 1.5) => Math.abs(a - b) <= t
function uniq(values: number[], tol = 1.2): number[] {
  const out: number[] = []
  for (const v of [...values].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v)
  return out
}

interface Region {
  x0: number
  x1: number
  y0: number
  y1: number
  rowEdges: number[]
  fills: { y0: number; y1: number; color: string }[]
  how: Cell['how']
}

/** Regions made of stacked, equally wide filled rectangles (the usual "row bands" of a styled table), plus the ruled lines inside. */
function regionsFromBands(shapes: PageShapes): Region[] {
  const bands = shapes.rects.filter((r) => r.w >= 120 && r.h >= 6 && r.h <= 400).sort((a, b) => a.y - b.y)
  const regions: Region[] = []
  const used = new Set<number>()
  bands.forEach((r, i) => {
    if (used.has(i)) return
    const group = [i]
    let bottom = r.y + r.h
    for (let j = i + 1; j < bands.length; j++) {
      const q = bands[j]
      if (used.has(j) || !near(q.x, r.x) || !near(q.w, r.w)) continue
      if (q.y - bottom > 2.5) break
      group.push(j)
      bottom = Math.max(bottom, q.y + q.h)
    }
    if (group.length < 2) return
    group.forEach((g) => used.add(g))
    const rs = group.map((g) => bands[g])
    regions.push({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: bottom, rowEdges: uniq(rs.flatMap((q) => [q.y, q.y + q.h])), fills: rs.map((q) => ({ y0: q.y, y1: q.y + q.h, color: q.color })), how: 'rows+columns' })
  })
  return regions
}

/** Regions made of 3+ equally long horizontal rules (a ruled table with no fills). */
function regionsFromRules(shapes: PageShapes, taken: Region[]): Region[] {
  const lines = shapes.hlines.filter((l) => l.x1 - l.x0 >= 120 && !taken.some((t) => l.y >= t.y0 - 2 && l.y <= t.y1 + 2 && l.x0 >= t.x0 - 2 && l.x1 <= t.x1 + 2)).sort((a, b) => a.y - b.y)
  const out: Region[] = []
  const used = new Set<number>()
  lines.forEach((l, i) => {
    if (used.has(i)) return
    const grp = [i]
    for (let j = i + 1; j < lines.length; j++) if (!used.has(j) && near(lines[j].x0, l.x0, 3) && near(lines[j].x1, l.x1, 3)) grp.push(j)
    if (grp.length < 3) return
    grp.forEach((g) => used.add(g))
    const ys = grp.map((g) => lines[g].y)
    out.push({ x0: l.x0, x1: l.x1, y0: Math.min(...ys), y1: Math.max(...ys), rowEdges: uniq(ys), fills: [], how: 'ruled lines' })
  })
  return out
}

const centerY = (it: SnapItem) => (it.origin ? it.origin.baseline - (it.fontSize ?? 10) * 0.3 : it.box.y + it.box.h / 2)
const left = (it: SnapItem) => it.origin?.x ?? it.box.x
const right = (it: SnapItem) => left(it) + (it.origin?.w ?? it.box.w)

/**
 * Find tables on a page from (1) stacked filled row bands, (2) ruled lines, and (3) aligned columns of text, and cut them into cells.
 * Every cell gets the text runs whose start lies inside it.
 */
export function detectCells(shapes: PageShapes, items: SnapItem[]): Cell[] {
  const bandRegions = regionsFromBands(shapes)
  const regions = [...bandRegions, ...regionsFromRules(shapes, bandRegions)]
  const cells: Cell[] = []
  regions.forEach((rg, ti) => {
    // rows: band edges + ruled lines inside the region that span (almost) the full width
    const rules = shapes.hlines.filter((l) => l.y >= rg.y0 - 1 && l.y <= rg.y1 + 1 && l.x0 <= rg.x0 + 3 && l.x1 >= rg.x1 - 3).map((l) => l.y)
    const rowEdges = uniq([...rg.rowEdges, ...rules])
    if (rowEdges.length < 3) return
    const inside = items.filter((it) => !it.blank && it.str.trim() && left(it) >= rg.x0 - 1 && right(it) <= rg.x1 + 40 && centerY(it) >= rowEdges[0] && centerY(it) <= rowEdges[rowEdges.length - 1])

    // columns: vertical rules that span most of the table, else aligned left edges of text
    const vr = shapes.vlines.filter((v) => v.x > rg.x0 + 8 && v.x < rg.x1 - 8 && v.y0 <= rg.y0 + 4 && v.y1 >= rg.y1 - 4).map((v) => v.x)
    let colEdges: number[]
    let how = rg.how
    let padL = 6
    if (vr.length) {
      colEdges = [rg.x0, ...uniq(vr, 2), rg.x1]
      how = 'ruled lines'
    } else {
      const sorted = [...inside].sort((a, b) => left(a) - left(b))
      const clusters: SnapItem[][] = []
      for (const it of sorted) {
        const c = clusters[clusters.length - 1]
        if (c && left(it) - left(c[0]) <= 4) c.push(it)
        else clusters.push([it])
      }
      const cols = clusters.filter((c) => c.length >= 2)
      colEdges = [rg.x0]
      for (let i = 0; i + 1 < cols.length; i++) {
        const maxRight = Math.max(...cols[i].map(right))
        const nextLeft = Math.min(...cols[i + 1].map(left))
        colEdges.push(maxRight < nextLeft ? (maxRight + nextLeft) / 2 : nextLeft - 2)
      }
      colEdges.push(rg.x1)
      if (cols.length >= 2) how = rg.how === 'rows+columns' ? 'rows+columns' : 'aligned columns'
      if (cols.length) padL = Math.max(2, Math.min(24, Math.min(...cols[0].map(left)) - rg.x0))
    }
    const rows = rowEdges.length - 1
    const ncols = colEdges.length - 1
    const made: Cell[] = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < ncols; c++) {
        const y0 = rowEdges[r]
        const y1 = rowEdges[r + 1]
        const x0 = colEdges[c]
        const x1 = colEdges[c + 1]
        const mid = (y0 + y1) / 2
        const fill = rg.fills.find((f) => mid >= f.y0 && mid <= f.y1)?.color
        const runs = inside.filter((it) => left(it) >= x0 - 0.5 && left(it) < x1 && centerY(it) >= y0 && centerY(it) < y1).sort((a, b) => (a.origin?.baseline ?? a.box.y) - (b.origin?.baseline ?? b.box.y) || left(a) - left(b))
        made.push({ id: `t${ti}r${r}c${c}`, table: ti, row: r, col: c, rows, cols: ncols, x: x0, y: y0, w: x1 - x0, h: y1 - y0, padL, padR: padL, fill, runs, how, grid: [] })
      }
    // typical leading of the table's multi-line cells (so a one-line cell gets the same line spacing when it grows)
    const ratios: number[] = []
    for (const cell of made) {
      const bl = cell.runs.map((q) => q.origin?.baseline).filter((v): v is number => v !== undefined)
      for (let i = 1; i < bl.length; i++) if (bl[i] - bl[i - 1] > 4) ratios.push((bl[i] - bl[i - 1]) / (cell.runs[0].fontSize ?? 10))
    }
    const ratio = ratios.length ? ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)] : undefined
    const tally = new Map<string, { color: string; width: number; n: number }>()
    for (const l of shapes.hlines) if (l.color && l.width && l.y >= rg.y0 - 1 && l.y <= rg.y1 + 1 && l.x0 <= rg.x1 && l.x1 >= rg.x0) {
      const k = `${l.color}|${l.width.toFixed(2)}`
      tally.set(k, { color: l.color, width: l.width, n: (tally.get(k)?.n ?? 0) + 1 })
    }
    const rule = [...tally.values()].sort((a, b) => b.n - a.n)[0]
    for (const cell of made) {
      cell.grid = made
      cell.leadingRatio = ratio
      if (rule) cell.rule = { color: rule.color, width: rule.width }
    }
    cells.push(...made)
  })
  return cells
}

/** The cell that holds this run, if any. */
export const cellOf = (it: SnapItem): Cell | undefined => it.cell
