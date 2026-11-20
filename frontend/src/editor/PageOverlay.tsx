import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { Bold, ChevronDown, Copy, Italic, Link2, Move, Palette, RefreshCw, RotateCw, Trash2 } from 'lucide-react'
import type { OverlayInfo } from '@/components/PdfViewer'
import { useEditor, STICKY_TOOLS, type ToolId } from './EditorContext'
import { applyBox, bboxOf, boxCenter, clamp, hitTest, moveObject, normBox, rotateAbout, rotationOf } from './geometry'
import { cloneObjects, makeDraw, makeField, makeImage, makeLine, makeLink, makeMark, makeShape, makeText, makeWhiteout } from './objects'
import { newId } from './state'
import { arrowHead, svgPathD, thin } from './smooth'
import { ascDesc, baselineFix, fitTextBox, lineHeightOf, outlineBox, textCss } from './textLayout'
import { FONTS, fontInfo, ensureFontFaces, loadFontForDisplay, type FontId } from './fontCatalog'
import { isUnchanged, textObjFromSnap, textPatch } from './textEdit'
import { isCoverBox, overlappedText, overlapWarning } from './overlap'
import type { ImageRect } from './imageSnap'
import { itemAt, snapItemAt, snapItemsInBox, snapToText, type SnapItem } from './textSnap'
import type { Box, EditorObject, FieldObj, ImageObj, Pt, TableObj, TextObj } from './types'
import { replacementPatch } from './imageReplace'
import { PaletteGrid } from './PaletteGrid'
import { snapMove, snapResize, type Guides, type Target } from './align'
import type { Cell } from './tables'
import { cellAt, layoutTable, newTable, resizeCol, resizeRow, setCellText } from './tableModel'
import { browserMeasure, gridBounds, retable, tableObjFromCell } from './tableView'
import { cssStack } from './fontCatalog'
import { hasPts } from './types'
import { FormFillLayer } from './FormFillLayer'

/** equal left/right padding (screen px) between the single outline and the text */
const TEXT_PAD = 2
const TEAL = '#1f9d92'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] }
const HANDLE_CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }

type Drag =
  | { kind: 'create'; tool: ToolId; a: Pt; b: Pt; shift: boolean }
  | { kind: 'draw'; pts: Pt[] }
  | { kind: 'move'; ids: string[]; start: Pt; orig: Map<string, EditorObject>; txn: string; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; start: Pt; orig: EditorObject; txn: string }
  | { kind: 'lineend'; id: string; which: 0 | 1; orig: EditorObject; txn: string }
  | { kind: 'rotate'; id: string; center: Pt; txn: string }
  | { kind: 'tblcol'; id: string; c: number; startX: number; startW: number; txn: string }
  | { kind: 'tblrow'; id: string; r: number; startY: number; startH: number; txn: string }

const MIN = 4

function resizeBox(o: Box, h: Handle, dx: number, dy: number, keepAspect: boolean): Box {
  let x0 = o.x
  let y0 = o.y
  let x1 = o.x + o.w
  let y1 = o.y + o.h
  const corner = h.length === 2
  if (keepAspect && corner && o.w > 0 && o.h > 0) {
    const ax = h.includes('w') ? o.x + o.w : o.x
    const ay = h.includes('n') ? o.y + o.h : o.y
    const nw = (h.includes('w') ? -dx : dx) + o.w
    const nh = (h.includes('n') ? -dy : dy) + o.h
    const k = Math.max(MIN / Math.min(o.w, o.h), Math.max(nw / o.w, nh / o.h))
    const w = o.w * k
    const hh = o.h * k
    return { x: h.includes('w') ? ax - w : ax, y: h.includes('n') ? ay - hh : ay, w, h: hh }
  }
  if (h.includes('w')) x0 += dx
  if (h.includes('e')) x1 += dx
  if (h.includes('n')) y0 += dy
  if (h.includes('s')) y1 += dy
  if (x1 - x0 < MIN) {
    if (h.includes('w')) x0 = x1 - MIN
    else x1 = x0 + MIN
  }
  if (y1 - y0 < MIN) {
    if (h.includes('n')) y0 = y1 - MIN
    else y1 = y0 + MIN
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Resize a ROTATED box: the pointer movement is taken in the box's own frame and the opposite edge / corner stays where it is on the page. */
function resizeRotated(o: Box, h: Handle, dx: number, dy: number, keep: boolean, deg: number): Box {
  const local = rotateAbout({ x: dx, y: dy }, { x: 0, y: 0 }, -deg)
  const nb = resizeBox(o, h, local.x, local.y, keep)
  const ax = 1 - HANDLE_POS[h][0]
  const ay = 1 - HANDLE_POS[h][1]
  const before = rotateAbout({ x: o.x + o.w * ax, y: o.y + o.h * ay }, boxCenter(o), deg)
  const after = rotateAbout({ x: nb.x + nb.w * ax, y: nb.y + nb.h * ay }, boxCenter(nb), deg)
  return { x: nb.x + before.x - after.x, y: nb.y + before.y - after.y, w: nb.w, h: nb.h }
}

function constrain(tool: ToolId, a: Pt, b: Pt, shift: boolean): Pt {
  if (!shift) return b
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (tool === 'line' || tool === 'arrow') {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    const len = Math.hypot(dx, dy)
    return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) }
  }
  if (tool === 'rect' || tool === 'ellipse' || tool === 'whiteout') {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m }
  }
  return b
}

const label = (o: EditorObject) =>
  ({ text: 'Text', whiteout: 'Whiteout', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', draw: 'Drawing', highlight: 'Highlight', underline: 'Underline', strike: 'Strike-through', image: 'Image', signature: 'Signature', link: 'Link', field: 'Form field', table: 'Table' })[o.type]

function ObjectShape({ o, s, W, H }: { o: EditorObject; s: number; W: number; H: number }) {
  const svg = (children: React.ReactNode, style?: CSSProperties) => (
    <svg className="pointer-events-none absolute left-0 top-0" width={W * s} height={H * s} viewBox={`0 0 ${W} ${H}`} style={style} aria-hidden="true">
      {children}
    </svg>
  )
  switch (o.type) {
    case 'whiteout':
      return svg(<rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill} />)
    case 'rect':
      return svg(<rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill ?? 'none'} stroke={o.stroke ?? 'none'} strokeWidth={o.stroke ? o.strokeWidth : 0} />)
    case 'ellipse':
      return svg(<ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill={o.fill ?? 'none'} stroke={o.stroke ?? 'none'} strokeWidth={o.stroke ? o.strokeWidth : 0} />)
    case 'line':
      return svg(<line x1={o.pts[0].x} y1={o.pts[0].y} x2={o.pts[1].x} y2={o.pts[1].y} stroke={o.stroke} strokeWidth={o.strokeWidth} strokeLinecap="round" />)
    case 'arrow': {
      const [a, b] = o.pts
      const head = arrowHead(a, b, o.strokeWidth)
      const mid = { x: (head[1].x + head[2].x) / 2, y: (head[1].y + head[2].y) / 2 }
      return svg(
        <>
          <line x1={a.x} y1={a.y} x2={mid.x} y2={mid.y} stroke={o.stroke} strokeWidth={o.strokeWidth} strokeLinecap="round" />
          <polygon points={head.map((p) => `${p.x},${p.y}`).join(' ')} fill={o.stroke} />
        </>,
      )
    }
    case 'draw':
      return svg(<path d={svgPathD(o.pts)} fill="none" stroke={o.stroke} strokeWidth={o.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />)
    case 'highlight':
      return svg(<rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.color} />, { mixBlendMode: 'multiply' })
    case 'underline':
      return svg(<line x1={o.x} x2={o.x + o.w} y1={o.y + o.h * 0.93} y2={o.y + o.h * 0.93} stroke={o.color} strokeWidth={Math.max(0.75, o.h * 0.07)} />)
    case 'strike':
      return svg(<line x1={o.x} x2={o.x + o.w} y1={o.y + o.h * 0.52} y2={o.y + o.h * 0.52} stroke={o.color} strokeWidth={Math.max(0.75, o.h * 0.07)} />)
    default:
      return null
  }
}

/** A text box the user added and never typed into (erasing EXISTING page text keeps its object: that is a deliberate whiteout). */
export function isEmptyNewText(o: TextObj): boolean {
  return !o.orig && !o.text.trim() && !o.fill
}

