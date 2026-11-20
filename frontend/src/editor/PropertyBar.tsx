import { useEffect, useState } from 'react'
import { AlignCenter, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, AlignCenterHorizontal, AlignCenterVertical, AlignVerticalSpaceBetween, Bold, ChevronsDown, ChevronsUp, Copy, Italic, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { useEditor, type ToolId } from './EditorContext'
import { HIGHLIGHT_COLORS } from './objects'
import { textPatch } from './textEdit'
import { FONTS, fontInfo, loadFontForDisplay, missingGlyphs, suggestFontFor, type FontId } from './fontCatalog'
import type { EditorObject, FieldObj, FieldValidation, ImageObj, LinkObj, TableObj, TextObj } from './types'
import { cloneObjects } from './objects'
import { replacementPatch } from './imageReplace'
import { alignDeltas, moveObject, type AlignMode } from './geometry'
import { normalizeUrl } from './urlNormalize'
import { addCol, addRow, deleteCol, deleteRow, setBorder, setCellFill, setColFill, setRowFill, type TableData } from './tableModel'
import { retable } from './tableView'

const field = 'flex items-center gap-1.5 text-xs text-ink-600 dark:text-ink-300'
const num = 'input !w-16 !px-2 !py-1'
const SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72]
const STD_FONT: Record<string, FontId> = { helvetica: 'liberation-sans', times: 'liberation-serif', courier: 'liberation-mono' }

/** Warns when the typed text has characters the chosen font cannot draw, and offers a font that can. */
function GlyphWarning({ t, onUse }: { t: TextObj; onUse: (id: FontId) => void }) {
  const id = t.fontId ?? STD_FONT[t.family]
  const [warn, setWarn] = useState<{ chars: string[]; alt: FontId | null } | null>(null)
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      missingGlyphs(id, t.text)
        .then(async (chars) => {
          if (!alive) return
          if (!chars.length) return setWarn(null)
          const alt = await suggestFontFor(t.text, id)
          if (alive) setWarn({ chars, alt })
        })
        .catch(() => alive && setWarn(null))
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id, t.text])
  if (!warn) return null
  return (
    <span role="alert" data-testid="glyph-warning" className="flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
      {fontInfo(id).label} has no glyph for “{warn.chars.slice(0, 6).join(' ')}”.
      {warn.alt ? (
        <button type="button" className="font-semibold underline" onClick={() => onUse(warn.alt as FontId)}>
          Use {fontInfo(warn.alt).label}
        </button>
      ) : (
        ' No bundled font has it.'
      )}
    </span>
  )
}

function ColorInput({ label, value, onChange, testId }: { label: string; value: string; onChange: (c: string) => void; testId?: string }) {
  return (
    <span className={field}>
      {label}
      <ColorPicker variant="swatch" label={label} value={value} onChange={onChange} testId={testId} />
    </span>
  )
}

function Icon({ on, label, onClick, children }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} title={label} onClick={onClick} className={`rounded-lg p-1.5 [&>svg]:h-4 [&>svg]:w-4 ${on ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-ink-950' : 'text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'}`}>
      {children}
    </button>
  )
}

type Group = 'table' | 'text' | 'shape' | 'line' | 'draw' | 'highlight' | 'underline' | 'strike' | 'whiteout' | 'link' | 'field' | 'image' | null

const toolGroup = (t: ToolId): Group => (t === 'text' ? 'text' : t === 'rect' || t === 'ellipse' ? 'shape' : t === 'line' || t === 'arrow' ? 'line' : t === 'draw' ? 'draw' : t === 'highlight' || t === 'underline' || t === 'strike' || t === 'whiteout' ? t : t === 'link' ? 'link' : t.startsWith('field-') ? 'field' : t === 'table' ? 'table' : null)
const objGroup = (o: EditorObject): Group => (o.type === 'rect' || o.type === 'ellipse' ? 'shape' : o.type === 'line' || o.type === 'arrow' ? 'line' : o.type === 'image' || o.type === 'signature' ? 'image' : (o.type as Group))

