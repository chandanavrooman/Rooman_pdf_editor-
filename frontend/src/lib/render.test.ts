import { describe, expect, it } from 'vitest'
import { canvasBitmapSize, MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from './render'

describe('canvasBitmapSize', () => {
  it('uses the full device pixel ratio (no cap at 2)', () => {
    const b = canvasBitmapSize(595.28, 841.89, 3)
    expect(b.capped).toBe(false)
    expect(b.ratio).toBe(3)
    expect(b.width).toBe(Math.floor(595.28 * 3))
    expect(b.height).toBe(Math.floor(841.89 * 3))
  })

  it('keeps 1:1 on a standard screen and handles fractional ratios', () => {
    expect(canvasBitmapSize(612, 792, 1)).toMatchObject({ width: 612, height: 792, ratio: 1, capped: false })
    expect(canvasBitmapSize(612, 792, 1.25)).toMatchObject({ width: 765, height: 990, capped: false })
  })

  it('caps huge pages to the safe pixel budget instead of failing', () => {
    // A4 at 400% on a 3x screen would be 7143 x 10102 = 72 M pixels
    const b = canvasBitmapSize(2381.1, 3367.6, 3)
    expect(b.capped).toBe(true)
    expect(b.width * b.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(b.ratio).toBeGreaterThan(1)
    expect(b.ratio).toBeLessThan(3)
  })

  it('caps very long pages by side length', () => {
    const b = canvasBitmapSize(200, 14400, 2) // a 200 pt wide, 200 inch tall strip
    expect(b.height).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
    expect(b.width * b.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(b.capped).toBe(true)
  })
})
