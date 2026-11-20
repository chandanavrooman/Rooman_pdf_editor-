import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { Checkbox, RadioCards, SelectField, TextField } from '@/components/forms'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { nUp, PAGE_SIZES } from '@/lib/pdfOps'
import { PDF_MIME, type ToolPage } from './shared/types'

type Per = '2' | '4' | '6' | '9'

const NUpTool: ToolPage = ({ tool }) => {
  const [per, setPer] = useState<Per>('4')
  const [size, setSize] = useState('a4')
  const [orient, setOrient] = useState<'auto' | 'portrait' | 'landscape'>('auto')
  const [margin, setMargin] = useState('10')
  const [gap, setGap] = useState('4')
  const [border, setBorder] = useState(true)
  const [order, setOrder] = useState<'row' | 'column'>('row')
  const mm = 72 / 25.4
  const valid = Number(margin) >= 0 && Number(gap) >= 0

  return (
    <ToolShell
      tool={tool}
      runLabel="Create N-up PDF"
      canRun={valid}
      options={() => (
        <div className="space-y-5">
          <RadioCards<Per> legend="Pages per sheet" value={per} onChange={setPer} columns={4} options={[{ value: '2', label: '2 per sheet' }, { value: '4', label: '4 per sheet' }, { value: '6', label: '6 per sheet' }, { value: '9', label: '9 per sheet' }]} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Sheet size" value={size} onChange={setSize} options={Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label }))} />
            <SelectField label="Sheet orientation" value={orient} onChange={setOrient} options={[{ value: 'auto', label: 'Automatic (landscape for 2 and 6)' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            <TextField label="Outer margin (mm)" type="number" min={0} value={margin} onChange={setMargin} />
            <TextField label="Gap between pages (mm)" type="number" min={0} value={gap} onChange={setGap} />
          </div>
          <SelectField label="Page order" value={order} onChange={setOrder} options={[{ value: 'row', label: 'Left to right, then down' }, { value: 'column', label: 'Top to bottom, then across' }]} />
          <Checkbox label="Draw a thin border around each page" checked={border} onChange={setBorder} />
        </div>
      )}
      run={async ({ files, progress }) => {
        const p = PAGE_SIZES[size]
        const n = Number(per) as 2 | 4 | 6 | 9
        const landscape = orient === 'landscape' || (orient === 'auto' && (n === 2 || n === 6))
        return {
          name: `${baseName(files[0].name)}-${per}up.pdf`,
          bytes: await nUp(getBytes(files[0].id), { perSheet: n, sheetWidth: p.width, sheetHeight: p.height, landscape, margin: Number(margin) * mm, gap: Number(gap) * mm, border, order }, progress),
          mime: PDF_MIME,
        }
      }}
    />
  )
}
export default NUpTool
