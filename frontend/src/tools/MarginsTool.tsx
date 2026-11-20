import { useEffect, useMemo, useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { Checkbox, RadioCards, TextField } from '@/components/forms'
import { MarginPreview } from '@/components/MarginPreview'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { applyMargins, checkMargins, MM_TO_PT, type MarginMode } from '@/lib/pdfOps'
import { renderPageRaster } from '@/lib/contentRaster'
import { getPageSizes } from '@/lib/render'
import { PDF_MIME, type ToolPage } from './shared/types'

const MarginsTool: ToolPage = ({ tool }) => {
  const [fileId, setFileId] = useState<string>()
  const { doc, numPages } = usePdfDoc(fileId)
  const [mode, setMode] = useState<MarginMode>('equal')
  const [equal, setEqual] = useState('10')
  const [top, setTop] = useState('10')
  const [bottom, setBottom] = useState('10')
  const [left, setLeft] = useState('10')
  const [right, setRight] = useState('10')
  const [fit, setFit] = useState(true)
  // the smallest page of the file: the margins have to leave room on every page
  const [smallest, setSmallest] = useState<{ widthMm: number; heightMm: number } | undefined>()
  useEffect(() => {
    if (!doc) return
    let alive = true
    getPageSizes(doc).then(
      (sizes) => alive && setSmallest({ widthMm: Math.min(...sizes.map((s) => s.width)) / MM_TO_PT, heightMm: Math.min(...sizes.map((s) => s.height)) / MM_TO_PT }),
      () => {},
    )
    return () => {
      alive = false
      setSmallest(undefined)
    }
  }, [doc])

  const check = useMemo(() => checkMargins({ mode, equal, top, bottom, left, right }, smallest), [mode, equal, top, bottom, left, right, smallest])
  const margins = check.margins

  return (
    <ToolShell
      tool={tool}
      runLabel="Apply margins"
      canRun={!!margins}
      onFilesChange={(f) => setFileId(f[0]?.id)}
      options={() => (
        <div className="space-y-5">
          <RadioCards
            legend="Margins"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'equal', label: 'Same on all sides', description: 'One value for top, bottom, left and right.' },
              { value: 'individual', label: 'Different per side', description: 'Set top, bottom, left and right yourself.' },
            ]}
          />
          {mode === 'equal' ? (
            <TextField label="Margin on all four sides (mm)" type="number" min={0} step={0.5} value={equal} onChange={setEqual} error={check.errors.equal} testId="margin-mm" hint="The page keeps its size. The content is scaled down (never stretched) to fit inside the margins and centred horizontally and vertically." />
          ) : (
            <div className="grid grid-cols-2 gap-3" data-testid="margin-sides">
              <TextField label="Top margin (mm)" type="number" min={0} step={0.5} value={top} onChange={setTop} error={check.errors.top} testId="margin-top" />
              <TextField label="Bottom margin (mm)" type="number" min={0} step={0.5} value={bottom} onChange={setBottom} error={check.errors.bottom} testId="margin-bottom" />
              <TextField label="Left margin (mm)" type="number" min={0} step={0.5} value={left} onChange={setLeft} error={check.errors.left} testId="margin-left" />
              <TextField label="Right margin (mm)" type="number" min={0} step={0.5} value={right} onChange={setRight} error={check.errors.right} testId="margin-right" />
            </div>
          )}
          <Checkbox label="Measure from the visible content" checked={fit} onChange={setFit} hint="On: the printed content (not the page's own white border) ends up exactly this far from the edge. Off: the whole page area is scaled into the margins." />
          <p className="hint">The content is scaled to fit the area inside the margins and centred in it. If its shape differs from that area's, the longer side touches the margin and the other side gets the extra space equally.</p>
          {fileId && numPages > 0 && <MarginPreview fileId={fileId} margins={margins} fit={fit} pageCount={numPages} />}
        </div>
      )}
      run={async ({ files, progress }) => {
        if (!margins) throw new Error('Fix the margin values first.')
        return {
          name: `${baseName(files[0].name)}-margins.pdf`,
          bytes: await applyMargins(getBytes(files[0].id), { margins, fitToContent: fit, render: renderPageRaster }, progress),
          mime: PDF_MIME,
        }
      }}
    />
  )
}
export default MarginsTool
