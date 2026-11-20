import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { PageGrid } from '@/components/PageGrid'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { reorderPages } from '@/lib/pdfOps'
import { PDF_MIME, type ToolPage } from './shared/types'

const ReorderTool: ToolPage = ({ tool }) => {
  const [fileId, setFileId] = useState<string>()
  const { doc, numPages } = usePdfDoc(fileId)
  const [order, setOrder] = useState<number[]>([])
  const seq = order.length === numPages ? order : Array.from({ length: numPages }, (_, i) => i + 1)
  const changed = seq.some((p, i) => p !== i + 1)
  return (
    <ToolShell
      tool={tool}
      runLabel="Save new order"
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setOrder([])
      }}
      canRun={changed}
      options={() => (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setOrder([...seq].reverse())}>
              Reverse order
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setOrder([])} disabled={!changed}>
              Reset
            </button>
          </div>
          <p className="hint">Drag thumbnails to move them, or use the arrow buttons. The number shown is the original page number.</p>
          {doc && <PageGrid doc={doc} numPages={numPages} order={seq} onReorder={setOrder} />}
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-reordered.pdf`,
        bytes: await reorderPages(getBytes(files[0].id), seq, {}, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default ReorderTool
