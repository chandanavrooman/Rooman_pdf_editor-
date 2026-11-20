import type { CSSProperties } from 'react'
import { useEditor } from './EditorContext'
import type { DetectedField } from './forms'
import { hasValue } from './FillFormPanel'

/**
 * Real inputs placed over the widgets of the PDF's EXISTING form fields. The canvas does not draw those widgets
 * (the viewer uses pdf.js AnnotationMode.ENABLE_FORMS), so there is exactly one visible control per field.
 * Values are written into the editor state and applied to the PDF's AcroForm on export.
 */
export function FormFillLayer({ pageIndex, s }: { pageIndex: number; s: number }) {
  const { fields, state, dispatch } = useEditor()
  const mine = fields.filter((f) => f.widgets.some((w) => w.page === pageIndex))
  if (!mine.length) return null
  const valueOf = (f: DetectedField) => (f.name in state.present.formValues ? state.present.formValues[f.name] : f.value)
  const set = (f: DetectedField, v: string | boolean | string[]) => dispatch({ type: 'setField', name: f.name, value: v, txn: `field-${f.name}` })

  return (
    <>
      {mine.map((f) =>
        f.widgets.map((w, i) => {
          if (w.page !== pageIndex) return null
          const r = w.rect
          const cur = valueOf(f)
          const missing = f.required && !f.readOnly && !hasValue(cur)
          const style: CSSProperties = { position: 'absolute', left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s, boxSizing: 'border-box' }
          const common = {
            'data-testid': `form-field-${f.name}`,
            'data-field': f.name,
            'data-required': f.required ? 'true' : undefined,
            'data-missing': missing ? 'true' : undefined,
            'aria-required': f.required || undefined,
            disabled: f.readOnly,
            onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
            onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
          }
          const fontSize = Math.max(8, Math.min(r.h * 0.62, 14) * s)
          const look = missing ? 'border-2 border-amber-500 bg-amber-100/80 text-ink-900 focus:bg-white dark:bg-amber-200/80' : 'border border-sky-600/70 bg-sky-100/70 text-ink-900 focus:bg-white dark:bg-sky-200/80'
          if (f.kind === 'checkbox')
            return <input key={`${f.name}-${i}`} {...common} type="checkbox" aria-label={f.name} checked={cur === true} onChange={(e) => set(f, e.target.checked)} style={{ ...style, margin: 0, accentColor: '#0369a1', outline: missing ? '2px solid #f59e0b' : undefined, outlineOffset: 1 }} />
          if (f.kind === 'radio')
            return (
              <input
                key={`${f.name}-${i}`}
                {...common}
                type="radio"
                data-testid={`form-field-${f.name}-${w.onValue ?? i}`}
                aria-label={`${f.name}: ${w.onValue ?? i + 1}`}
                checked={cur === w.onValue}
                onChange={() => w.onValue && set(f, w.onValue)}
                style={{ ...style, margin: 0, accentColor: '#0369a1' }}
              />
            )
          if (f.kind === 'dropdown' || f.kind === 'optionlist')
            return (
              <select
                key={`${f.name}-${i}`}
                {...common}
                aria-label={f.name}
                multiple={f.kind === 'optionlist'}
                className={look}
                value={f.kind === 'optionlist' ? (Array.isArray(cur) ? cur : []) : typeof cur === 'string' ? cur : Array.isArray(cur) ? (cur[0] ?? '') : ''}
                onChange={(e) => set(f, f.kind === 'optionlist' ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value)}
                style={{ ...style, fontSize, padding: '0 2px' }}
              >
                {f.kind === 'dropdown' && <option value="" />}
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )
          if (f.multiline)
            return <textarea key={`${f.name}-${i}`} {...common} aria-label={f.name} className={look} value={typeof cur === 'string' ? cur : ''} maxLength={f.maxLength} onChange={(e) => set(f, e.target.value)} style={{ ...style, fontSize, resize: 'none', padding: 2, lineHeight: 1.2 }} />
          return <input key={`${f.name}-${i}`} {...common} type="text" aria-label={f.name} className={look} value={typeof cur === 'string' ? cur : ''} maxLength={f.maxLength} onChange={(e) => set(f, e.target.value)} style={{ ...style, fontSize, padding: '0 3px' }} />
        }),
      )}
    </>
  )
}
