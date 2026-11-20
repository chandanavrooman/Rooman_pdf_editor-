import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FilePlus2, RotateCcw, Sparkles } from 'lucide-react'
import type { DetectedField, FormInfo } from './forms'
import type { FieldValue } from './types'

/** Is there something in the field? (a checkbox counts when ticked, a radio group / dropdown when one is chosen) */
export function hasValue(v: FieldValue | undefined): boolean {
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.length > 0
  return typeof v === 'string' && v.trim() !== ''
}

export function currentValue(f: DetectedField, values: Record<string, FieldValue>): FieldValue {
  return f.name in values ? values[f.name] : f.value
}

/** The REQUIRED fields (that can be edited) and how many of them have something in them. */
export function requiredProgress(fields: DetectedField[], values: Record<string, FieldValue>) {
  const req = fields.filter((f) => f.required && !f.readOnly)
  return { total: req.length, done: req.filter((f) => hasValue(currentValue(f, values))).length }
}

const kindWord = (k: 'button' | 'signature' | 'other') => (k === 'button' ? 'button' : k === 'signature' ? 'signature field' : 'other field')

function describeUnsupported(info: FormInfo): string {
  const counts = { button: 0, signature: 0, other: 0 }
  for (const u of info.unsupported) counts[u.kind]++
  return (Object.keys(counts) as (keyof typeof counts)[])
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${kindWord(k)}${counts[k] === 1 ? '' : 's'}`)
    .join(', ')
}

/**
 * The guidance above the editor in the Fill forms tool. It says which of the two jobs this PDF is for:
 *  - it has fillable fields: fill them in (with a way to step from field to field and a count of what is still required)
 *  - it has none: create a fillable form, only where the person places fields. Nothing is ever added automatically.
 * It also reports what it cannot fill (buttons, signature fields, XFA forms) instead of claiming there is no form.
 */
export function FillFormPanel({ info, fields, values, creating, fieldCount, onCreate, onChooseAnother, onJump }: {
  info: FormInfo
  fields: DetectedField[]
  values: Record<string, FieldValue>
  creating: boolean
  /** how many form fields the user has added so far */
  fieldCount: number
  onCreate: () => void
  onChooseAnother: () => void
  onJump: (delta: 1 | -1) => void
}) {
  const progress = useMemo(() => requiredProgress(fields, values), [fields, values])
  const unsupportedText = describeUnsupported(info)

  // ───────── 1. a fillable form
  if (fields.length > 0) {
    return (
      <div className="mb-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-800 dark:bg-brand-900/20" data-testid="fill-detected">
        <div className="flex flex-wrap items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Fillable form detected. Click any field to enter your information.</p>
            <p className="mt-0.5 text-xs text-ink-700 dark:text-ink-200" data-testid="fill-summary">
              {fields.length} field{fields.length === 1 ? '' : 's'} found
              {progress.total > 0 ? (
                <>
                  {' · '}
                  <span className={progress.done === progress.total ? 'font-semibold text-brand-700 dark:text-brand-300' : 'font-semibold text-amber-700 dark:text-amber-300'} data-testid="fill-required">
                    {progress.done} of {progress.total} required field{progress.total === 1 ? '' : 's'} filled in
                  </span>
                </>
              ) : (
                ' · none are marked required'
              )}
            </p>
            {unsupportedText && (
              <p className="mt-1 text-xs text-ink-600 dark:text-ink-300" data-testid="fill-unsupported">
                This PDF also has {unsupportedText} that cannot be filled in here. {info.unsupported.length === 1 ? 'It is' : 'They are'} kept exactly as {info.unsupported.length === 1 ? 'it is' : 'they are'}.
              </p>
            )}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Move between fields">
            <button type="button" className="btn-secondary btn-sm" onClick={() => onJump(-1)} data-testid="field-prev">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous field
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => onJump(1)} data-testid="field-next">
              Next field <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ───────── 2. the user has started creating a form
  if (creating || fieldCount > 0) {
    return (
      <div className="mb-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-800 dark:bg-brand-900/20" data-testid="fill-creating">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">
              Creating a fillable form{fieldCount > 0 ? ` · ${fieldCount} field${fieldCount === 1 ? '' : 's'} added` : ''}
            </p>
            <p className="mt-0.5 text-xs text-ink-700 dark:text-ink-200">
              Pick <strong>Text field</strong>, <strong>Checkbox</strong>, <strong>Radio</strong> or <strong>Dropdown</strong> in the toolbar, then drag on the page where the field should go. Click a field to rename it, make it required and more. Text you type with the <strong>Text</strong> tool is ordinary text, not a fillable field.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ───────── 3. fields exist that this tool cannot fill, or an XFA form
  if (info.xfa || info.unsupported.length > 0) {
    return (
      <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status" data-testid="fill-unsupported-only">
        <div className="flex flex-wrap items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{info.xfa ? 'This is a dynamic (XFA) form' : 'This PDF has form fields, but none that can be filled in here'}</p>
            <p className="mt-0.5 text-xs">
              {info.xfa
                ? 'Its fields are stored in a special Adobe format that this tool cannot read, so they would not appear. Open it in Adobe Acrobat to fill it, or add ordinary fields on top of the pages here.'
                : `It contains ${unsupportedText}. ${info.unsupported.length === 1 ? 'That kind of field' : 'Those kinds of fields'} cannot be filled in here and will be kept as they are. You can still add text fields, checkboxes, radio buttons or dropdown menus of your own.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={onCreate} data-testid="create-fillable">
              <FilePlus2 className="h-4 w-4" aria-hidden="true" /> Add fields anyway
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={onChooseAnother} data-testid="choose-another-pdf">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Choose Another PDF
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ───────── 4. no form at all
  return (
    <div className="mb-3 rounded-2xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-800 dark:bg-brand-900/20" role="status" data-testid="fill-none">
      <p className="text-base font-semibold text-brand-900 dark:text-brand-100">No fillable fields detected</p>
      <p className="mt-1 max-w-3xl text-sm text-ink-700 dark:text-ink-200">This PDF does not contain interactive form fields. You can still make it fillable by adding text fields, checkboxes, radio buttons or dropdown menus.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onCreate} data-testid="create-fillable">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" /> Create Fillable Form
        </button>
        <button type="button" className="btn-secondary" onClick={onChooseAnother} data-testid="choose-another-pdf">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Choose Another PDF
        </button>
      </div>
    </div>
  )
}
