import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { TextField } from '@/components/forms'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { addHeadersFooters, type HeaderFooterOptions } from '@/lib/pdfOps'
import { usePageSelection } from './shared/pageSelection'
import { defaultStyleState, StyleFields, styleValid, toTextStyle, type StyleState } from './shared/StyleFields'
import { PDF_MIME, type ToolPage } from './shared/types'

type Slot = keyof NonNullable<HeaderFooterOptions['slots']>
const SLOTS: { key: Slot; label: string }[] = [
  { key: 'top-left', label: 'Header left' },
  { key: 'top-center', label: 'Header center' },
  { key: 'top-right', label: 'Header right' },
  { key: 'bottom-left', label: 'Footer left' },
  { key: 'bottom-center', label: 'Footer center' },
  { key: 'bottom-right', label: 'Footer right' },
]

const HeadersFootersTool: ToolPage = ({ tool }) => {
  const [slots, setSlots] = useState<Partial<Record<Slot, string>>>({ 'bottom-right': 'Page {page} of {total}' })
  const [style, setStyle] = useState<StyleState>(defaultStyleState)
  const [rangeText, setRangeText] = useState('')
  const [start, setStart] = useState('1')
  const [fileId, setFileId] = useState<string>()
  const { numPages } = usePdfDoc(fileId)
  const sel = usePageSelection(rangeText, numPages)
  const startAt = parseInt(start, 10)
  const any = Object.values(slots).some((v) => v && v.trim())

  return (
    <ToolShell
      tool={tool}
      runLabel="Add headers & footers"
      canRun={any && styleValid(style) && !sel.error && Number.isInteger(startAt) && startAt >= 0}
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setRangeText('')
      }}
      options={() => (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {SLOTS.map((s) => (
              <TextField key={s.key} label={s.label} value={slots[s.key] ?? ''} onChange={(v) => setSlots((p) => ({ ...p, [s.key]: v }))} testId={`hf-${s.key}`} />
            ))}
          </div>
          <p className="hint">
            Tokens: <code>{'{page}'}</code> page number, <code>{'{total}'}</code> (or <code>{'{pages}'}</code>) total pages, <code>{'{date}'}</code> today, <code>{'{filename}'}</code> file name. Built-in fonts support Latin characters only.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="First page number" type="number" min={0} value={start} onChange={setStart} />
            <TextField label="Only these pages (empty = all)" value={rangeText} onChange={setRangeText} error={sel.error} placeholder="e.g. 2-" />
          </div>
          <StyleFields value={style} onChange={setStyle} />
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-headers.pdf`,
        bytes: await addHeadersFooters(getBytes(files[0].id), files[0].name, { slots, startAt, pages: sel.pages.length ? sel.pages : undefined, style: toTextStyle(style) }, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default HeadersFootersTool
