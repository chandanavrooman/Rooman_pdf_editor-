import type { Box } from './types'

/** Lines to draw while something snaps: x = vertical lines, y = horizontal lines (page space, points). */
export interface Guides {
  x: number[]
  y: number[]
}
export type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

/** a box to line up with; `edges` = only its sides count, not its centre (lines of page text) */
export type Target = Box & { edges?: boolean }
const xs = (b: Target) => (b.edges ? [b.x, b.x + b.w] : [b.x, b.x + b.w / 2, b.x + b.w])
const ys = (b: Target) => (b.edges ? [b.y, b.y + b.h] : [b.y, b.y + b.h / 2, b.y + b.h])

/** The offset that brings one of `mine` onto the nearest of `lines` (within `tol`), and that line. */
function nearest(mine: number[], lines: number[], tol: number): { d: number; line: number } | null {
  let best: { d: number; line: number } | null = null
  for (const m of mine)
    for (const l of lines) {
      const d = l - m
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l }
    }
  return best
}

/** Moving a box: snap its edges / centre to the edges / centres of the other boxes, so pictures of one row line up. */
export function snapMove(box: Box, others: Target[], tol: number): { dx: number; dy: number; guides: Guides } {
  const sx = nearest(xs(box), others.flatMap(xs), tol)
  const sy = nearest(ys(box), others.flatMap(ys), tol)
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, guides: { x: sx ? [sx.line] : [], y: sy ? [sy.line] : [] } }
}

/**
 * Resizing: only the edges being dragged snap. With "keep proportions" on a corner, one edge snaps and the other follows the proportions,
 * so a picture can be brought to exactly the height (or width) of its neighbour without distorting it.
 */
export function snapResize(orig: Box, nb: Box, handle: Handle, keep: boolean, others: Target[], tol: number): { box: Box; guides: Guides } {
  const lx = others.flatMap(xs)
  const ly = others.flatMap(ys)
  const guides: Guides = { x: [], y: [] }
  const moveW = handle.includes('w')
  const moveE = handle.includes('e')
  const moveN = handle.includes('n')
  const moveS = handle.includes('s')
  let x0 = nb.x
  let x1 = nb.x + nb.w
  let y0 = nb.y
  let y1 = nb.y + nb.h
  const corner = handle.length === 2
  if (keep && corner && orig.w > 0 && orig.h > 0) {
    const ex = nearest([moveW ? x0 : x1], lx, tol) // snap the dragged vertical edge ...
    const ey = nearest([moveN ? y0 : y1], ly, tol) // ... or the dragged horizontal edge, whichever is closer
    const useX = ex && (!ey || Math.abs(ex.d) <= Math.abs(ey.d))
    const k = useX ? (moveW ? x1 - (x0 + ex.d) : x1 + ex.d - x0) / nb.w : ey ? (moveN ? y1 - (y0 + ey.d) : y1 + ey.d - y0) / nb.h : 1
    if ((useX || ey) && k > 0) {
      const w = nb.w * k
      const h = nb.h * k
      if (moveW) x0 = x1 - w
      else x1 = x0 + w
      if (moveN) y0 = y1 - h
      else y1 = y0 + h
      if (useX) guides.x.push(ex.line)
      else if (ey) guides.y.push(ey.line)
    }
    return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, guides }
  }
  if (moveW) {
    const s = nearest([x0], lx, tol)
    if (s) {
      x0 += s.d
      guides.x.push(s.line)
    }
  }
  if (moveE) {
    const s = nearest([x1], lx, tol)
    if (s) {
      x1 += s.d
      guides.x.push(s.line)
    }
  }
  if (moveN) {
    const s = nearest([y0], ly, tol)
    if (s) {
      y0 += s.d
      guides.y.push(s.line)
    }
  }
  if (moveS) {
    const s = nearest([y1], ly, tol)
    if (s) {
      y1 += s.d
      guides.y.push(s.line)
    }
  }
  return { box: { x: x0, y: y0, w: Math.max(4, x1 - x0), h: Math.max(4, y1 - y0) }, guides }
}
