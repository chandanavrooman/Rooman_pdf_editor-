import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { Checkbox, TextField } from '@/components/forms'
import { useAiStatus } from './shared'
import { runServerTool } from '@/lib/serverTool'
import type { ToolPage } from '@/tools/shared/types'

/** Extract tables → .xlsx. Works without an AI key; the optional AI clean-up needs one. */
const TableTool: ToolPage = ({ tool }) => {
  const [pages, setPages] = useState('')
  const [clean, setClean] = useState(false)
  const status = useAiStatus()
  return (
    <ToolShell
      tool={tool}
      runLabel="Extract tables"
      options={() => (
        <div className="space-y-4">
          <TextField label="Pages" value={pages} onChange={setPages} hint="Leave empty for all pages, or e.g. 1-3,5. Each table becomes one sheet." />
          <Checkbox
            label="Tidy the tables with AI (merge split cells, fix headers)"
            checked={clean && !!status?.configured}
            onChange={setClean}
            hint={status?.configured ? 'Sends the table text to the AI provider.' : 'Unavailable: the server has no AI key. Plain extraction works without it.'}
          />
        </div>
      )}
      run={(ctx) =>
        runServerTool(ctx, {
          endpoint: '/ai/extract-tables',
          body: (d) => ({ document_id: d[0].id, pages: pages.trim() || undefined, clean_with_ai: clean && !!status?.configured }),
          infos: (res) => {
            const d = res.details as { tables?: number; ai_cleaned?: boolean }
            return typeof d.tables === 'number' ? [`${d.tables} table(s) extracted${d.ai_cleaned ? ' and tidied with AI' : ''}.`] : []
          },
        })
      }
    />
  )
}
export default TableTool
