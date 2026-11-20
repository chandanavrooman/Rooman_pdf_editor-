import { describe, expect, it } from 'vitest'
import { snapMove, snapResize } from './align'

// three pictures in a row at the same height, as in a typical report
const row = [
  { x: 60, y: 150, w: 150, h: 76 },
  { x: 230, y: 150, w: 150, h: 76 },
  { x: 400, y: 150, w: 150, h: 76 },
]

describe('alignment guides', () => {
  it('a picture dragged near the row snaps to its top edge, and shows the guide', () => {
    const moving = { x: 230, y: 153, w: 150, h: 76 } // 3 pt too low
    const s = snapMove(moving, [row[0], row[2]], 5)
    expect(s.dy).toBe(-3)
    expect(s.guides.y).toContain(150)
  })
  it('snaps centres too, and does nothing when nothing is close', () => {
    expect(snapMove({ x: 227, y: 400, w: 150, h: 40 }, [row[1]], 5).dx).toBe(3) // left edge to the neighbour's left edge
    const far = snapMove({ x: 258, y: 500, w: 10, h: 10 }, row, 5)
    expect([far.dx, far.dy, far.guides.x.length, far.guides.y.length]).toEqual([0, 0, 0, 0])
  })
  it('resizing a picture by its corner brings it to its neighbour’s height and keeps its proportions', () => {
    const orig = { x: 230, y: 150, w: 100, h: 50 } // 2 : 1
    const dragged = { x: 230, y: 150, w: 156, h: 78 } // bottom edge at 228, the neighbour's bottom is 226
    const r = snapResize(orig, dragged, 'se', true, [row[0]], 4)
    expect(r.box.y + r.box.h).toBeCloseTo(226, 5)
    expect(r.box.w / r.box.h).toBeCloseTo(2, 5)
    expect(r.guides.y).toContain(226)
  })
  it('only the edges being dragged snap when stretching from a side', () => {
    const r = snapResize({ x: 230, y: 150, w: 150, h: 76 }, { x: 230, y: 150, w: 152, h: 76 }, 'e', false, [{ x: 0, y: 0, w: 380, h: 10 }], 4)
    expect(r.box.x + r.box.w).toBe(380)
    expect(r.box.y).toBe(150) // untouched
    expect(r.box.h).toBe(76)
  })
})