export function PropertyBar() {
  const { state, dispatch, tool, defaults, setDefaults, fields } = useEditor()
  const sel = state.present.objects.filter((o) => state.selection.includes(o.id))
  const first = sel[0]
  const group: Group = first && sel.every((o) => objGroup(o) === objGroup(first)) ? objGroup(first) : first ? null : toolGroup(tool)
  const ids = sel.map((o) => o.id)
  const detectedNames = fields.map((x) => x.name)
  const align = (mode: AlignMode) => {
    const d = new Map(sel.map((o, i) => [o.id, alignDeltas(sel, mode)[i]]))
    dispatch({ type: 'update', ids, txn: `align:${mode}:${ids.join(',')}`, patch: (o) => moveObject(o, d.get(o.id)?.dx ?? 0, d.get(o.id)?.dy ?? 0) })
  }

  const patchSel = (key: string, patch: Partial<EditorObject> | ((o: EditorObject) => Partial<EditorObject>)) => {
    if (ids.length) dispatch({ type: 'update', ids, patch, txn: `prop:${ids.join(',')}:${key}` })
  }
  const setText = (patch: Partial<TextObj>) => {
    setDefaults((d) => ({ ...d, text: { ...d.text, ...(patch as object) } }))
    patchSel(Object.keys(patch).join('+'), (o) => textPatch(o as TextObj, patch) as Partial<EditorObject>)
  }

  const t = (first && first.type === 'text' ? first : { ...defaults.text }) as TextObj
  const shape = first && (first.type === 'rect' || first.type === 'ellipse') ? first : { ...defaults.shape }
  const line = first && (first.type === 'line' || first.type === 'arrow') ? first : { ...defaults.line }
  const draw = first && first.type === 'draw' ? first : { ...defaults.draw }
  const markColor = (g: 'highlight' | 'underline' | 'strike') => (first && first.type === g ? first.color : defaults[g].color)

  return (
    <div className="flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-ink-200 bg-ink-50 px-3 py-1.5 dark:border-ink-800 dark:bg-ink-950" role="region" aria-label="Properties" data-testid="property-bar">
      {group === 'text' && (
        <>
          {t.fontUsed && (
            <span className={field} data-testid="font-used">
              Font used: <b className="font-semibold text-ink-800 dark:text-ink-100">{t.fontUsed}</b>
            </span>
          )}
          <label className={field}>
            Font
            <select
              aria-label="Font family"
              className="input !w-auto !py-1"
              value={t.fontId ?? STD_FONT[t.family]}
              onChange={async (e) => {
                const fontId = e.target.value as FontId
                await loadFontForDisplay(fontId, t.bold, t.italic)
                setText({ fontId })
              }}
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            Size
            <input
              aria-label="Font size"
              type="number"
              min={4}
              max={200}
              step={0.5}
              className={num}
              value={t.size}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v > 0) setText({ size: Math.max(1, Math.min(300, v)) })
              }}
            />
            <select aria-label="Font size presets" className="input !w-auto !py-1" value={SIZE_PRESETS.includes(t.size) ? t.size : ''} onChange={(e) => e.target.value && setText({ size: Number(e.target.value) })}>
              <option value="">▾</option>
              {SIZE_PRESETS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <ColorInput label="Color" value={t.color} onChange={(color) => setText({ color })} testId="prop-color" />
          <div className="flex gap-0.5" role="group" aria-label="Style">
            <Icon on={t.bold} label="Bold" onClick={async () => { if (t.fontId) await loadFontForDisplay(t.fontId, !t.bold, t.italic); setText({ bold: !t.bold }) }}>
              <Bold />
            </Icon>
            <Icon on={t.italic} label="Italic" onClick={async () => { if (t.fontId) await loadFontForDisplay(t.fontId, t.bold, !t.italic); setText({ italic: !t.italic }) }}>
              <Italic />
            </Icon>
          </div>
          <div className="flex gap-0.5" role="group" aria-label="Alignment">
            <Icon on={t.align === 'left'} label="Align left" onClick={() => setText({ align: 'left' })}>
              <AlignLeft />
            </Icon>
            <Icon on={t.align === 'center'} label="Align center" onClick={() => setText({ align: 'center' })}>
              <AlignCenter />
            </Icon>
            <Icon on={t.align === 'right'} label="Align right" onClick={() => setText({ align: 'right' })}>
              <AlignRight />
            </Icon>
          </div>
          {first?.type === 'text' && (
            <GlyphWarning
              t={t}
              onUse={async (fontId) => {
                await loadFontForDisplay(fontId, t.bold, t.italic)
                setText({ fontId })
              }}
            />
          )}
        </>
      )}
      {group === 'shape' && (
        <>
          <ColorInput label="Outline" value={shape.stroke ?? '#000000'} onChange={(stroke) => { setDefaults((d) => ({ ...d, shape: { ...d.shape, stroke } })); patchSel('stroke', { stroke } as Partial<EditorObject>) }} testId="prop-stroke" />
          <label className={field}>
            Width
            <input aria-label="Outline width" type="number" min={0} max={30} step={0.5} className={num} value={shape.strokeWidth} onChange={(e) => { const strokeWidth = Math.max(0, Number(e.target.value) || 0); setDefaults((d) => ({ ...d, shape: { ...d.shape, strokeWidth } })); patchSel('sw', { strokeWidth } as Partial<EditorObject>) }} />
          </label>
          <label className={field}>
            <input type="checkbox" checked={shape.fill !== null} onChange={(e) => { const fill = e.target.checked ? '#fde68a' : null; setDefaults((d) => ({ ...d, shape: { ...d.shape, fill } })); patchSel('fill', { fill } as Partial<EditorObject>) }} />
            Fill
          </label>
          {shape.fill !== null && <ColorInput label="Fill color" value={shape.fill} onChange={(fill) => { setDefaults((d) => ({ ...d, shape: { ...d.shape, fill } })); patchSel('fillc', { fill } as Partial<EditorObject>) }} />}
        </>
      )}
      {(group === 'line' || group === 'draw') && (
        <>
          <ColorInput label="Color" value={(group === 'line' ? line : draw).stroke} onChange={(stroke) => { setDefaults((d) => ({ ...d, [group]: { ...d[group], stroke } })); patchSel('stroke', { stroke } as Partial<EditorObject>) }} testId="prop-stroke" />
          <label className={field}>
            Width
            <input aria-label="Line width" type="number" min={0.5} max={30} step={0.5} className={num} value={(group === 'line' ? line : draw).strokeWidth} onChange={(e) => { const strokeWidth = Math.max(0.5, Number(e.target.value) || 1); setDefaults((d) => ({ ...d, [group]: { ...d[group], strokeWidth } })); patchSel('sw', { strokeWidth } as Partial<EditorObject>) }} />
          </label>
        </>
      )}
      {(group === 'highlight' || group === 'underline' || group === 'strike') && (
        <div className={field} role="group" aria-label="Color">
          Color
          {(group === 'highlight' ? HIGHLIGHT_COLORS : ['#dc2626', '#111827', '#2563eb', '#16a34a']).map((c) => (
            <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={markColor(group) === c} onClick={() => { setDefaults((d) => ({ ...d, [group]: { color: c } })); patchSel('mc', { color: c } as Partial<EditorObject>) }} className={`h-6 w-6 rounded-full border-2 ${markColor(group) === c ? 'border-brand-600' : 'border-transparent'}`} style={{ background: c }} />
          ))}
          <span className="text-ink-500">Drag across text to snap to its lines.</span>
        </div>
      )}
      {group === 'whiteout' && <ColorInput label="Cover color" value={first?.type === 'whiteout' ? first.fill : defaults.whiteout.fill} onChange={(fill) => { setDefaults((d) => ({ ...d, whiteout: { fill } })); patchSel('wf', { fill } as Partial<EditorObject>) }} />}
      {group === 'link' && first?.type === 'link' && sel.length === 1 && <LinkProps o={first} onChange={(target) => patchSel('link', { target } as Partial<EditorObject>)} onOutline={(showBorder) => patchSel('linkb', { showBorder } as Partial<EditorObject>)} />}
      {group === 'link' && !first && <span className="text-xs text-ink-600 dark:text-ink-300">Drag a rectangle over the area that should open a web address or jump to a page.</span>}
      {group === 'table' && !(first?.type === 'table') && (
        <span className="text-xs text-ink-600 dark:text-ink-300" data-testid="table-hint">
          Click a highlighted table on the page to edit it (rows, columns, shading, borders), or click / drag on an empty spot to insert a new table.
        </span>
      )}
      {group === 'table' && first?.type === 'table' && sel.length === 1 && (
        <TableProps
          o={first}
          apply={(f) =>
            patchSel('tbl', (cur) => {
              const t = cur as TableObj
              const a = t.active ?? { r: 0, c: 0 }
              const res = f(t.data, a)
              const data = 'rows' in res ? res : res.data
              const active = 'rows' in res ? { r: Math.min(a.r, data.rows.length - 1), c: Math.min(a.c, data.cols.length - 1) } : res.active
              return { ...retable(data), active } as Partial<EditorObject>
            })
          }
        />
      )}
      {group === 'field' && first?.type === 'field' && sel.length === 1 && <FieldProps o={first} others={state.present.objects.filter((x): x is FieldObj => x.type === 'field' && x.id !== first.id)} detectedNames={detectedNames} onChange={(p) => patchSel('field', p as Partial<EditorObject>)} />}
      {group === 'field' && !first && <span className="text-xs text-ink-600 dark:text-ink-300">Form field: drag on the page to place it (or click for a default size). Radio buttons with the same group name belong together. You can rename it, make it required and more once it is placed.</span>}
      {group === 'image' && first && (first.type === 'image' || first.type === 'signature') && sel.length === 1 && <ImageProps o={first} onChange={(p) => patchSel('img', p as Partial<EditorObject>)} />}
      {group === 'image' && !(first && sel.length === 1) && <span className="text-xs text-ink-600 dark:text-ink-300">Drag the corners to resize (aspect ratio is kept).</span>}
      {!group && !first && <span className="text-xs text-ink-600 dark:text-ink-300">Pick a tool, or select an object to change it. Double-click text to edit. Shift-click selects several.</span>}
      {first && sel.length > 1 && (
        <>
          <span className="text-xs text-ink-600 dark:text-ink-300">{sel.length} objects selected</span>
          <div className="flex items-center gap-0.5" role="group" aria-label="Align" data-testid="align-group">
            <Icon label="Align left edges" onClick={() => align('left')}>
              <AlignStartVertical />
            </Icon>
            <Icon label="Align centres" onClick={() => align('center')}>
              <AlignCenterVertical />
            </Icon>
            <Icon label="Align right edges" onClick={() => align('right')}>
              <AlignEndVertical />
            </Icon>
            <Icon label="Align top edges" onClick={() => align('top')}>
              <AlignStartHorizontal />
            </Icon>
            <Icon label="Align middles" onClick={() => align('middle')}>
              <AlignCenterHorizontal />
            </Icon>
            <Icon label="Align bottom edges" onClick={() => align('bottom')}>
              <AlignEndHorizontal />
            </Icon>
            {sel.length > 2 && (
              <>
                <Icon label="Space evenly across" onClick={() => align('spread-h')}>
                  <AlignHorizontalSpaceBetween />
                </Icon>
                <Icon label="Space evenly down" onClick={() => align('spread-v')}>
                  <AlignVerticalSpaceBetween />
                </Icon>
              </>
            )}
          </div>
        </>
      )}

      {first && (
        <div className="ml-auto flex items-center gap-0.5" role="group" aria-label="Arrange">
          <Icon label="Bring to front" onClick={() => dispatch({ type: 'reorder', ids, to: 'front' })}>
            <ChevronsUp />
          </Icon>
          <Icon label="Send to back" onClick={() => dispatch({ type: 'reorder', ids, to: 'back' })}>
            <ChevronsDown />
          </Icon>
          <Icon label="Duplicate" onClick={() => dispatch({ type: 'add', objects: cloneObjects(sel, state.present.objects, 12, 12, detectedNames) })}>
            <Copy />
          </Icon>
          <Icon label="Delete" onClick={() => dispatch({ type: 'remove', ids })}>
            <Trash2 />
          </Icon>
        </div>
      )}
    </div>
  )
}

