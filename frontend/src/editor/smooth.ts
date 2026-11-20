import type { Pt } from './types'

export type Seg = { t: 'M'; p: Pt } | { t: 'L'; p: Pt } | { t: 'Q'; c: Pt; p: Pt }

/** Smooth a freehand polyline with quadratic curves through segment midpoints. Used by BOTH the screen and the PDF export. */
export function smoothSegments(pts: Pt[]): Seg[] {
  if (!pts.length) return []
  if (pts.length === 1) return [{ t: 'M', p: pts[0] }, { t: 'L', p: { x: pts[0].x + 0.01, y: pts[0].y } }]
  if (pts.length === 2) return [{ t: 'M', p: pts[0] }, { t: 'L', p: pts[1] }]
  const segs: Seg[] = [{ t: 'M', p: pts[0] }]
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
    segs.push({ t: 'Q', c: pts[i], p: mid })
  }
  segs.push({ t: 'L', p: pts[pts.length - 1] })
  return segs
}

export function svgPathD(pts: Pt[]): string {
  return smoothSegments(pts)
    .map((s) => (s.t === 'M' ? `M${s.p.x} ${s.p.y}` : s.t === 'L' ? `L${s.p.x} ${s.p.y}` : `Q${s.c.x} ${s.c.y} ${s.p.x} ${s.p.y}`))
    .join(' ')
}

/** Drop points closer than `min` to the previous kept one (keeps last). */
export function thin(pts: Pt[], min = 0.8): Pt[] {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) if (Math.hypot(pts[i].x - out[out.length - 1].x, pts[i].y - out[out.length - 1].y) >= min) out.push(pts[i])
  out.push(pts[pts.length - 1])
  return out
}

/** Arrowhead triangle (page space) for a line from a to b. */
export function arrowHead(a: Pt, b: Pt, strokeWidth: number): [Pt, Pt, Pt] {
  const len = Math.max(9, strokeWidth * 4.5)
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const spread = (28 * Math.PI) / 180
  return [b, { x: b.x - len * Math.cos(ang - spread), y: b.y - len * Math.sin(ang - spread) }, { x: b.x - len * Math.cos(ang + spread), y: b.y - len * Math.sin(ang + spread) }]
}