function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function TextView({ o, s, editing, onChange, onDone }: { o: TextObj; s: number; editing: boolean; onChange: (text: string) => void; onDone: () => void }) {
  const style: CSSProperties = {
    position: 'absolute',
    left: o.x * s,
    top: o.y * s + baselineFix(o, s),
    width: o.autoWidth ? undefined : o.w * s,
    minWidth: o.autoWidth ? o.w * s : undefined,
    minHeight: o.h * s,
    fontSize: o.size * s,
    lineHeight: lineHeightOf(o),
    fontFamily: textCss(o),
    fontWeight: o.bold ? 700 : 400,
    fontStyle: o.italic ? 'italic' : 'normal',
    fontKerning: 'none',
    letterSpacing: o.letterSpacing ? `${o.letterSpacing * s}px` : undefined,
    color: o.opacity !== undefined && o.opacity < 1 ? withAlpha(o.color, o.opacity) : o.color,
    backgroundColor: o.fill ?? 'transparent',
    textAlign: o.align,
    whiteSpace: o.autoWidth ? 'pre' : 'pre-wrap',
    overflowWrap: 'anywhere',
    margin: 0,
    padding: 0,
  }
  // until the user changes something the original page text stays exactly as it is: the editor paints nothing of its own, only the caret
  const pristine = isUnchanged(o)
  if (editing) {
    const ob = outlineBox(o)
    return (
      <textarea
        autoFocus
        aria-label="Text content"
        data-testid="text-editor"
        value={o.text}
        placeholder={o.orig ? undefined : 'Type your text'}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          // using the bar above the text (its colour code box, size field ...) moves the focus but does not finish the editing
          if (e.relatedTarget instanceof Element && e.relatedTarget.closest('[data-testid="floating-text-bar"]')) return
          onDone()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onDone()
          }
          e.stopPropagation()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        spellCheck={false}
        rows={Math.max(1, o.text.split('\n').length)}
        className="placeholder:rounded-sm placeholder:bg-sky-600 placeholder:font-semibold placeholder:italic placeholder:text-white"
        style={{ ...style, left: o.x * s - TEXT_PAD, padding: `0 ${TEXT_PAD}px`, minWidth: 0, minHeight: 0, width: Math.max(ob.w * s, o.text ? 0 : o.size * s * 7) + TEXT_PAD * 2 + o.size * s * 0.6, height: ob.lines * o.size * lineHeightOf(o) * s, resize: 'none', overflow: 'visible', scrollbarWidth: 'none', background: 'transparent', backgroundColor: 'transparent', outline: 'none', border: 0, boxShadow: 'none', whiteSpace: o.autoWidth ? 'pre' : 'pre-wrap', ...(pristine ? { color: 'transparent', caretColor: o.color } : {}) }}
      />
    )
  }
  const unchanged = isUnchanged(o)
  if (unchanged) return <div style={{ ...style, backgroundColor: 'transparent', color: 'transparent', pointerEvents: 'none' }}>{o.text}</div>
  return <div style={{ ...style, pointerEvents: 'none' }}>{o.text}</div>
}

/** Development only: a thin box over every text item pdf.js returns, with its raw values on hover. */
function DebugLayer({ pageIndex, s }: { pageIndex: number; s: number }) {
  const { rawItems } = useEditor()
  const [items, setItems] = useState<SnapItem[]>([])
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null)
  useEffect(() => {
    let alive = true
    rawItems(pageIndex).then((it) => alive && setItems(it)).catch(() => {})
    return () => {
      alive = false
    }
  }, [rawItems, pageIndex])
  const f = (n: number | undefined) => (n === undefined ? 'n/a' : (Math.round(n * 100) / 100).toString())
  const hit = tip ? items[tip.i] : null
  const cells = [...new Map(items.filter((i) => i.cell).map((i) => [i.cell!.id, i.cell!])).values()]
  return (
    <div data-testid="debug-layer" className="pointer-events-none absolute inset-0" style={{ zIndex: 40 }}>
      {cells.map((c) => (
        <div key={c.id} data-testid="debug-cell" className="pointer-events-none absolute" style={{ left: c.x * s, top: c.y * s, width: c.w * s, height: c.h * s, outline: '1px dashed rgba(37,99,235,.75)', outlineOffset: -1 }}>
          <span className="absolute right-0 top-0 bg-blue-600/80 px-1 text-[9px] leading-3 text-white">R{c.row + 1}·C{c.col + 1} · {c.runs.length} line{c.runs.length === 1 ? '' : 's'}</span>
        </div>
      ))}
      {items.map((it, i) => {
        const x = it.origin?.x ?? it.box.x
        const w = it.origin?.w ?? it.box.w
        return (
          <div
            key={i}
            data-testid="debug-box"
            data-i={i}
            data-str={it.str}
            data-font={it.fontId}
            className="pointer-events-auto absolute"
            style={{ left: x * s, top: it.box.y * s, width: Math.max(w * s, 2), height: it.box.h * s, outline: `1px solid ${it.blank ? 'rgba(120,120,120,.6)' : 'rgba(217,0,160,.8)'}`, outlineOffset: -1 }}
            onPointerEnter={(e) => setTip({ i, x: e.clientX, y: e.clientY })}
            onPointerMove={(e) => setTip({ i, x: e.clientX, y: e.clientY })}
            onPointerLeave={() => setTip(null)}
          >
            {!it.blank && (
              <span data-testid="debug-font" className="pointer-events-none absolute left-0 whitespace-nowrap bg-fuchsia-700/85 px-0.5 font-mono leading-none text-white" style={{ top: -8, fontSize: 7 }}>
                {it.fontUsed ?? it.rawFont ?? '?'} → {it.fontId}
              </span>
            )}
          </div>
        )
      })}
      {hit && tip && (
        <div data-testid="debug-tip" className="pointer-events-none fixed rounded-md bg-ink-900 px-2 py-1.5 font-mono text-[11px] leading-snug text-white shadow-lg" style={{ left: tip.x + 14, top: tip.y + 14, zIndex: 9999, maxWidth: 360 }}>
          <div className="font-bold">“{hit.str}”</div>
          <div>
            x {f(hit.origin?.x ?? hit.box.x)} pt ({f((hit.origin?.x ?? hit.box.x) * s)} px)  y(top) {f(hit.box.y)} pt ({f(hit.box.y * s)} px)
          </div>
          <div>
            width {f(hit.origin?.w ?? hit.box.w)} pt ({f((hit.origin?.w ?? hit.box.w) * s)} px)  height {f(hit.box.h)} pt ({f(hit.box.h * s)} px)
          </div>
          <div>
            baseline {f(hit.origin?.baseline)} pt  top (pdfplumber-style) {hit.origin && hit.fontSize ? f(hit.origin.baseline - hit.fontSize * (1 - fontInfo(hit.fontId ?? 'liberation-sans').desc)) : 'n/a'} pt
          </div>
          <div>font {hit.rawFont ?? 'n/a'} → {hit.fontId ?? 'n/a'}</div>
          <div>
            size {f(hit.fontSize)} pt  bold {String(!!hit.bold)}  italic {String(!!hit.italic)}
          </div>
          <div>
            color {hit.color ?? 'n/a'} ({hit.colorSource ?? 'n/a'})  bg {hit.bg ?? 'n/a'}
          </div>
        </div>
      )}
    </div>
  )
}

/** An edited table drawn as it will be exported: the old table is blanked, then fills, rules and wrapped text. Untouched tables draw nothing (the page shows the original). */
function TableView({ o, s, W, H }: { o: TableObj; s: number; W: number; H: number }) {
  if (!o.data.modified) return null
  const plan = layoutTable(o.data, browserMeasure)
  const cv = plan.cover
  return (
    <svg data-testid="table-view" className="pointer-events-none absolute left-0 top-0" width={W * s} height={H * s} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect x={cv.x} y={cv.y} width={cv.w} height={cv.h} fill={cv.bg} />
      {plan.fills.map((f, i) => (
        <rect key={`f${i}`} x={f.x} y={f.y} width={f.w} height={f.h} fill={f.color} />
      ))}
      {plan.lines.map((l, i) => (
        <line key={`l${i}`} x1={l.x0 - (l.y0 === l.y1 ? l.width / 2 : 0)} y1={l.y0} x2={l.x1 + (l.y0 === l.y1 ? l.width / 2 : 0)} y2={l.y1} stroke={l.color} strokeWidth={l.width} />
      ))}
      {plan.texts.map((t, i) => (
        <text key={`t${i}`} x={t.x} y={t.baseline} fill={t.cell.color} fontSize={t.cell.size} fontWeight={t.cell.bold ? 700 : 400} fontStyle={t.cell.italic ? 'italic' : 'normal'} style={{ fontFamily: cssStack(t.cell.fontId), fontKerning: 'none', whiteSpace: 'pre' }}>
          {t.str}
        </text>
      ))}
    </svg>
  )
}

function TextOutline({ o, s, onMove }: { o: TextObj; s: number; onMove: (e: RPointerEvent) => void }) {
  const b = outlineBox(o)
  const left = b.x * s - TEXT_PAD
  const w = b.w * s + TEXT_PAD * 2
  const h = b.h * s
  const T = 8 // grab strip thickness: the dashed outline itself can be dragged to move the box (cursor shows it)
  const strip = (name: string, st: CSSProperties) => (
    <div key={name} data-testid={`outline-grab-${name}`} className="absolute" style={{ ...st, cursor: 'move', touchAction: 'none', zIndex: 4 }} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onMove(e) }} />
  )
  return (
    <>
      <div data-testid="selection-box" className="pointer-events-none absolute" style={{ left, top: b.y * s, width: w, height: h, border: `1px dashed ${TEAL}`, boxSizing: 'border-box' }} />
      {strip('top', { left, top: b.y * s - T / 2, width: w, height: T })}
      {strip('bottom', { left, top: b.y * s + h - T / 2, width: w, height: T })}
      {strip('left', { left: left - T / 2, top: b.y * s, width: T, height: h })}
      {strip('right', { left: left + w - T / 2, top: b.y * s, width: T, height: h })}
    </>
  )
}

const STD_FONT_ID: Record<string, FontId> = { helvetica: 'liberation-sans', times: 'liberation-serif', courier: 'liberation-mono' }

