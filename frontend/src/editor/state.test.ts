import { describe, expect, it } from 'vitest'
import { applyBox, bboxOf, hitTest, moveObject, boxesIntersect } from './geometry'
import { DEFAULTS, cloneObject, makeDraw, makeLine, makeShape, makeText } from './objects'
import { initialState, reducer, canRedo, canUndo, type Action, type EditorState } from './state'
import { smoothSegments, thin } from './smooth'
import { isWinAnsi, wrapLines } from './textLayout'

const run = (s: EditorState, ...a: Action[]) => a.reduce(reducer, s)
const rect = (x = 10, y = 10) => makeShape('rect', 0, { x, y, w: 50, h: 30 }, DEFAULTS.shape)

describe('undo / redo reducer', () => {
  it('add → undo → redo restores state', () => {
    const r = rect()
    let s = run(initialState(), { type: 'add', objects: [r] })
    expect(s.present.objects).toHaveLength(1)
    expect(s.selection).toEqual([r.id])
    expect(canUndo(s)).toBe(true)
    s = run(s, { type: 'undo' })
    expect(s.present.objects).toHaveLength(0)
    expect(s.selection).toEqual([])
    expect(canRedo(s)).toBe(true)
    s = run(s, { type: 'redo' })
    expect(s.present.objects).toEqual([r])
  })

  it('a new action after undo clears the redo stack', () => {
    let s = run(initialState(), { type: 'add', objects: [rect()] }, { type: 'undo' })
    expect(canRedo(s)).toBe(true)
    s = run(s, { type: 'add', objects: [rect(5, 5)] })
    expect(canRedo(s)).toBe(false)
  })

  it('changes with the same txn (a drag) collapse into ONE undo step', () => {
    const r = rect()
    let s = run(initialState(), { type: 'add', objects: [r] })
    for (let i = 1; i <= 20; i++) s = run(s, { type: 'update', ids: [r.id], patch: (o) => ({ x: o.x + 1 }), txn: 'drag-1' })
    expect(s.present.objects[0].x).toBe(30)
    expect(s.past).toHaveLength(2) // initial, after-add
    s = run(s, { type: 'undo' })
    expect(s.present.objects[0].x).toBe(10)
    s = run(s, { type: 'update', ids: [r.id], patch: { x: 99 }, txn: 'drag-2' }, { type: 'update', ids: [r.id], patch: { x: 100 }, txn: 'drag-2' })
    s = run(s, { type: 'undo' })
    expect(s.present.objects[0].x).toBe(10)
  })

  it('remove, form values, reorder and no-op updates behave', () => {
    const a = rect(1, 1)
    const b = rect(2, 2)
    const c = rect(3, 3)
    let s = run(initialState(), { type: 'add', objects: [a, b, c], select: false })
    s = run(s, { type: 'reorder', ids: [a.id], to: 'front' })
    expect(s.present.objects.map((o) => o.id)).toEqual([b.id, c.id, a.id])
    s = run(s, { type: 'reorder', ids: [a.id], to: 'backward' })
    expect(s.present.objects.map((o) => o.id)).toEqual([b.id, a.id, c.id])
    const before = s
    expect(run(s, { type: 'update', ids: [a.id], patch: { x: 1 } }) === before).toBe(true) // unchanged value -> same state
    s = run(s, { type: 'remove', ids: [b.id] }, { type: 'setField', name: 'name', value: 'Ada' })
    expect(s.present.objects).toHaveLength(2)
    expect(s.present.formValues).toEqual({ name: 'Ada' })
    s = run(s, { type: 'undo' }, { type: 'undo' })
    expect(s.present.objects).toHaveLength(3)
    expect(s.present.formValues).toEqual({})
  })

  it('history is capped', () => {
    let s = initialState()
    for (let i = 0; i < 260; i++) s = run(s, { type: 'add', objects: [rect(i, i)] })
    expect(s.past.length).toBeLessThanOrEqual(200)
  })
})

describe('geometry helpers', () => {
  it('moving / resizing point objects remaps their points', () => {
    const l = makeLine('line', 0, { x: 10, y: 10 }, { x: 30, y: 20 }, DEFAULTS.line)
    const moved = moveObject(l, 5, 5)
    expect(moved.pts).toEqual([{ x: 15, y: 15 }, { x: 35, y: 25 }])
    const scaled = applyBox(l, { x: 10, y: 10, w: 40, h: 20 })
    expect(scaled.pts[1]).toEqual({ x: 50, y: 30 })
    const d = makeDraw(0, [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], DEFAULTS.draw)
    expect(applyBox(d, { x: 0, y: 0, w: 40, h: 10 }).pts[2]).toEqual({ x: 40, y: 0 })
    expect(bboxOf(applyBox(d, { x: 5, y: 5, w: 40, h: 10 }).pts)).toEqual({ x: 5, y: 5, w: 40, h: 10 })
  })
  it('hit testing: lines use distance, boxes use containment', () => {
    const l = makeLine('line', 0, { x: 0, y: 0 }, { x: 100, y: 0 }, DEFAULTS.line)
    expect(hitTest(l, { x: 50, y: 3 }, 4)).toBe(true)
    expect(hitTest(l, { x: 50, y: 30 }, 4)).toBe(false)
    expect(hitTest(rect(), { x: 20, y: 20 }, 2)).toBe(true)
    expect(hitTest(rect(), { x: 200, y: 20 }, 2)).toBe(false)
    expect(boxesIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true)
  })
  it('clone offsets the object and its points and gives a new id', () => {
    const l = makeLine('arrow', 0, { x: 0, y: 0 }, { x: 10, y: 10 }, DEFAULTS.line)
    const c = cloneObject(l, 12, 12)
    expect(c.id).not.toBe(l.id)
    expect(c.pts[0]).toEqual({ x: 12, y: 12 })
  })
})

describe('text + path helpers', () => {
  it('wraps on words and on explicit newlines', () => {
    const m = (s: string) => s.length * 10
    expect(wrapLines('aaa bbb ccc', 70, m)).toEqual(['aaa bbb', 'ccc'])
    expect(wrapLines('a\nb', null, m)).toEqual(['a', 'b'])
    expect(wrapLines('x'.repeat(25), 100, m).every((l) => l.length <= 10)).toBe(true)
  })
  it('WinAnsi check', () => {
    expect(isWinAnsi('Hello é ü € “x”')).toBe(true)
    expect(isWinAnsi('Привет')).toBe(false)
  })
  it('smoothing keeps endpoints; thinning drops near-duplicates', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }]
    const segs = smoothSegments(pts)
    expect(segs[0]).toEqual({ t: 'M', p: pts[0] })
    expect(segs[segs.length - 1]).toEqual({ t: 'L', p: pts[3] })
    expect(thin([{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 5, y: 0 }]).length).toBe(2)
    expect(makeText(0, { x: 0, y: 0 }, DEFAULTS.text, 'hi').w).toBeGreaterThan(0)
  })
})
