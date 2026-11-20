import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { Checkbox, RadioCards, SelectField } from '@/components/forms'
import { useCapabilities } from '@/hooks/useCapabilities'
import { formatBytes } from '@/lib/fileStore'
import { runServerTool } from '@/lib/serverTool'
import type { ToolPage } from '../shared/types'

type Level = 'low' | 'medium' | 'high'

export const CompressTool: ToolPage = ({ tool }) => {
  const [level, setLevel] = useState<Level>('medium')
  return (
    <ToolShell
      tool={tool}
      runLabel="Compress PDF"
      options={() => (
        <RadioCards<Level>
          legend="Compression level"
          value={level}
          onChange={setLevel}
          columns={3}
          options={[
            { value: 'low', label: 'Low', description: 'Best quality, smallest saving (images kept up to 200 dpi)' },
            { value: 'medium', label: 'Medium', description: 'Good quality, good saving (images downsampled to 150 dpi)' },
            { value: 'high', label: 'High', description: 'Strongest saving, lower image quality (images downsampled to 96 dpi)' },
          ]}
        />
      )}
      run={(ctx) =>
        runServerTool(ctx, {
          endpoint: '/optimize/compress',
          body: (d) => ({ document_id: d[0].id, level }),
          infos: (res) => {
            const d = res.details as { before_bytes?: number; after_bytes?: number; saved_percent?: number; smaller?: boolean }
            if (typeof d.before_bytes !== 'number' || typeof d.after_bytes !== 'number') return []
            return [
              d.smaller
                ? `Before: ${formatBytes(d.before_bytes)} → After: ${formatBytes(d.after_bytes)} · saved ${Number(d.saved_percent ?? 0).toFixed(1)}%`
                : `Before: ${formatBytes(d.before_bytes)} → After: ${formatBytes(d.after_bytes)} · the file could not be made smaller, so you get the original back`,
            ]
          },
        })
      }
    />
  )
}

export const RepairTool: ToolPage = ({ tool }) => (
  <ToolShell tool={tool} runLabel="Repair PDF" run={(ctx) => runServerTool(ctx, { endpoint: '/optimize/repair', body: (d) => ({ document_id: d[0].id }) })} />
)

export const FlattenTool: ToolPage = ({ tool }) => (
  <ToolShell
    tool={tool}
    runLabel="Flatten PDF"
    options={() => <p className="text-sm text-ink-600 dark:text-ink-300">Form fields and annotations become part of the page content and can no longer be edited.</p>}
    run={(ctx) =>
      runServerTool(ctx, {
        endpoint: '/optimize/flatten',
        body: (d) => ({ document_id: d[0].id }),
        infos: (res) => {
          const d = res.details as { form_fields?: number; annotations?: number }
          return [`Flattened ${d.form_fields ?? 0} form field(s) and ${d.annotations ?? 0} annotation(s).`]
        },
      })
    }
  />
)

function LanguageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { caps } = useCapabilities()
  const langs = caps?.ocr_languages?.length ? caps.ocr_languages : ['eng']
  return (
    <SelectField label="Document language" value={value} onChange={onChange} options={langs.map((l) => ({ value: l, label: l }))} hint="Languages installed with Tesseract on the server." />
  )
}

export const OcrTool: ToolPage = ({ tool }) => {
  const [lang, setLang] = useState('eng')
  const [force, setForce] = useState(false)
  return (
    <ToolShell
      tool={tool}
      runLabel="Make searchable"
      options={() => (
        <div className="space-y-4">
          <LanguageSelect value={lang} onChange={setLang} />
          <Checkbox label="Re-run OCR on pages that already contain text" checked={force} onChange={setForce} hint="By default pages with a text layer are kept as they are." />
        </div>
      )}
      run={(ctx) => runServerTool(ctx, { endpoint: '/optimize/ocr', body: (d) => ({ document_id: d[0].id, language: lang, force }) })}
    />
  )
}

export const DeskewTool: ToolPage = ({ tool }) => {
  const [lang, setLang] = useState('eng')
  return (
    <ToolShell
      tool={tool}
      runLabel="Straighten pages"
      options={() => <LanguageSelect value={lang} onChange={setLang} />}
      run={(ctx) => runServerTool(ctx, { endpoint: '/optimize/deskew', body: (d) => ({ document_id: d[0].id, language: lang }) })}
    />
  )
}