/** Small toolbar that floats above the text box (below it only when there is no room above), so it never covers the text. */
/** Sejda's little bar above a picture: rotate, duplicate, replace, delete */
function ImageFloatingBar({ o, s, maxX, onRotate, onDuplicate, onReplace, onDelete }: { o: ImageObj; s: number; maxX: number; onRotate: () => void; onDuplicate: () => void; onReplace: (f: File) => void; onDelete: () => void }) {
  const above = o.y * s >= 56
  const style: CSSProperties = above ? { top: o.y * s - 40 } : { top: (o.y + o.h) * s + 10 }
  const btn = 'rounded p-1.5 text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800 [&>svg]:h-4 [&>svg]:w-4'
  const file = useRef<HTMLInputElement>(null)
  return (
    <div
      data-testid="floating-image-bar"
      role="toolbar"
      aria-label="Picture"
      className="absolute z-20 flex items-center gap-0.5 rounded-lg border border-ink-200 bg-white px-1 py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900"
      style={{ ...style, left: Math.max(0, Math.min(o.x * s, maxX - 190)), whiteSpace: 'nowrap', touchAction: 'none' }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button type="button" aria-label="Rotate 90 degrees" title="Rotate 90 degrees" className={btn} data-testid="img-bar-rotate" onClick={onRotate}>
        <RotateCw />
      </button>
      <button type="button" aria-label="Duplicate" title="Duplicate" className={btn} data-testid="img-bar-duplicate" onClick={onDuplicate}>
        <Copy />
      </button>
      <button type="button" aria-label="Replace image" title="Replace with another image" className={btn} data-testid="img-bar-replace" onClick={() => file.current?.click()}>
        <RefreshCw />
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg" className="sr-only" data-testid="img-bar-replace-input" aria-label="Choose the new image" onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplace(f); e.target.value = '' }} />
      <button type="button" aria-label="Delete" title="Delete" className={btn} data-testid="img-bar-delete" onClick={onDelete}>
        <Trash2 />
      </button>
    </div>
  )
}

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]

/** a drop-down inside the bar; items are plain buttons, so using them never takes the focus away from the text being edited */
function BarPop({ label, testId, face, children }: { label: string; testId: string; face: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])
  return (
    <div ref={root} className="relative flex">
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} data-testid={testId} className={BAR_CELL} onClick={() => setOpen((v) => !v)}>
        {face}
        <ChevronDown className="!h-3 !w-3 opacity-70" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute left-0 top-full z-30 mt-1.5 max-h-72 min-w-36 overflow-auto rounded-lg border border-ink-200 bg-white py-1 shadow-xl dark:border-ink-700 dark:bg-ink-900">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
const BAR_CELL = 'flex h-9 min-w-9 items-center justify-center gap-0.5 border-r border-ink-200 px-2 text-sm text-ink-700 transition hover:bg-ink-100 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800 [&>svg]:h-4 [&>svg]:w-4'
const BAR_ON = '!bg-brand-600 !text-white dark:!bg-brand-400 dark:!text-ink-950'
const POP_ITEM = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800'

/** Sejda's bar above the text you edit: Bold, Italic, size, font, colour, link, move, duplicate, delete. Centred over the box, on its own row. */
function FloatingTextBar({ o, s, maxX, onPatch, onMove, onDuplicate, onDelete, onLink }: { o: TextObj; s: number; maxX: number; onPatch: (p: Partial<TextObj>) => void; onMove: (e: RPointerEvent) => void; onDuplicate: () => void; onDelete: () => void; onLink: () => void }) {
  const b = outlineBox(o)
  const above = b.y * s >= 56
  const centre = Math.max(170, Math.min((b.x + b.w / 2) * s, maxX - 170))
  const style: CSSProperties = above ? { top: b.y * s - 10, transform: 'translate(-50%, -100%)' } : { top: (b.y + b.h) * s + 10, transform: 'translateX(-50%)' }
  const fontId = o.fontId ?? STD_FONT_ID[o.family]
  return (
    <div
      data-testid="floating-text-bar"
      role="toolbar"
      aria-label="Text"
      className="absolute z-20 flex items-stretch rounded-lg border border-brand-500 bg-white shadow-[0_0_0_3px_rgba(31,157,146,0.22)] dark:bg-ink-900 [&>*:last-child>button]:border-r-0 [&>button:last-child]:border-r-0"
      style={{ ...style, left: centre, whiteSpace: 'nowrap', touchAction: 'none' }}
      onPointerDown={(e) => {
        e.stopPropagation()
        if ((e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault() // keep the focus (and the caret) in the text
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button type="button" aria-label="Bold" aria-pressed={o.bold} title="Bold" className={`${BAR_CELL} rounded-l-lg font-bold ${o.bold ? BAR_ON : ''}`} onClick={async () => { if (o.fontId) await loadFontForDisplay(o.fontId, !o.bold, o.italic); onPatch({ bold: !o.bold }) }}>
        <Bold />
      </button>
      <button type="button" aria-label="Italic" aria-pressed={o.italic} title="Italic" className={`${BAR_CELL} ${o.italic ? BAR_ON : ''}`} onClick={async () => { if (o.fontId) await loadFontForDisplay(o.fontId, o.bold, !o.italic); onPatch({ italic: !o.italic }) }}>
        <Italic />
      </button>
      <BarPop label="Font size" testId="bar-size" face={<span className="text-xs font-bold">TT</span>}>
        {(close) => (
          <>
            <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Size (pt)</div>
            {SIZES.map((n) => (
              <button key={n} type="button" role="menuitemradio" aria-checked={Math.round(o.size) === n} className={`${POP_ITEM} ${Math.round(o.size) === n ? 'font-semibold text-brand-700 dark:text-brand-300' : ''}`} onClick={() => { onPatch({ size: n }); close() }}>
                {n}
              </button>
            ))}
            <label className="flex items-center gap-2 border-t border-ink-100 px-3 pb-1 pt-2 text-xs dark:border-ink-800">
              Other
              <input aria-label="Font size in points" type="number" min={4} max={300} step={0.5} className="input !w-16 !px-1.5 !py-0.5 text-xs" value={o.size} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) onPatch({ size: Math.min(300, v) }) }} />
            </label>
          </>
        )}
      </BarPop>
      <BarPop label="Font" testId="bar-font" face={<span className="text-xs font-semibold">Aa</span>}>
        {(close) =>
          FONTS.map((f) => (
            <button key={f.id} type="button" role="menuitemradio" aria-checked={fontId === f.id} className={`${POP_ITEM} ${fontId === f.id ? 'font-semibold text-brand-700 dark:text-brand-300' : ''}`} style={{ fontFamily: cssStack(f.id) }} onClick={async () => { await loadFontForDisplay(f.id, o.bold, o.italic); onPatch({ fontId: f.id }); close() }}>
              {f.label}
            </button>
          ))
        }
      </BarPop>
      <BarPop
        label="Text colour"
        testId="bar-color"
        face={
          <span className="relative flex">
            <Palette aria-hidden="true" />
            <i className="absolute -bottom-1 left-0 right-0 h-0.5 rounded" style={{ background: o.color }} />
          </span>
        }
      >
        {(close) => (
          <PaletteGrid
            value={o.color}
            onPick={(hex) => {
              onPatch({ color: hex })
              close()
            }}
          />
        )}
      </BarPop>
      <button type="button" aria-label="Link" title="Add link" className={BAR_CELL} onClick={onLink}>
        <Link2 />
      </button>
      <button type="button" aria-label="Move" title="Drag to move" className={`${BAR_CELL} cursor-move`} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onMove(e) }} style={{ touchAction: 'none' }}>
        <Move />
      </button>
      <button type="button" aria-label="Duplicate" title="Duplicate" className={BAR_CELL} onClick={onDuplicate}>
        <Copy />
      </button>
      <button type="button" aria-label="Delete" title="Delete" className={`${BAR_CELL} rounded-r-lg`} onClick={onDelete}>
        <Trash2 />
      </button>
    </div>
  )
}

function FieldPlaceholder({ o, s, selected }: { o: FieldObj; s: number; selected: boolean }) {
  const base: CSSProperties = { left: o.x * s, top: o.y * s, width: o.w * s, height: o.h * s }
  const text = o.fieldKind === 'text' ? (typeof o.value === 'string' && o.value ? o.value : o.name) : o.fieldKind === 'dropdown' ? (typeof o.value === 'string' && o.value) || o.options[0] || '' : ''
  const kind = { text: 'Text field', checkbox: 'Checkbox', radio: 'Radio', dropdown: 'Dropdown' }[o.fieldKind]
  return (
    <>
      <div
        data-testid="field-box"
        data-selected={selected}
        className={`pointer-events-none absolute flex items-center border border-dashed px-1 text-brand-950 ${selected ? 'border-2 border-solid border-brand-600 bg-brand-200/80 shadow-[0_0_0_3px_rgba(31,157,146,0.35)]' : 'border-brand-600 bg-brand-100/80'}`}
        style={{ ...base, fontSize: Math.max(8, Math.min(o.h * s * 0.6, 14 * s)), borderRadius: o.fieldKind === 'radio' ? '50%' : 2 }}
      >
        {o.fieldKind === 'checkbox' && o.value === true && <span aria-hidden="true">✓</span>}
        {o.fieldKind === 'radio' && o.value === true && <span className="mx-auto h-1/2 w-1/2 rounded-full bg-brand-800" aria-hidden="true" />}
        {(o.fieldKind === 'text' || o.fieldKind === 'dropdown') && <span className="truncate opacity-70">{text}</span>}
        {o.fieldKind === 'dropdown' && <span className="ml-auto pl-1" aria-hidden="true">▾</span>}
        {o.required && <span className="absolute -right-1 -top-2 text-sm font-bold leading-none text-red-600" aria-hidden="true">*</span>}
      </div>
      {/* a small tag tells form fields from ordinary text and shapes */}
      <span className="pointer-events-none absolute whitespace-nowrap rounded-sm bg-brand-700 px-1 text-[9px] font-semibold uppercase leading-[13px] tracking-wide text-white" style={{ left: o.x * s, top: o.y * s - 14 }} aria-hidden="true">
        {kind}{o.fieldKind === 'radio' ? ` · ${o.name}` : ''}
      </span>
    </>
  )
}

