import { Checkbox, ColorField, SelectField, TextField } from '@/components/forms'
import type { TextStyle } from '@/lib/pdfOps'
import { hexToRgb } from '@/components/forms'

export interface StyleState {
  font: TextStyle['font']
  size: string
  bold: boolean
  color: string
  marginMm: string
}

export const defaultStyleState: StyleState = { font: 'Helvetica', size: '11', bold: false, color: '#000000', marginMm: '10' }

export function toTextStyle(s: StyleState): TextStyle {
  return { font: s.font, fontSize: Number(s.size), bold: s.bold, color: hexToRgb(s.color), margin: Number(s.marginMm) * (72 / 25.4) }
}

export function styleValid(s: StyleState): boolean {
  const n = Number(s.size)
  return n >= 4 && n <= 72 && Number(s.marginMm) >= 0
}

export function StyleFields({ value, onChange }: { value: StyleState; onChange: (s: StyleState) => void }) {
  const set = <K extends keyof StyleState>(k: K, v: StyleState[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <SelectField label="Font" value={value.font} onChange={(v) => set('font', v)} options={[{ value: 'Helvetica', label: 'Helvetica' }, { value: 'Times', label: 'Times' }, { value: 'Courier', label: 'Courier' }]} />
      <TextField label="Size (pt)" type="number" min={4} max={72} value={value.size} onChange={(v) => set('size', v)} testId="style-size" />
      <TextField label="Margin from edge (mm)" type="number" min={0} value={value.marginMm} onChange={(v) => set('marginMm', v)} />
      <ColorField label="Color" value={value.color} onChange={(v) => set('color', v)} />
      <div className="col-span-2 sm:col-span-4">
        <Checkbox label="Bold" checked={value.bold} onChange={(v) => set('bold', v)} />
      </div>
    </div>
  )
}
