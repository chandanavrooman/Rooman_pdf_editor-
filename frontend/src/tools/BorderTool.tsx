import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { ColorField, RadioCards, TextField, hexToRgb } from '@/components/forms'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { addBorder, type BorderStyle } from '@/lib/pdfOps'
import { usePageSelection } from './shared/pageSelection'
import { PDF_MIME, type ToolPage } from './shared/types'

const MM = 72 / 25.4

const BorderTool: ToolPage = ({ tool }) => {
  const [inset, setInset] = useState('8')
  const [thick, setThick] = useState('2')
  const [color, setColor] = useState('#1b2a4e')
  const [style, setStyle] = useState<BorderStyle>('solid')
  const [rangeText, setRangeText] = useState('')
  const [fileId, setFileId] = useState<string>()
  const { numPages } = usePdfDoc(fileId)
  const sel = usePageSelection(rangeText, numPages)
  const i = parseFloat(inset)
  const t = parseFloat(thick)
  const valid = Number.isFinite(i) && i >= 0 && Number.isFinite(t) && t > 0 && t <= 40 && !sel.error
  return (
    <ToolShell
      tool={tool}
      runLabel="Add border"
      canRun={valid}
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setRangeText('')
      }}
      options={() => (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Distance from the page edge (mm)" type="number" min={0} step={0.5} value={inset} onChange={setInset} testId="border-inset" hint="Measured from the page edge to the outside of the line, the same on all four sides." />
            <TextField label="Thickness (pt)" type="number" min={0.25} max={40} step={0.25} value={thick} onChange={setThick} testId="border-thickness" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Color" value={color} onChange={setColor} />
            <TextField label="Only these pages (empty = all)" value={rangeText} onChange={setRangeText} error={sel.error} placeholder="e.g. 2-" />
          </div>
          <RadioCards<BorderStyle>
            legend="Line style"
            value={style}
            onChange={setStyle}
            options={[
              { value: 'solid', label: 'Solid', description: 'One continuous line' },
              { value: 'dashed', label: 'Dashed', description: 'Even dashes, solid corners' },
            ]}
          />
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-border.pdf`,
        bytes: await addBorder(getBytes(files[0].id), { insetPt: i * MM, thicknessPt: t, color: hexToRgb(color), style, pages: sel.pages.length ? sel.pages : undefined }, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default BorderTool