/** The table under the pointer: thin row / column boundaries and a small handle at the top-left corner. */
function TableHover({ grid, s, onEdit }: { grid: Cell[]; s: number; onEdit: () => void }) {
  const b = gridBounds(grid)
  const xs = [...new Set(grid.flatMap((c) => [Math.round(c.x * 10) / 10, Math.round((c.x + c.w) * 10) / 10]))]
  const ys = [...new Set(grid.flatMap((c) => [Math.round(c.y * 10) / 10, Math.round((c.y + c.h) * 10) / 10]))]
  const line = 'rgba(37,99,235,.55)'
  return (
    <>
      <div data-testid="table-hover" className="pointer-events-none absolute" style={{ left: b.x * s, top: b.y * s, width: b.w * s, height: b.h * s }}>
        {xs.map((x) => (
          <div key={`x${x}`} className="absolute top-0 h-full" style={{ left: (x - b.x) * s, width: 1, background: line }} />
        ))}
        {ys.map((y) => (
          <div key={`y${y}`} className="absolute left-0 w-full" style={{ top: (y - b.y) * s, height: 1, background: line }} />
        ))}
      </div>
      <button
        type="button"
        data-testid="table-handle"
        aria-label="Edit this table"
        title="Edit this table (add or delete rows and columns, resize, shade)"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onEdit()
        }}
        className="absolute flex items-center justify-center rounded border border-blue-600 bg-white text-blue-700 shadow"
        style={{ left: b.x * s - 20, top: b.y * s - 20, width: 18, height: 18, zIndex: 7 }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <rect x="1" y="1" width="10" height="10" />
          <path d="M1 6h10M6 1v10" />
        </svg>
      </button>
    </>
  )
}

/** A selected table: the active cell, and a draggable strip on every column and row boundary. */
function TableEditLayer({ o, s, onDrag }: { o: TableObj; s: number; onDrag: (e: RPointerEvent, kind: 'col' | 'row', idx: number) => void }) {
  const plan = layoutTable(o.data, browserMeasure)
  const a = o.active ?? { r: 0, c: 0 }
  const b = plan.bounds
  return (
    <>
      <div data-testid="table-frame" className="pointer-events-none absolute" style={{ left: b.x * s - 1, top: b.y * s - 1, width: b.w * s + 2, height: b.h * s + 2, border: `1.5px solid ${TEAL}` }} />
      {plan.colX[a.c] !== undefined && plan.rowY[a.r] !== undefined && a.c < o.data.cols.length && a.r < o.data.rows.length && (
        <div data-testid="table-active-cell" className="pointer-events-none absolute" style={{ left: plan.colX[a.c] * s, top: plan.rowY[a.r] * s, width: o.data.cols[a.c] * s, height: plan.rowH[a.r] * s, background: 'rgba(31,157,146,.10)', outline: `2px solid ${TEAL}`, outlineOffset: -1 }} />
      )}
      {o.data.cols.map((_, i) => (
        <div key={`c${i}`} data-testid={`col-handle-${i}`} onPointerDown={(e) => onDrag(e, 'col', i)} className="absolute group" style={{ left: plan.colX[i + 1] * s - 4, top: b.y * s, width: 8, height: b.h * s, cursor: 'col-resize', touchAction: 'none', zIndex: 6 }}>
          <div className="absolute inset-y-0 left-1/2 w-px bg-blue-500/60 group-hover:w-0.5 group-hover:bg-blue-600" />
        </div>
      ))}
      {o.data.rows.map((_, i) => (
        <div key={`r${i}`} data-testid={`row-handle-${i}`} onPointerDown={(e) => onDrag(e, 'row', i)} className="absolute group" style={{ left: b.x * s, top: plan.rowY[i + 1] * s - 4, width: b.w * s, height: 8, cursor: 'row-resize', touchAction: 'none', zIndex: 6 }}>
          <div className="absolute inset-x-0 top-1/2 h-px bg-blue-500/60 group-hover:h-0.5 group-hover:bg-blue-600" />
        </div>
      ))}
    </>
  )
}

ensureFontFaces()

