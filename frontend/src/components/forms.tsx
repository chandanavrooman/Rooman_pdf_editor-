import { useId, type ReactNode } from 'react'
import { ColorPicker } from './ColorPicker'

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        hint && <p className="hint">{hint}</p>
      )}
    </div>
  )
}

export function TextField({ label, value, onChange, hint, error, placeholder, type = 'text', inputMode, min, max, step, testId }: {
  label: string
  value: string | number
  onChange: (v: string) => void
  hint?: string
  error?: string | null
  placeholder?: string
  type?: 'text' | 'number'
  inputMode?: 'numeric' | 'decimal' | 'text'
  min?: number
  max?: number
  step?: number
  testId?: string
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input id={id} data-testid={testId} className={`input ${error ? '!border-red-500' : ''}`} type={type} inputMode={inputMode} min={min} max={max} step={step} value={value} placeholder={placeholder} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

export function SelectField<T extends string>({ label, value, onChange, options, hint }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hint?: string }) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** Card-style radio group, keyboard accessible (native radios). */
export function RadioCards<T extends string>({ legend, value, onChange, options, columns = 2 }: {
  legend: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; description?: string }[]
  columns?: 2 | 3 | 4
}) {
  const name = useId()
  const cols = columns === 4 ? 'sm:grid-cols-4' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className={`grid gap-2 ${cols}`}>
        {options.map((o) => (
          <label key={o.value} className={`flex cursor-pointer flex-col rounded-xl border px-3 py-2.5 text-sm transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 ${value === o.value ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/30' : 'border-ink-200 hover:border-ink-300 dark:border-ink-700'}`}>
            <span className="flex items-center gap-2 font-medium">
              <input type="radio" name={name} className="accent-brand-600" checked={value === o.value} onChange={() => onChange(o.value)} />
              {o.label}
            </span>
            {o.description && <span className="mt-0.5 pl-6 text-xs text-ink-500 dark:text-ink-400">{o.description}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input id={id} type="checkbox" className="h-4 w-4 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className="hint pl-6">{hint}</p>}
    </div>
  )
}

export function ColorField({ label, value, onChange, testId }: { label: string; value: string; onChange: (hex: string) => void; testId?: string }) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id}>
      <ColorPicker id={id} label={label} value={value} onChange={onChange} testId={testId} />
    </Field>
  )
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}