function LinkProps({ o, onChange, onOutline }: { o: LinkObj; onChange: (t: LinkObj['target']) => void; onOutline: (v: boolean) => void }) {
  const { numPages } = useEditor()
  const check = o.target.kind === 'url' ? normalizeUrl(o.target.url) : null
  const empty = o.target.kind === 'url' && /^(https?:\/\/)?$/i.test(o.target.url.trim())
  return (
    <>
      <label className={field}>
        Goes to
        <select aria-label="Link type" className="input !w-auto !py-1" value={o.target.kind} onChange={(e) => onChange(e.target.value === 'url' ? { kind: 'url', url: 'https://' } : { kind: 'page', page: 0 })}>
          <option value="url">Web address</option>
          <option value="page">Page in this document</option>
        </select>
      </label>
      {o.target.kind === 'url' ? (
        <label className={field}>
          URL
          <input
            aria-label="Link URL"
            data-testid="link-url"
            className={`input !w-72 !py-1 ${check && !check.ok && !empty ? '!border-red-500' : ''}`}
            value={o.target.url}
            placeholder="example.com or https://example.com/page"
            aria-invalid={check && !check.ok && !empty ? true : undefined}
            onChange={(e) => onChange({ kind: 'url', url: e.target.value })}
            onBlur={() => check && check.ok && check.url !== (o.target as { url: string }).url && onChange({ kind: 'url', url: check.url })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && check && check.ok) {
                onChange({ kind: 'url', url: check.url })
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
          {check && !check.ok && !empty && (
            <span role="alert" data-testid="link-url-error" className="max-w-xs text-red-700 dark:text-red-300">
              {check.error}
            </span>
          )}
          {check && check.ok && (
            <>
              <span data-testid="link-url-final" className="max-w-[16rem] truncate text-emerald-700 dark:text-emerald-300" title={check.url}>
                → {check.url}
              </span>
              <a href={check.url} target="_blank" rel="noopener noreferrer" className="underline" data-testid="link-test">
                Open
              </a>
            </>
          )}
        </label>
      ) : (
        <label className={field}>
          Page
          <input aria-label="Target page" type="number" min={1} max={numPages} className={num} value={o.target.page + 1} onChange={(e) => onChange({ kind: 'page', page: Math.max(0, Math.min(numPages - 1, (Number(e.target.value) || 1) - 1)) })} />
        </label>
      )}
      <label className={field}>
        <input type="checkbox" checked={o.showBorder !== false} onChange={(e) => onOutline(e.target.checked)} data-testid="link-outline" />
        Show outline
      </label>
    </>
  )
}

function ImageProps({ o, onChange }: { o: ImageObj; onChange: (p: Partial<ImageObj>) => void }) {
  const btn = 'btn-ghost btn-sm !px-2 !py-1 text-xs'
  const rot = Math.round((o.rotation ?? 0) * 10) / 10
  const opacity = Math.round((o.opacity ?? 1) * 100)
  const turn = (d: number) => onChange({ rotation: ((((rot + d) % 360) + 540) % 360) - 180 })
  const { addAsset, notify } = useEditor()
  const replace = async (file: File | undefined) => {
    if (!file) return
    const r = await replacementPatch(o, file, addAsset)
    if (typeof r === 'string') notify(r)
    else onChange(r)
  }
  return (
    <>
      <label className={`${btn} cursor-pointer`} data-testid="img-replace-label">
        Replace image
        <input type="file" accept="image/png,image/jpeg" className="sr-only" data-testid="img-replace" onChange={(e) => { void replace(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      <label className={field}>
        Opacity
        <input type="range" min={5} max={100} step={5} aria-label="Opacity" data-testid="img-opacity" value={opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} />
        <span className="w-9 tabular-nums" data-testid="img-opacity-value">{opacity}%</span>
      </label>
      <div className="flex items-center gap-0.5" role="group" aria-label="Rotate">
        <button type="button" className={btn} data-testid="img-rot-left" aria-label="Rotate 90 degrees left" title="Rotate 90 degrees left" onClick={() => turn(-90)}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={btn} data-testid="img-rot-right" aria-label="Rotate 90 degrees right" title="Rotate 90 degrees right" onClick={() => turn(90)}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        </button>
        <input type="number" aria-label="Rotation in degrees" data-testid="img-rotation" className={num} min={-180} max={180} step={1} value={rot} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange({ rotation: Math.max(-180, Math.min(180, v)) }) }} />
        <span className="text-xs text-ink-600 dark:text-ink-300">deg</span>
      </div>
      <label className={field}>
        <input type="checkbox" data-testid="img-lock" checked={o.keepAspect} onChange={(e) => onChange({ keepAspect: e.target.checked })} />
        Lock aspect ratio
      </label>
      <span className="text-xs text-ink-600 dark:text-ink-300">Drag to move, corners to resize, the round handle to rotate.</span>
    </>
  )
}

type Active = { r: number; c: number }
function TableProps({ o, apply }: { o: TableObj; apply: (f: (d: TableData, a: Active) => TableData | { data: TableData; active: Active }) => void }) {
  const a = o.active ?? { r: 0, c: 0 }
  const cell = o.data.rows[a.r]?.cells[a.c]
  const btn = 'btn-ghost btn-sm !px-2 !py-1 text-xs'
  return (
    <>
      <span className={field} data-testid="table-active">
        Table · row {a.r + 1} of {o.data.rows.length}, column {a.c + 1} of {o.data.cols.length}
      </span>
      <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Rows and columns">
        <button type="button" className={btn} data-testid="tbl-row-above" onClick={() => apply((d, x) => ({ data: addRow(d, x.r, 'above'), active: { r: x.r, c: x.c } }))}>
          Row above
        </button>
        <button type="button" className={btn} data-testid="tbl-row-below" onClick={() => apply((d, x) => ({ data: addRow(d, x.r, 'below'), active: { r: x.r + 1, c: x.c } }))}>
          Row below
        </button>
        <button type="button" className={btn} data-testid="tbl-col-left" onClick={() => apply((d, x) => ({ data: addCol(d, x.c, 'left'), active: { r: x.r, c: x.c } }))}>
          Column left
        </button>
        <button type="button" className={btn} data-testid="tbl-col-right" onClick={() => apply((d, x) => ({ data: addCol(d, x.c, 'right'), active: { r: x.r, c: x.c + 1 } }))}>
          Column right
        </button>
        <button type="button" className={btn} data-testid="tbl-del-row" disabled={o.data.rows.length <= 1} onClick={() => apply((d, x) => ({ data: deleteRow(d, x.r), active: { r: Math.max(0, Math.min(x.r, d.rows.length - 2)), c: x.c } }))}>
          Delete row
        </button>
        <button type="button" className={btn} data-testid="tbl-del-col" disabled={o.data.cols.length <= 1} onClick={() => apply((d, x) => ({ data: deleteCol(d, x.c), active: { r: x.r, c: Math.max(0, Math.min(x.c, d.cols.length - 2)) } }))}>
          Delete column
        </button>
      </div>
      <span className={field}>
        Shading
        <ColorPicker variant="swatch" label="Cell shading" testId="tbl-fill" value={cell?.fill ?? '#ffffff'} onChange={(hex) => apply((d, x) => setCellFill(d, x.r, x.c, hex))} />
      </span>
      <div className="flex items-center gap-0.5" role="group" aria-label="Shading scope">
        <button type="button" className={btn} data-testid="tbl-fill-none" onClick={() => apply((d, x) => setCellFill(d, x.r, x.c, undefined))}>
          No shading
        </button>
        <button type="button" className={btn} data-testid="tbl-fill-row" onClick={() => apply((d, x) => setRowFill(d, x.r, cell?.fill))}>
          Shade row
        </button>
        <button type="button" className={btn} data-testid="tbl-fill-col" onClick={() => apply((d, x) => setColFill(d, x.c, cell?.fill))}>
          Shade column
        </button>
      </div>
      <span className={field}>
        Border
        <ColorPicker variant="swatch" label="Border color" testId="tbl-border-color" value={o.data.border.color} onChange={(hex) => apply((d) => setBorder(d, { color: hex }))} />
        <select aria-label="Border width" data-testid="tbl-border-width" className="input !w-auto !py-1" value={String(o.data.border.width)} onChange={(e) => apply((d) => setBorder(d, { width: Number(e.target.value) }))}>
          {[0.25, 0.5, 1, 1.5, 2, 3].map((w) => (
            <option key={w} value={String(w)}>
              {w} pt
            </option>
          ))}
          {![0.25, 0.5, 1, 1.5, 2, 3].includes(o.data.border.width) && <option value={String(o.data.border.width)}>{o.data.border.width.toFixed(2)} pt</option>}
        </select>
      </span>
      <label className={field}>
        <input type="checkbox" data-testid="tbl-inner" checked={o.data.border.inner} onChange={(e) => apply((d) => setBorder(d, { inner: e.target.checked }))} />
        Lines between columns
      </label>
      <span className="text-xs text-ink-600 dark:text-ink-300">Drag a boundary to resize. Double-click a cell to edit its text.</span>
    </>
  )
}

function FieldProps({ o, onChange, others, detectedNames }: { o: FieldObj; onChange: (p: Partial<FieldObj>) => void; others: FieldObj[]; detectedNames: string[] }) {
  const isRadio = o.fieldKind === 'radio'
  const nameTaken = !isRadio && !!o.name.trim() && (others.some((x) => x.fieldKind !== 'radio' && x.name.trim() === o.name.trim()) || detectedNames.includes(o.name.trim()))
  const kindLabel = { text: 'Text field', checkbox: 'Checkbox', radio: 'Radio button', dropdown: 'Dropdown' }[o.fieldKind]
  return (
    <>
      <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200" data-testid="field-badge" title="This is an interactive form field: whoever opens the PDF can fill it in. Text added with the Text tool is just ordinary text.">
        Form field · {kindLabel}
      </span>
      <label className={field}>
        {isRadio ? 'Group name' : 'Name'}
        <input aria-label={isRadio ? 'Radio group name' : 'Field name'} aria-invalid={nameTaken} data-testid="field-name" className={`input !w-36 !py-1 ${nameTaken ? '!border-amber-500' : ''}`} value={o.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      {nameTaken && (
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300" role="status" data-testid="field-name-warning">
          Another field already has this name: it will be saved as a separate field with a number added.
        </span>
      )}
      {isRadio && (
        <>
          <span className="text-xs text-ink-600 dark:text-ink-300" data-testid="radio-group-info">
            Group “{o.name || 'radio'}”: {others.filter((x) => x.fieldKind === 'radio' && x.name === o.name).length + 1} option(s); only one can be chosen.
          </span>
          <label className={field}>
            Option label
            <input aria-label="Option label" data-testid="field-option" className="input !w-32 !py-1" value={o.options[0] ?? ''} onChange={(e) => onChange({ options: [e.target.value] })} />
          </label>
        </>
      )}
      {o.fieldKind === 'text' && (
        <>
          <label className={field}>
            Default text
            <input aria-label="Default text" className="input !w-36 !py-1" value={typeof o.value === 'string' ? o.value : ''} onChange={(e) => onChange({ value: e.target.value })} />
          </label>
          <label className={field}>
            <input type="checkbox" checked={!!o.multiline} onChange={(e) => onChange({ multiline: e.target.checked })} data-testid="field-multiline" />
            Several lines
          </label>
          <label className={field}>
            Allowed input
            <select aria-label="Allowed input" data-testid="field-validation" className="input !w-auto !py-1" value={o.validation ?? 'none'} onChange={(e) => onChange({ validation: e.target.value as FieldValidation })} title="Checked by the PDF viewer (it needs JavaScript switched on there)">
              <option value="none">Anything</option>
              <option value="number">Numbers only</option>
              <option value="email">Email address</option>
            </select>
          </label>
          <label className={field}>
            Max characters
            <input
              aria-label="Maximum characters"
              data-testid="field-maxlength"
              type="number"
              min={1}
              max={5000}
              placeholder="none"
              className={num}
              value={o.maxLength ?? ''}
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange({ maxLength: e.target.value === '' || !Number.isFinite(v) || v < 1 ? undefined : Math.min(5000, Math.floor(v)) })
              }}
            />
          </label>
        </>
      )}
      {o.fieldKind === 'dropdown' && (
        <label className={field}>
          Choices (one per comma)
          <input aria-label="Dropdown choices" data-testid="field-choices" className="input !w-56 !py-1" value={o.options.join(', ')} onChange={(e) => onChange({ options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="Yes, No, Maybe" />
        </label>
      )}
      {(o.fieldKind === 'checkbox' || isRadio) && (
        <label className={field}>
          Size (pt)
          <input
            aria-label="Box size"
            data-testid="field-size"
            type="number"
            min={6}
            max={100}
            step={1}
            className={num}
            value={Math.round(o.w * 100) / 100}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v >= 6 && v <= 100) onChange({ w: v, h: v }) // always square: width = height
            }}
          />
        </label>
      )}
      {(o.fieldKind === 'checkbox' || isRadio) && (
        <label className={field}>
          <input type="checkbox" checked={o.value === true} onChange={(e) => onChange({ value: e.target.checked })} data-testid="field-default" />
          {isRadio ? 'Selected by default' : 'Checked by default'}
        </label>
      )}
      <label className={field}>
        <input type="checkbox" checked={!!o.required} onChange={(e) => onChange({ required: e.target.checked })} data-testid="field-required" />
        Required
      </label>
      <label className={field}>
        Hint
        <input aria-label="Hint shown on hover" data-testid="field-tooltip" className="input !w-40 !py-1" value={o.tooltip ?? ''} onChange={(e) => onChange({ tooltip: e.target.value })} placeholder="Shown when hovering" title="A PDF has no faded placeholder text: this hint appears when the pointer rests on the field in a viewer" />
      </label>
    </>
  )
}

