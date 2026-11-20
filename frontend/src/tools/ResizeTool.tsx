import { useEffect, useMemo, useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { Notice } from '@/components/Notice'
import { Checkbox, Field, RadioCards, SelectField, TextField } from '@/components/forms'
import { ResizePreview } from '@/components/ResizePreview'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { PAGE_SIZES, resizePages } from '@/lib/pdfOps'
import { parsePageList } from '@/lib/ranges'
import { getPageSizes, type PageSize } from '@/lib/render'
import { PDF_MIME, type ToolPage } from './shared/types'

const MM = 72 / 25.4
const MAX_MM = 5080 // 14400 pt, the largest page PDF viewers accept

const ResizeTool: ToolPage = ({ tool }) => {
  const [fileId, setFileId] = useState<string>()
  const { doc, numPages } = usePdfDoc(fileId)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [preset, setPreset] = useState<string>('a4')
  const [wMm, setWMm] = useState('210')
  const [hMm, setHMm] = useState('297')
  const [mode, setMode] = useState<'fit' | 'fill'>('fit')
  const [auto, setAuto] = useState(true)
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [pagesText, setPagesText] = useState('')

  useEffect(() => {
    if (!doc) return
    let alive = true
    getPageSizes(doc).then((s) => alive && setSizes(s), () => {})
    return () => {
      alive = false
      setSizes([])
    }
  }, [doc])

  const custom = preset === 'custom'
  const cw = parseFloat(wMm)
  const ch = parseFloat(hMm)
  const customErrors = {
    w: !custom ? null : !Number.isFinite(cw) || !/^[\d.]+$/.test(wMm.trim()) ? 'Enter the width in millimetres.' : cw < 10 ? 'At least 10 mm.' : cw > MAX_MM ? `At most ${MAX_MM} mm.` : null,
    h: !custom ? null : !Number.isFinite(ch) || !/^[\d.]+$/.test(hMm.trim()) ? 'Enter the height in millimetres.' : ch < 10 ? 'At least 10 mm.' : ch > MAX_MM ? `At most ${MAX_MM} mm.` : null,
  }
  const w = custom ? cw * MM : PAGE_SIZES[preset]?.width
  const h = custom ? ch * MM : PAGE_SIZES[preset]?.height
  const sizeOk = Number.isFinite(w) && Number.isFinite(h) && !customErrors.w && !customErrors.h

  // which pages are resized
  const chosen = useMemo(() => {
    if (scope === 'all' || !numPages) return { pages: null as number[] | null, error: null as string | null }
    if (!pagesText.trim()) return { pages: null, error: 'Type the pages to resize, like 1-3, 5, 8-10.' }
    try {
      return { pages: parsePageList(pagesText, numPages), error: null }
    } catch (e) {
      return { pages: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [scope, pagesText, numPages])
  const pageSet = useMemo(() => (scope === 'selected' && chosen.pages ? new Set(chosen.pages) : null), [scope, chosen.pages])
  const pagesOk = scope === 'all' || !!chosen.pages

  const label = custom ? `${wMm || '?'} × ${hMm || '?'} mm` : (PAGE_SIZES[preset]?.label ?? '')
  const opts = { width: w, height: h, mode, autoOrient: auto, orientation: auto ? undefined : orientation }

  return (
    <ToolShell
      tool={tool}
      runLabel="Resize pages"
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setPagesText('')
      }}
      canRun={sizeOk && pagesOk}
      options={() => (
        <div className="space-y-6">
          <div className="space-y-3">
            <SelectField
              label="Paper size"
              value={preset}
              onChange={setPreset}
              options={[...Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: `${v.label} (${(v.width / MM).toFixed(0)} × ${(v.height / MM).toFixed(0)} mm)` })), { value: 'custom', label: 'Custom size…' }]}
            />
            {custom && (
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Width (mm)" type="number" min={10} value={wMm} onChange={setWMm} error={customErrors.w} testId="resize-w" />
                <TextField label="Height (mm)" type="number" min={10} value={hMm} onChange={setHMm} error={customErrors.h} testId="resize-h" />
              </div>
            )}
          </div>

          <RadioCards<'fit' | 'fill'>
            legend="How should each page fill the paper?"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'fit', label: 'Fit', description: 'The whole page is kept and scaled to fit inside the paper. White space is added where the shapes differ. Nothing is cropped.' },
              { value: 'fill', label: 'Fill', description: 'The page is scaled to cover the whole paper, with no white space. Where the shapes differ, the extra part of the page is cropped.' },
            ]}
          />
          {mode === 'fill' && (
            <Notice kind="warn" title="Some edges may be cropped">
              Fill removes white space by cutting off whatever sticks out past the paper. Check the preview below to see what is lost.
            </Notice>
          )}

          <div className="space-y-3">
            <Checkbox label="Automatically match page orientation" checked={auto} onChange={setAuto} hint="Portrait pages remain portrait, and landscape pages remain landscape." />
            {!auto && (
              <RadioCards<'portrait' | 'landscape'>
                legend="Orientation of every page"
                value={orientation}
                onChange={setOrientation}
                options={[
                  { value: 'portrait', label: 'Portrait', description: 'Every page is taller than wide.' },
                  { value: 'landscape', label: 'Landscape', description: 'Every page is wider than tall.' },
                ]}
              />
            )}
          </div>

          <div className="space-y-3">
            <RadioCards<'all' | 'selected'>
              legend="Which pages?"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'All pages', description: numPages ? `Resize the whole PDF (${numPages} pages).` : 'Resize the whole PDF.' },
                { value: 'selected', label: 'Selected pages', description: 'Resize only the pages you list. All other pages stay as they are.' },
              ]}
            />
            {scope === 'selected' && (
              <Field label="Pages to resize" htmlFor="resize-pages" error={chosen.error} hint={chosen.pages ? `${chosen.pages.length} page${chosen.pages.length === 1 ? '' : 's'} will be resized; the other ${numPages - chosen.pages.length} stay unchanged.` : numPages ? `Your document has ${numPages} pages.` : undefined}>
                <input id="resize-pages" data-testid="resize-pages" className={`input ${chosen.error ? '!border-red-500' : ''}`} value={pagesText} onChange={(e) => setPagesText(e.target.value)} placeholder="1-3, 5, 8-10" autoComplete="off" spellCheck={false} aria-invalid={!!chosen.error} />
              </Field>
            )}
          </div>

          {doc && sizes.length > 0 && fileId && sizeOk && <ResizePreview fileId={fileId} doc={doc} sizes={sizes} opts={opts} paperLabel={label} selected={pageSet} />}

          <p className="hint">Content is scaled evenly, never stretched. Text and images stay sharp. Interactive form fields and links on resized pages are not carried over.</p>
        </div>
      )}
      run={async ({ files, progress }) => {
        if (!sizeOk) throw new Error('Fix the paper size first.')
        return {
          name: `${baseName(files[0].name)}-resized.pdf`,
          bytes: await resizePages(getBytes(files[0].id), { ...opts, pages: chosen.pages ?? undefined }, progress),
          mime: PDF_MIME,
        }
      }}
    />
  )
}
export default ResizeTool