function PageOverlayInner({ info }: { info: OverlayInfo }) {
  const ed = useEditor()
  const { state, dispatch, tool, setTool, defaults, pendingAsset, setPendingAsset, editingId, setEditingId } = ed
  const pageIndex = info.pageNumber - 1
  const s = info.scale
  const W = info.width / s
  const H = info.height / s
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [preview, setPreview] = useState<Drag | null>(null)
  const [hover, setHover] = useState<(Box & { label?: string }) | null>(null)
  const [guides, setGuides] = useState<Guides | null>(null) // alignment lines shown while a move / resize snaps to its neighbours
  const [editingCell, setEditingCell] = useState<{ id: string; r: number; c: number } | null>(null)

  const all = state.present.objects
  // an empty NEW text box is never left on the page: the moment it stops being edited (blur, tool change, export…) it is deleted
  const lastEditing = useRef<string | null>(null)
  useEffect(() => {
    const prev = lastEditing.current
    lastEditing.current = editingId
    if (!prev || prev === editingId) return
    const o = all.find((x) => x.id === prev)
    if (o && o.type === 'text' && o.page === pageIndex && isEmptyNewText(o)) dispatch({ type: 'remove', ids: [prev] })
  }, [editingId, all, pageIndex, dispatch])
  const objects = useMemo(() => all.filter((o) => o.page === pageIndex), [all, pageIndex])
  const selected = useMemo(() => new Set(state.selection), [state.selection])
  const single = state.selection.length === 1 ? all.find((o) => o.id === state.selection[0]) : undefined

  const [snapItems, setSnapItems] = useState<SnapItem[]>([])
  const [pictures, setPictures] = useState<ImageRect[]>([])
  useEffect(() => {
    let alive = true
    ed.images(pageIndex).then((r) => alive && setPictures(r)).catch(() => {})
    return () => {
      alive = false
    }
  }, [ed, pageIndex])
  const liftable = useMemo(() => pictures.filter((r) => !snapItems.some((it) => it.box.x + it.box.w / 2 > r.x && it.box.x + it.box.w / 2 < r.x + r.w && it.box.y + it.box.h / 2 > r.y && it.box.y + it.box.h / 2 < r.y + r.h)), [pictures, snapItems])
  const pictureAt = (p: Pt) => [...liftable].reverse().find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) ?? null
  /** a picture that is part of the PDF becomes a normal image object (select, move, resize, delete, replace); a patch in the page colour hides the original */
  /** Sejda's "Delete existing image": the picture is hidden behind a patch in the page colour (Undo brings it back) */
  const deletePicture = async (r: ImageRect) => {
    const got = await ed.liftImage(pageIndex, r, { backgroundOnly: true })
    if (!got) return
    dispatch({ type: 'add', objects: [makeWhiteout(pageIndex, { x: r.x - 0.5, y: r.y - 0.5, w: r.w + 1, h: r.h + 1 }, got.bg)], select: false })
    ed.notify('Picture deleted. Undo brings it back.')
  }
  const liftPicture = async (r: ImageRect) => {
    const got = await ed.liftImage(pageIndex, r)
    if (!got) return
    const cover = makeWhiteout(pageIndex, { x: r.x - 0.5, y: r.y - 0.5, w: r.w + 1, h: r.h + 1 }, got.bg)
    const img = { ...makeImage('image', pageIndex, { x: r.x, y: r.y, w: r.w, h: r.h }, got.assetId), slot: { x: r.x, y: r.y, w: r.w, h: r.h } }
    dispatch({ type: 'add', objects: [cover, img] })
    dispatch({ type: 'select', ids: [img.id] })
    ed.notify('Picture selected. Drag to move, corners to resize, Delete to remove, or use Replace image.')
  }
  const tableData = single?.type === 'table' ? single.data : null
  useEffect(() => {
    let alive = true
    ed.snap(pageIndex).then((items) => {
      if (alive) setSnapItems(items)
    }).catch(() => {})
    return () => { alive = false }
  }, [ed, pageIndex])

  useEffect(() => {
    if (!tableData || !tableData.modified || !single || single.type !== 'table') return
    const o = single
    if (o.y + o.h > H + 0.5 || o.x + o.w > W + 0.5) {
      ed.warn(`The table now runs past the ${o.y + o.h > H + 0.5 ? 'bottom' : 'right'} edge of the page and will be cut off. Shrink a row or column, delete a row, or click Undo.`)
      return
    }
    const cv = tableData.cover
    const outsideOld = snapItems.filter((it) => !(it.box.x >= cv.x - 1 && it.box.y >= cv.y - 1 && it.box.x + it.box.w <= cv.x + cv.w + 1 && it.box.y + it.box.h <= cv.y + cv.h + 1))
    const msg = overlapWarning(o as unknown as EditorObject, overlappedText({ x: o.x, y: o.y, w: o.w, h: o.h }, outsideOld))
    if (msg) ed.warn(msg.replace('Object covers', 'The table now covers'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableData, W, H])

  const findConvertedObj = (item: SnapItem) => {
    return objects.find((o) => {
      if (o.type !== 'text') return false
      const ox = Math.min(o.x + o.w, item.box.x + item.box.w) - Math.max(o.x, item.box.x)
      const oy = Math.min(o.y + o.h, item.box.y + item.box.h) - Math.max(o.y, item.box.y)
      return ox > item.box.w * 0.4 && oy > item.box.h * 0.4
    })
  }

  const createFromSnap = (item: SnapItem): TextObj => {
    // ordinary positioned text: just the clicked line (tables are only handled by the Table tool)
    const t = textObjFromSnap(item, pageIndex, defaults.text)
    if (t.fontId) void loadFontForDisplay(t.fontId, t.bold, t.italic)
    return t
  }

  /** boxes a dragged object lines up with: the other objects of the page and the pictures that are still part of the page */
  const snapTargets = (skip: Set<string>): Target[] => {
    // a lifted picture's own original place (its cover patch and the page picture under it) is not a neighbour to line up with
    const own = objects.filter((o): o is Extract<EditorObject, { type: 'image' | 'signature' }> => skip.has(o.id) && (o.type === 'image' || o.type === 'signature') && !!o.slot).map((o) => o.slot!)
    const isOwn = (b: Box) => own.some((r) => Math.abs(r.x - b.x) < 1 && Math.abs(r.y - b.y) < 1 && Math.abs(r.w - b.w) < 1.5 && Math.abs(r.h - b.h) < 1.5)
    return [
      ...objects.filter((o) => !skip.has(o.id) && ['image', 'signature', 'whiteout', 'rect', 'ellipse', 'table', 'field', 'text'].includes(o.type)).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h })),
      ...liftable.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      // the text of the page: new text lines up with its columns and baselines
      ...snapItems.filter((it) => it.origin).map((it) => ({ x: it.origin!.x, y: it.box.y, w: it.origin!.w, h: it.box.h, edges: true })),
    ].filter((b) => !isOwn({ x: b.x + 0.5, y: b.y + 0.5, w: b.w - 1, h: b.h - 1 }) && !isOwn(b))
  }

  const toPs = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / s, 0, W), y: clamp((e.clientY - r.top) / s, 0, H) }
  }

  /** a form field or box must never sit on existing content without telling the user */
  const warnIfCovering = (o: EditorObject) => {
    if (!isCoverBox(o)) return
    const msg = overlapWarning(o, overlappedText({ x: o.x, y: o.y, w: o.w, h: o.h }, snapItems))
    if (msg) ed.warn(msg)
  }

  /** the corner handle: turn the detected table into an editable table object (the page is not changed until something is edited) */
  const makeTable = async (cell: Cell) => {
    const obj = await tableObjFromCell(cell, pageIndex)
    dispatch({ type: 'add', objects: [obj] })
    setTool('select') // the row / column boundaries and the property bar work on a selected table
  }

  /** every table the detector found on this page that is not an editable table yet (shown with its cells while the Table tool is active) */
  const [tableSource, setTableSource] = useState<SnapItem[]>([])
  useEffect(() => {
    // tables are looked for ONLY when the Table tool is picked: ordinary editing shows and computes nothing about tables
    if (tool !== 'table') return
    let alive = true
    ed.tableItems(pageIndex).then((items) => alive && setTableSource(items)).catch(() => {})
    return () => {
      alive = false
    }
  }, [tool, ed, pageIndex])
  const detectedTables = useMemo(() => {
    const grids = new Map<Cell[], true>()
    if (tool === 'table') for (const it of tableSource) if (it.cell?.grid) grids.set(it.cell.grid, true)
    const known = (g: Cell[]) => objects.some((o) => o.type === 'table' && Math.abs(o.data.origin.x - g[0].x) < 1.5 && Math.abs(o.data.origin.y - g[0].y) < 1.5)
    return [...grids.keys()].filter((g) => g.length > 0 && !known(g))
  }, [tableSource, objects, tool])
  const tableAt = (p: Pt): Cell[] | null =>
    detectedTables.find((g) => {
      const b = gridBounds(g)
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
    }) ?? null

  const finishAdd = (o: EditorObject) => {
    dispatch({ type: 'add', objects: [o] })
    warnIfCovering(o)
    if (!STICKY_TOOLS.includes(tool)) setTool('select')
  }

  const nextFieldName = (kind: string) => {
    const used = new Set([...all.filter((x) => x.type === 'field').map((x) => (x as FieldObj).name), ...ed.fields.map((f) => f.name)])
    let i = 1
    while (used.has(`${kind}_${i}`)) i++
    return `${kind}_${i}`
  }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const p = toPs(e)
    if (tool === 'select' || tool === 'text') {
      const hit = [...objects].reverse().find((o) => (o.type === 'table' ? (o.data.modified || selected.has(o.id)) && hitTest(o, p, 0) : hitTest(o, p, 5 / s)))
      if (hit && hit.type === 'table') {
        const cell = cellAt(layoutTable(hit.data, browserMeasure), p.x, p.y)
        dispatch({ type: 'select', ids: [hit.id] })
        if (cell) dispatch({ type: 'update', ids: [hit.id], txn: 'tblactive', patch: { active: cell } as Partial<EditorObject> })
        return
      }
      if (!hit) {
        const hitExisting = snapItemAt(snapItems, p)
        if (hitExisting) {
          const already = findConvertedObj(hitExisting)
          if (already) {
            dispatch({ type: 'select', ids: [already.id] })
            if (tool === 'text') {
              e.preventDefault()
              setEditingId(already.id)
              return
            }
            drag.current = { kind: 'move', ids: [already.id], start: p, orig: new Map([[already.id, already]]), txn: newId('mv'), moved: false }
            box.current!.setPointerCapture(e.pointerId)
            return
          }
          const newObj = createFromSnap(hitExisting)
          dispatch({ type: 'add', objects: [newObj] })
          dispatch({ type: 'select', ids: [newObj.id] })
          if (tool === 'text') {
            e.preventDefault() // keep the focus for the editor that opens now
            setEditingId(newObj.id)
            return
          }
          drag.current = { kind: 'move', ids: [newObj.id], start: p, orig: new Map([[newObj.id, newObj]]), txn: newId('mv'), moved: false }
          box.current!.setPointerCapture(e.pointerId)
          ed.notify(`Selected text "${hitExisting.str}". Double-click to edit, or drag to move.`)
          return
        }
        if (tool === 'select') {
          const pic = pictureAt(p)
          if (pic) {
            void liftPicture(pic)
            return
          }
          dispatch({ type: 'select', ids: [] })
          setEditingId(null)
          return
        }
      }
      if (hit && tool === 'text' && hit.type === 'text') {
        // one click on text you added or already edited: edit it
        e.preventDefault()
        dispatch({ type: 'select', ids: [hit.id] })
        setEditingId(hit.id)
        return
      }
      if (hit) {
      let ids = state.selection
      if (e.shiftKey) {
        const was = selected.has(hit.id)
        ids = was ? ids.filter((x) => x !== hit.id) : [...ids, hit.id]
        dispatch({ type: 'select', ids })
        if (was) return
      } else if (!selected.has(hit.id)) {
        ids = [hit.id]
        dispatch({ type: 'select', ids })
      }
      if (editingId && editingId !== hit.id) setEditingId(null)
      box.current!.setPointerCapture(e.pointerId)
      drag.current = { kind: 'move', ids, start: p, orig: new Map(all.filter((o) => ids.includes(o.id)).map((o) => [o.id, o])), txn: newId('mv'), moved: false }
      return
      }
    }
    if (tool === 'delete-image') {
      const pic = pictureAt(p)
      if (pic) void deletePicture(pic)
      else ed.notify('Click a picture of the page to delete it.')
      return
    }
    if (tool === 'table') {
      // a click on a detected table edits THAT table; a click anywhere else inserts a new one
      const g = tableAt(p)
      if (g) {
        e.preventDefault()
        // the clicked cell becomes the active one
        void makeTable(g.find((c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) ?? g[0])
        return
      }
      const known = [...objects].reverse().find((o) => o.type === 'table' && hitTest(o, p, 0))
      if (known) {
        dispatch({ type: 'select', ids: [known.id] })
        setTool('select')
        return
      }
    }
    if (tool === 'image' || tool === 'signature') {
      if (!pendingAsset) {
        ed.notify(tool === 'image' ? 'Choose an image first (use the Image button).' : 'Create a signature first (use the Sign button).')
        return
      }
    }
    box.current!.setPointerCapture(e.pointerId)
    dispatch({ type: 'select', ids: [] })
    if (tool === 'draw') {
      drag.current = { kind: 'draw', pts: [p] }
      setPreview(drag.current)
    } else {
      drag.current = { kind: 'create', tool, a: p, b: p, shift: e.shiftKey }
      setPreview(drag.current)
    }
  }

  const updateHover = (e: RPointerEvent<HTMLDivElement>) => {
    let next: (Box & { label?: string }) | null = null
    if (tool === 'delete-image') {
      const pic = pictureAt(toPs(e))
      if (pic) next = { x: pic.x + TEXT_PAD / s, y: pic.y, w: pic.w - (TEXT_PAD * 2) / s, h: pic.h }
    }
    if ((tool === 'select' || tool === 'text') && !editingId) {
      const p = toPs(e)
      const hit = [...objects].reverse().find((o) => o.type === 'text' && hitTest(o, p, 3 / s))
      if (hit) {
        if (hit.type === 'text' && !selected.has(hit.id)) {
          const b = outlineBox(hit)
          next = { x: b.x, y: b.y, w: b.w, h: b.h }
        }
      } else {
        const it = snapItemAt(snapItems, p, 1)
        if (it && !findConvertedObj(it)) {
          if (it.origin && it.fontSize) {
            const { asc, desc } = ascDesc({ family: it.family ?? 'helvetica', fontId: it.fontId })
            next = { x: it.origin.x, y: it.origin.baseline - asc * it.fontSize, w: it.origin.w, h: (asc + desc) * it.fontSize }
          } else next = it.box
        } else if (!it) {
          const pic = pictureAt(p)
          if (pic) next = { x: pic.x + TEXT_PAD / s, y: pic.y, w: pic.w - (TEXT_PAD * 2) / s, h: pic.h }
        }
      }
    }
    setHover((prev) => (prev === next || (prev && next && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h && prev.label === next.label) ? prev : next))
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) {
      updateHover(e)
      return
    }
    const p = toPs(e)
    switch (d.kind) {
      case 'move': {
        const dx = p.x - d.start.x
        const dy = p.y - d.start.y
        if (!d.moved && Math.hypot(dx, dy) * s < 3) return
        d.moved = true
        let mdx = dx
        let mdy = dy
        const group = d.ids.map((id) => d.orig.get(id)).filter((o): o is EditorObject => !!o)
        if (!e.altKey && group.length) {
          // snap the moved group's edges / centre to its neighbours (hold Alt to move freely)
          const x0 = Math.min(...group.map((o) => o.x)) + dx
          const y0 = Math.min(...group.map((o) => o.y)) + dy
          const x1 = Math.max(...group.map((o) => o.x + o.w)) + dx
          const y1 = Math.max(...group.map((o) => o.y + o.h)) + dy
          const sn = snapMove({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, snapTargets(new Set(d.ids)), 5 / s)
          mdx += sn.dx
          mdy += sn.dy
          setGuides(sn.guides.x.length || sn.guides.y.length ? sn.guides : null)
        } else setGuides(null)
        dispatch({ type: 'update', ids: d.ids, txn: d.txn, patch: (o) => moveObject(d.orig.get(o.id) ?? o, mdx, mdy) })
        break
      }
      case 'resize': {
        const dx = p.x - d.start.x
        const dy = p.y - d.start.y
        const o = d.orig
        const keep = o.type === 'image' || o.type === 'signature' ? o.keepAspect : o.type === 'field' && (o.fieldKind === 'checkbox' || o.fieldKind === 'radio')
        if (o.type === 'text') {
          const nb = resizeBox(o, d.handle, dx, 0, false)
          dispatch({
            type: 'update',
            ids: [o.id],
            txn: d.txn,
            patch: () => {
              const t = { ...(o as TextObj), x: nb.x, w: Math.max(20, nb.w), autoWidth: false }
              return { ...t, h: fitTextBox(t).h }
            },
          })
        } else {
          const rot = rotationOf(o)
          let nb = rot ? resizeRotated(o, d.handle, dx, dy, !!keep, rot) : resizeBox(o, d.handle, dx, dy, !!keep)
          if (!rot && !e.altKey) {
            const sn = snapResize(o, nb, d.handle, !!keep, snapTargets(new Set([o.id])), 5 / s)
            nb = sn.box
            setGuides(sn.guides.x.length || sn.guides.y.length ? sn.guides : null)
          } else setGuides(null)
          dispatch({ type: 'update', ids: [o.id], txn: d.txn, patch: () => applyBox(o, nb) })
        }
        break
      }
      case 'rotate': {
        let deg = (Math.atan2(p.y - d.center.y, p.x - d.center.x) * 180) / Math.PI + 90
        deg = ((((deg + 180) % 360) + 360) % 360) - 180 // -180..180
        const snap = Math.round(deg / 15) * 15
        if (e.shiftKey || Math.abs(deg - snap) < 3) deg = snap
        dispatch({ type: 'update', ids: [d.id], txn: d.txn, patch: { rotation: Math.round(deg * 10) / 10 } as Partial<EditorObject> })
        break
      }
      case 'tblcol':
        dispatch({ type: 'update', ids: [d.id], txn: d.txn, patch: (cur) => retable(resizeCol((cur as TableObj).data, d.c, d.startW + (p.x - d.startX))) as Partial<EditorObject> })
        break
      case 'tblrow':
        dispatch({ type: 'update', ids: [d.id], txn: d.txn, patch: (cur) => retable(resizeRow((cur as TableObj).data, d.r, d.startH + (p.y - d.startY))) as Partial<EditorObject> })
        break
      case 'lineend': {
        const o = d.orig
        if (!hasPts(o)) return
        const pts = [...o.pts] as [Pt, Pt]
        pts[d.which] = p
        const bb = bboxOf(pts)
        dispatch({ type: 'update', ids: [o.id], txn: d.txn, patch: () => ({ pts, ...bb }) as Partial<EditorObject> })
        break
      }
      case 'draw': {
        d.pts.push(p)
        setPreview({ kind: 'draw', pts: [...d.pts] })
        break
      }
      case 'create': {
        d.b = constrain(d.tool, d.a, p, e.shiftKey)
        d.shift = e.shiftKey
        setPreview({ ...d })
        break
      }
    }
  }

  const finishCreate = async (d: Extract<Drag, { kind: 'create' }>) => {
    const b = normBox(d.a, d.b)
    const moved = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) * s >= 4
    const bigEnough = b.w >= 3 && b.h >= 3
    switch (d.tool) {
      case 'text': {
        const hitExisting = !moved ? snapItemAt(snapItems, d.a, 7) : (snapItemsInBox(snapItems, b)[0] ?? null)
        if (hitExisting) {
          const already = findConvertedObj(hitExisting)
          if (already && already.type === 'text') {
            dispatch({ type: 'select', ids: [already.id] })
            setEditingId(already.id)
            return
          }
          const newObj = createFromSnap(hitExisting)
          dispatch({ type: 'add', objects: [newObj] })
          setEditingId(newObj.id)
          return
        }
        if (!moved) {
          const pic = pictureAt(d.a) // a click on a picture of the page picks the picture; dragging across it draws a text box
          if (pic) {
            void liftPicture(pic)
            return
          }
        }
        const o = moved && b.w > 12 ? { ...makeText(pageIndex, { x: b.x, y: b.y }, defaults.text, '', b.w) } : makeText(pageIndex, { x: d.a.x, y: d.a.y - defaults.text.size * 0.5 }, defaults.text)
        dispatch({ type: 'add', objects: [o] })
        setEditingId(o.id)
        return
      }
      case 'table': {
        const w = moved && b.w > 60 ? b.w : Math.min(300, W - 40)
        const x = clamp(moved && b.w > 60 ? b.x : d.a.x, 0, Math.max(0, W - w))
        const y = clamp(moved ? b.y : d.a.y, 0, Math.max(0, H - 70))
        await loadFontForDisplay('liberation-sans', false, false)
        const data = newTable(x, y, w)
        finishAdd({ id: newId('tb'), type: 'table', page: pageIndex, ...retable(data), active: { r: 0, c: 0 } } as TableObj)
        return
      }
      case 'whiteout':
        if (bigEnough) finishAdd(makeWhiteout(pageIndex, b, defaults.whiteout.fill))
        return
      case 'rect':
      case 'ellipse':
        if (bigEnough) finishAdd(makeShape(d.tool, pageIndex, b, defaults.shape))
        return
      case 'line':
      case 'arrow':
        if (moved) finishAdd(makeLine(d.tool, pageIndex, d.a, d.b, defaults.line))
        return
      case 'highlight':
      case 'underline':
      case 'strike': {
        const items = await ed.snap(pageIndex)
        const color = defaults[d.tool].color
        let boxes = moved ? snapToText(items, b) : []
        if (!moved) {
          const hit = itemAt(items, d.a)
          if (hit) boxes = [hit]
        }
        if (!boxes.length && moved && bigEnough) boxes = [b]
        if (!boxes.length) {
          ed.notify(items.length ? 'Drag across the text you want to mark.' : 'This page has no selectable text — drag a rectangle to mark an area.')
          return
        }
        dispatch({ type: 'add', objects: boxes.map((bx) => makeMark(d.tool as 'highlight', pageIndex, bx, color)), select: false })
        return
      }
      case 'link': {
        const bx = bigEnough ? b : { x: d.a.x, y: d.a.y, w: 100, h: 18 }
        finishAdd(makeLink(pageIndex, bx, { kind: 'url', url: 'https://' }))
        // put the cursor straight into the address field so it can be typed
        setTimeout(() => (document.querySelector('[data-testid=link-url]') as HTMLInputElement | null)?.focus(), 60)
        return
      }
      case 'field-text':
      case 'field-checkbox':
      case 'field-radio':
      case 'field-dropdown': {
        const kind = d.tool.replace('field-', '') as FieldObj['fieldKind']
        const dflt = { text: [160, 24], checkbox: [16, 16], radio: [16, 16], dropdown: [140, 24] }[kind]
        const bx = bigEnough ? b : { x: d.a.x, y: d.a.y, w: dflt[0], h: dflt[1] }
        const name = kind === 'radio' ? (all.filter((x): x is FieldObj => x.type === 'field' && x.fieldKind === 'radio').at(-1)?.name ?? nextFieldName('radio')) : nextFieldName(kind)
        const f = makeField(kind, pageIndex, kind === 'checkbox' || kind === 'radio' ? { ...bx, w: Math.min(bx.w, Math.max(bx.h, 10)), h: Math.min(bx.h, Math.max(bx.w, 10)) } : bx, name)
        if (kind === 'radio') {
          const n = all.filter((x) => x.type === 'field' && (x as FieldObj).fieldKind === 'radio' && (x as FieldObj).name === name).length + 1
          f.options = [`Option ${n}`]
        }
        finishAdd(f)
        return
      }
      case 'image':
      case 'signature': {
        if (!pendingAsset) return
        const defW = d.tool === 'signature' ? 150 : Math.min(240, Math.max(40, pendingAsset.width))
        const w = moved && b.w > 10 ? b.w : defW
        const h = w / pendingAsset.aspect
        const x = moved && b.w > 10 ? b.x : clamp(d.a.x - w / 2, 0, Math.max(0, W - w))
        const y = moved && b.w > 10 ? b.y : clamp(d.a.y - h / 2, 0, Math.max(0, H - h))
        const o = makeImage(d.tool, pageIndex, { x, y, w, h }, pendingAsset.id)
        setPendingAsset(null)
        dispatch({ type: 'add', objects: [o] })
        setTool('select')
        return
      }
    }
  }

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setPreview(null)
    setGuides(null)
    if (!d) return
    try {
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    } catch {
      /* already released */
    }
    if (d.kind === 'move' || d.kind === 'resize') {
      const ids = d.kind === 'move' ? d.ids : [d.id]
      for (const id of ids) {
        const cur = state.present.objects.find((x) => x.id === id)
        if (cur) warnIfCovering(cur)
      }
    }
    if (d.kind === 'draw') {
      const pts = thin(d.pts)
      if (pts.length >= 1) dispatch({ type: 'add', objects: [makeDraw(pageIndex, pts, defaults.draw)], select: false })
    } else if (d.kind === 'create') {
      void finishCreate(d)
    }
  }

  const startResize = (e: RPointerEvent, o: EditorObject, handle: Handle) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const base = o.type === 'text' && o.autoWidth ? { ...o, w: outlineBox(o).w } : o
    drag.current = { kind: 'resize', id: o.id, handle, start: toPs(e), orig: base, txn: newId('rs') }
  }
  const startRotate = (e: RPointerEvent, o: EditorObject) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { kind: 'rotate', id: o.id, center: boxCenter(o), txn: newId('ro') }
  }
  const startLineEnd = (e: RPointerEvent, o: EditorObject, which: 0 | 1) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { kind: 'lineend', id: o.id, which, orig: o, txn: newId('le') }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'select' && tool !== 'text') return
    const p = toPs(e)
    const tb = [...objects].reverse().find((o) => o.type === 'table' && (o.data.modified || selected.has(o.id)) && hitTest(o, p, 0))
    if (tb && tb.type === 'table') {
      const cell = cellAt(layoutTable(tb.data, browserMeasure), p.x, p.y)
      if (cell) {
        dispatch({ type: 'select', ids: [tb.id] })
        setEditingCell({ id: tb.id, r: cell.r, c: cell.c })
      }
      return
    }
    const hit = [...objects].reverse().find((o) => o.type === 'text' && hitTest(o, p, 4 / s))
    if (hit) {
      dispatch({ type: 'select', ids: [hit.id] })
      setEditingId(hit.id)
      return
    }
    const hitExisting = snapItemAt(snapItems, p)
    if (hitExisting) {
      const already = findConvertedObj(hitExisting)
      if (already && already.type === 'text') {
        dispatch({ type: 'select', ids: [already.id] })
        setEditingId(already.id)
        return
      }
      const newObj = createFromSnap(hitExisting)
      dispatch({ type: 'add', objects: [newObj] })
      setEditingId(newObj.id)
      ed.notify(`Editing existing text.`)
      return
    }
    // double-click on a picture: add a text box right there (a single click picks the picture)
    if (pictureAt(p) || objects.some((o) => (o.type === 'image' || o.type === 'signature') && hitTest(o, p, 0))) {
      const t = makeText(pageIndex, { x: p.x, y: p.y - defaults.text.size * 0.5 }, defaults.text)
      dispatch({ type: 'add', objects: [t] })
      dispatch({ type: 'select', ids: [t.id] })
      setEditingId(t.id)
    }
  }

  const editText = (o: TextObj, text: string) => {
    dispatch({
      type: 'update',
      ids: [o.id],
      txn: `edit-${o.id}`,
      patch: (cur) => {
        const t = { ...(cur as TextObj), text }
        const fit = fitTextBox(t)
        return { text, w: t.autoWidth ? Math.max(t.w, fit.w) : t.w, h: Math.max(t.h, fit.h) }
      },
    })
  }
  const doneEditing = (o: TextObj) => {
    setEditingId(null)
    const cur = state.present.objects.find((x) => x.id === o.id) as TextObj | undefined
    if (cur && isEmptyNewText(cur)) dispatch({ type: 'remove', ids: [o.id] })
  }

  const creating = tool !== 'select'
  const selectLike = tool === 'select' || tool === 'text' // the Text tool also selects, moves and resizes what is already there
  const cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair'

  const px = (v: number) => v * s
  const handleSize = 10

  return (
    <div
      ref={box}
      role="group"
      aria-label={`Editing layer, page ${info.pageNumber}`}
      data-testid="page-overlay"
      data-page-index={pageIndex}
      className="absolute inset-0 select-none overflow-hidden"
      style={{ cursor, touchAction: creating ? 'none' : 'pan-x pan-y pinch-zoom' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
    >
      {objects.map((o) => (
        <div key={o.id}>
          <ObjectShape o={o} s={s} W={W} H={H} />
          {o.type === 'text' && o.orig && o.fill && !isUnchanged(o) && o.orig.block && (
            <>
              {o.orig.block.runs.map((r, ri) => (
                <div key={ri} className="pointer-events-none absolute" style={{ left: px(r.x) - 1, top: px(r.baseline - o.orig!.size * 0.92), width: px(r.w) + 2, height: px(o.orig!.size * 1.22), background: o.fill }} />
              ))}
            </>
          )}
          {o.type === 'text' && o.orig && o.fill && !o.orig.block && !isUnchanged(o) && (
            <div className="pointer-events-none absolute" style={{ left: px(o.orig.x) - 1, top: px(o.orig.baseline - o.orig.size * 0.8), width: px(o.orig.w) + 2, height: px(o.orig.size * 1.14), background: o.fill }} />
          )}
          {o.type === 'table' && <TableView o={o} s={s} W={W} H={H} />}
          {o.type === 'text' && <TextView o={o} s={s} editing={editingId === o.id} onChange={(t) => editText(o, t)} onDone={() => doneEditing(o)} />}
          {(o.type === 'image' || o.type === 'signature') && ed.assetUrl(o.assetId) && (
            <img src={ed.assetUrl(o.assetId)} alt="" draggable={false} data-testid="placed-image" className="pointer-events-none absolute" style={{ left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h), opacity: o.opacity ?? 1, transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined, transformOrigin: 'center' }} />
          )}
          {o.type === 'link' && (
            <div className="pointer-events-none absolute border border-dashed border-blue-600 bg-blue-500/10" style={{ left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h) }}>
              <Link2 className="absolute -top-2.5 -left-2.5 h-4 w-4 rounded-full bg-blue-600 p-0.5 text-white" aria-hidden="true" />
              {o.target.kind === 'url' && (
                <span data-testid="link-label" className="absolute left-0 top-full mt-0.5 max-w-[22rem] truncate rounded bg-blue-700 px-1 text-[10px] leading-4 text-white">
                  {o.target.url}
                </span>
              )}
            </div>
          )}
          {o.type === 'field' && <FieldPlaceholder o={o} s={s} selected={selected.has(o.id)} />}
          {/* focusable stand-in so keyboard users can reach every object */}
          <div
            role="button"
            tabIndex={0}
            aria-label={`${label(o)} on page ${info.pageNumber}${selected.has(o.id) ? ', selected' : ''}`}
            aria-pressed={selected.has(o.id)}
            onFocus={() => selectLike && !selected.has(o.id) && dispatch({ type: 'select', ids: [o.id] })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && o.type === 'text') setEditingId(o.id)
            }}
            className="pointer-events-none absolute opacity-0 focus:opacity-100"
            style={{ left: px(o.x), top: px(o.y), width: px(Math.max(o.w, 6)), height: px(Math.max(o.h, 6)), outline: selected.has(o.id) ? undefined : undefined }}
          />
        </div>
      ))}

      {selectLike && <FormFillLayer pageIndex={pageIndex} s={s} />}

      {/* selection outlines */}
      {selectLike &&
        objects
          .filter((o) => selected.has(o.id))
.map((o) =>
            o.type === 'text' ? (
              <TextOutline
                key={`sel-${o.id}`}
                o={o}
                s={s}
                onMove={(e) => {
                  ;(e.target as Element).setPointerCapture(e.pointerId)
                  drag.current = { kind: 'move', ids: [o.id], start: toPs(e), orig: new Map([[o.id, o]]), txn: newId('mv'), moved: false }
                }}
              />
            ) : (
            <div key={`sel-${o.id}`} data-testid="selection-box" className="pointer-events-none absolute border-[1.5px] border-dashed border-brand-500" style={{ left: px(o.x) - 2, top: px(o.y) - 2, width: px(o.w) + 4, height: px(o.h) + 4, transform: rotationOf(o) ? `rotate(${rotationOf(o)}deg)` : undefined }} />
            ),
          )}

      {/* hover: a light fill, never a border */}
      {guides && (
        <>
          {guides.x.map((x) => (
            <div key={`gx${x}`} data-testid="align-guide" className="pointer-events-none absolute" style={{ left: px(x), top: 0, width: 0, height: '100%', borderLeft: '1.5px dotted #f59e0b', zIndex: 9 }} />
          ))}
          {guides.y.map((y) => (
            <div key={`gy${y}`} data-testid="align-guide" className="pointer-events-none absolute" style={{ left: 0, top: px(y), height: 0, width: '100%', borderTop: '1.5px dotted #f59e0b', zIndex: 9 }} />
          ))}
        </>
      )}
      {(selectLike || tool === 'delete-image') && hover && !drag.current &&
        (hover.label ? (
          <div data-testid="hover-cell" className="pointer-events-none absolute" style={{ left: px(hover.x), top: px(hover.y), width: px(hover.w), height: px(hover.h), background: 'rgba(59,130,246,.10)' }}>
            <span className="absolute left-0 top-0 rounded-br bg-blue-600 px-1 text-[10px] font-semibold leading-4 text-white">Cell {hover.label}</span>
          </div>
        ) : (
          <div data-testid="hover-box" className="pointer-events-none absolute" style={{ left: px(hover.x) - TEXT_PAD, top: px(hover.y), width: px(hover.w) + TEXT_PAD * 2, height: px(hover.h), background: 'rgba(31,157,146,.14)' }} />
        ))}

      {/* handles for a single selection on this page */}
      {selectLike && single && single.type === 'text' && single.page === pageIndex && (['w', 'e'] as Handle[]).map((h) => {
        const b = outlineBox(single)
        return (
          <div
            key={h}
            data-testid={`handle-${h}`}
            onPointerDown={(e) => startResize(e, single, h)}
            className="absolute"
            style={{ left: h === 'w' ? b.x * s - TEXT_PAD - 14 : b.x * s + b.w * s + TEXT_PAD + 6, top: (b.y + b.h / 2) * s - 4, width: 8, height: 8, background: '#fff', border: `1px solid ${TEAL}`, boxSizing: 'border-box', cursor: 'ew-resize', touchAction: 'none', zIndex: 5 }}
          />
        )
      })}
      {selectLike && single && single.type === 'text' && single.page === pageIndex && (
        <FloatingTextBar
          o={single}
          s={s}
          maxX={W * s}
          onPatch={(patch) => dispatch({ type: 'update', ids: [single.id], txn: `fl:${single.id}:${Object.keys(patch).join('+')}`, patch: (cur) => textPatch(cur as TextObj, patch) as Partial<EditorObject> })}
          onMove={(e) => {
            ;(e.target as Element).setPointerCapture(e.pointerId)
            drag.current = { kind: 'move', ids: [single.id], start: toPs(e), orig: new Map([[single.id, single]]), txn: newId('mv'), moved: false }
          }}
          onDuplicate={() => dispatch({ type: 'add', objects: cloneObjects([single], state.present.objects, 12, 12, ed.fields.map((x) => x.name)) })}
          onDelete={() => dispatch({ type: 'remove', ids: [single.id] })}
          onLink={() => {
            const url = window.prompt('Link URL', 'https://')
            if (!url || !url.trim()) return
            const b = outlineBox(single)
            dispatch({ type: 'add', objects: [makeLink(pageIndex, { x: b.x, y: b.y, w: b.w, h: b.h }, { kind: 'url', url: url.trim() })], select: false })
          }}
        />
      )}
      {selectLike && single && (single.type === 'image' || single.type === 'signature') && single.page === pageIndex && editingId !== single.id && (
        <ImageFloatingBar
          o={single}
          s={s}
          maxX={W * s}
          onRotate={() => dispatch({ type: 'update', ids: [single.id], txn: `rot:${single.id}`, patch: { rotation: ((((single.rotation ?? 0) + 90) % 360) + 540) % 360 - 180 } as Partial<EditorObject> })}
          onDuplicate={() => dispatch({ type: 'add', objects: cloneObjects([single], state.present.objects, 12, 12, ed.fields.map((x) => x.name)) })}
          onReplace={async (file) => {
            const r = await replacementPatch(single, file, ed.addAsset)
            if (typeof r === 'string') ed.notify(r)
            else dispatch({ type: 'update', ids: [single.id], txn: `repl:${single.id}:${Date.now()}`, patch: r as Partial<EditorObject> })
          }}
          onDelete={() => dispatch({ type: 'remove', ids: [single.id] })}
        />
      )}
      {selectLike && single && single.type !== 'text' && single.type !== 'table' && single.page === pageIndex && editingId !== single.id && (
        <>
          {(single.type === 'line' || single.type === 'arrow') &&
            single.pts.map((pt, i) => (
              <div
                key={i}
                data-testid={`line-handle-${i}`}
                onPointerDown={(e) => startLineEnd(e, single, i as 0 | 1)}
                className="absolute rounded-full border-2 border-brand-500 bg-white"
                style={{ left: px(pt.x) - handleSize / 2, top: px(pt.y) - handleSize / 2, width: handleSize, height: handleSize, cursor: 'move', touchAction: 'none' }}
              />
            ))}
          {single.type !== 'line' &&
            single.type !== 'arrow' &&
            HANDLES.filter((h) => (single.type === 'image' || single.type === 'signature' ? true : single.type === 'field' && (single.fieldKind === 'checkbox' || single.fieldKind === 'radio') ? h.length === 2 : true)).map((h) => {
              const hp = rotateAbout({ x: single.x + single.w * HANDLE_POS[h][0], y: single.y + single.h * HANDLE_POS[h][1] }, boxCenter(single), rotationOf(single))
              return (
              <div
                key={h}
                data-testid={`handle-${h}`}
                onPointerDown={(e) => startResize(e, single, h)}
                className="absolute border-2 border-brand-500 bg-white"
                style={{
                  left: px(hp.x) - handleSize / 2,
                  top: px(hp.y) - handleSize / 2,
                  width: handleSize,
                  height: handleSize,
                  borderRadius: 2,
                  cursor: rotationOf(single) ? 'grab' : HANDLE_CURSOR[h],
                  touchAction: 'none',
                }}
              />
              )
            })}
          {(single.type === 'image' || single.type === 'signature') && (() => {
            const c = boxCenter(single)
            const knob = rotateAbout({ x: c.x, y: single.y - 26 / s }, c, rotationOf(single))
            return (
              <div
                data-testid="rotate-handle"
                title="Drag to rotate (Shift snaps to 15 degrees)"
                onPointerDown={(e) => startRotate(e, single)}
                className="absolute rounded-full border-2 border-brand-500 bg-white"
                style={{ left: px(knob.x) - handleSize / 2, top: px(knob.y) - handleSize / 2, width: handleSize, height: handleSize, cursor: 'grab', touchAction: 'none' }}
              />
            )
          })()}
        </>
      )}

      {tool === 'table' &&
        detectedTables.map((g) => (
          <div key={g[0].id} data-testid="table-detected">
            <TableHover grid={g} s={s} onEdit={() => void makeTable(g[0])} />
            {g.map((c) => (
              <div key={c.id} data-testid="table-detected-cell" className="pointer-events-none absolute" style={{ left: c.x * s, top: c.y * s, width: c.w * s, height: c.h * s, background: 'rgba(37,99,235,.06)' }} />
            ))}
          </div>
        ))}
      {selectLike && single && single.type === 'table' && single.page === pageIndex && (
        <TableEditLayer
          o={single}
          s={s}
          onDrag={(e, kind, idx) => {
            e.stopPropagation()
            e.preventDefault()
            ;(e.target as Element).setPointerCapture(e.pointerId)
            const plan = layoutTable(single.data, browserMeasure)
            const pt = toPs(e)
            drag.current = kind === 'col' ? { kind: 'tblcol', id: single.id, c: idx, startX: pt.x, startW: plan.colX[idx + 1] - plan.colX[idx], txn: newId('tc') } : { kind: 'tblrow', id: single.id, r: idx, startY: pt.y, startH: plan.rowH[idx], txn: newId('tr') }
          }}
        />
      )}
      {editingCell && (() => {
        const tb = objects.find((o) => o.id === editingCell.id)
        if (!tb || tb.type !== 'table') return null
        const plan = layoutTable(tb.data, browserMeasure)
        const cell = tb.data.rows[editingCell.r]?.cells[editingCell.c]
        if (!cell) return null
        const left = plan.colX[editingCell.c]
        const top = plan.rowY[editingCell.r]
        return (
          <textarea
            autoFocus
            data-testid="table-cell-editor"
            aria-label={`Table cell row ${editingCell.r + 1}, column ${editingCell.c + 1}`}
            value={cell.text}
            spellCheck={false}
            onChange={(e) => dispatch({ type: 'update', ids: [tb.id], txn: `tcell-${tb.id}`, patch: (cur) => retable(setCellText((cur as TableObj).data, editingCell.r, editingCell.c, e.target.value)) as Partial<EditorObject> })}
            onBlur={() => setEditingCell(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditingCell(null)
              e.stopPropagation()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ position: 'absolute', left: px(left), top: px(top), width: px(tb.data.cols[editingCell.c]), height: px(plan.rowH[editingCell.r]), boxSizing: 'border-box', padding: `${px(Math.max(0, cell.firstBaseline - cell.size))}px ${px(cell.padR)}px 0 ${px(cell.padL)}px`, fontFamily: cssStack(cell.fontId), fontSize: px(cell.size), fontWeight: cell.bold ? 700 : 400, fontStyle: cell.italic ? 'italic' : 'normal', fontKerning: 'none', lineHeight: `${px(cell.leading)}px`, color: cell.color, background: cell.fill ?? '#ffffff', border: '2px solid #1f9d92', outline: 'none', resize: 'none', overflow: 'hidden', zIndex: 8 }}
          />
        )
      })()}
      {ed.debug && <DebugLayer pageIndex={pageIndex} s={s} />}

      {/* live preview while creating */}
      {preview?.kind === 'create' && <CreatePreview d={preview} s={s} W={W} H={H} defaults={defaults} />}
      {preview?.kind === 'draw' && (
        <svg className="pointer-events-none absolute left-0 top-0" width={W * s} height={H * s} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <path d={svgPathD(preview.pts)} fill="none" stroke={defaults.draw.stroke} strokeWidth={defaults.draw.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}

function CreatePreview({ d, s, W, H, defaults }: { d: Extract<Drag, { kind: 'create' }>; s: number; W: number; H: number; defaults: ReturnType<typeof useEditor>['defaults'] }) {
  const b = normBox(d.a, d.b)
  if (d.tool === 'line' || d.tool === 'arrow') {
    const o = makeLine(d.tool, 0, d.a, d.b, defaults.line)
    return <ObjectShape o={o} s={s} W={W} H={H} />
  }
  const style: CSSProperties = { left: b.x * s, top: b.y * s, width: b.w * s, height: b.h * s }
  const color = d.tool === 'whiteout' ? 'border-ink-400 bg-white/80' : d.tool === 'highlight' ? 'border-yellow-500 bg-yellow-300/40' : d.tool === 'link' ? 'border-blue-600 bg-blue-500/10' : 'border-brand-500 bg-brand-500/10'
  return <div className={`pointer-events-none absolute border border-dashed ${color}`} style={{ ...style, borderRadius: d.tool === 'ellipse' ? '50%' : 0 }} />
}

export const PageOverlay = memo(PageOverlayInner)
