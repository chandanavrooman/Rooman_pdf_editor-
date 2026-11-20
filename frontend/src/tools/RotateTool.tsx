import { useState } from 'react'
import { RotateCcw, RotateCw } from 'lucide-react'
import { ToolShell } from '@/components/ToolShell'
import { PageGrid } from '@/components/PageGrid'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { rotatePages } from '@/lib/pdfOps'
import { PDF_MIME, type ToolPage } from './shared/types'

const RotateTool: ToolPage = ({ tool }) => {
  const [fileId, setFileId] = useState<string>()
  const { doc, numPages } = usePdfDoc(fileId)
  const [rot, setRot] = useState<Record<number, number>>({})
  const bump = (page: number, d: number) => setRot((r) => ({ ...r, [page]: (((r[page] ?? 0) + d) % 360 + 360) % 360 }))
  const all = (d: number) =>
    setRot((r) => {
      const next: Record<number, number> = {}
      for (let p = 1; p <= numPages; p++) next[p] = (((r[p] ?? 0) + d) % 360 + 360) % 360
      return next
    })
  const changed = Object.values(rot).some((v) => v % 360 !== 0)

  return (
    <ToolShell
      tool={tool}
      runLabel="Rotate PDF"
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setRot({})
      }}
      canRun={changed}
      options={() => (
        <div className="space-y-4">
          <div>
            <p className="label">Rotate all pages</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => all(270)} data-testid="rotate-all-left" disabled={!doc}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> 90° left
              </button>
              <button type="button" className="btn-secondary" onClick={() => all(90)} data-testid="rotate-all-right" disabled={!doc}>
                <RotateCw className="h-4 w-4" aria-hidden="true" /> 90° right
              </button>
              <button type="button" className="btn-secondary" onClick={() => all(180)} disabled={!doc}>
                180°
              </button>
              <button type="button" className="btn-ghost" onClick={() => setRot({})}>
                Reset
              </button>
            </div>
            <p className="hint">Or rotate individual pages with the buttons under each thumbnail.</p>
          </div>
          {doc && (
            <PageGrid
              doc={doc}
              numPages={numPages}
              rotations={rot}
              renderActions={(p) => (
                <>
                  <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => bump(p, 270)} aria-label={`Rotate page ${p} left`}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => bump(p, 90)} aria-label={`Rotate page ${p} right`}>
                    <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </>
              )}
            />
          )}
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-rotated.pdf`,
        bytes: await rotatePages(getBytes(files[0].id), rot, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default RotateTool
