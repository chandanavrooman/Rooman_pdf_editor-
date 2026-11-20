import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { Notice } from '@/components/Notice'
import { RadioCards, TextField } from '@/components/forms'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { alternateMix, flipPages, pdfFromPageImages, splitInHalf, type FlipAxis, type HalfDirection } from '@/lib/pdfOps'
import { renderGrayscalePages } from '@/lib/grayscaleRaster'
import { usePageSelection } from './shared/pageSelection'
import { PDF_MIME, type ToolPage } from './shared/types'

const note = 'text-sm text-ink-600 dark:text-ink-300'

/** Alternate & Mix: two PDFs, pages taken in turn (for example the front and back sides of a scanned stack). */
export const AlternateMixTool: ToolPage = ({ tool }) => {
  const [reverseB, setReverseB] = useState(false)
  const [reverseA, setReverseA] = useState(false)
  return (
    <ToolShell
      tool={tool}
      multiple
      minFiles={2}
      runLabel="Alternate & mix"
      uploadTitle="Choose the two PDF files to mix"
      options={() => (
        <div className="space-y-3">
          <p className={note}>Pages are taken in turn: page 1 of the first file, page 1 of the second, page 2 of the first, and so on. The first two files in the list are used, the first one goes first.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid="mix-reverse-b" checked={reverseB} onChange={(e) => setReverseB(e.target.checked)} /> Take the second file&apos;s pages in reverse order (back sides scanned last to first)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid="mix-reverse-a" checked={reverseA} onChange={(e) => setReverseA(e.target.checked)} /> Take the first file&apos;s pages in reverse order
          </label>
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-mixed.pdf`,
        bytes: await alternateMix(getBytes(files[0].id), getBytes(files[1].id), { reverseA, reverseB }, progress),
        mime: PDF_MIME,
      })}
    />
  )
}

/** Split in half: each page becomes two pages. */
export const SplitHalfTool: ToolPage = ({ tool }) => {
  const [dir, setDir] = useState<HalfDirection>('auto')
  const [rangeText, setRangeText] = useState('')
  const [fileId, setFileId] = useState<string>()
  const { numPages } = usePdfDoc(fileId)
  const sel = usePageSelection(rangeText, numPages)
  return (
    <ToolShell
      tool={tool}
      runLabel="Split pages in half"
      canRun={!sel.error}
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setRangeText('')
      }}
      options={() => (
        <div className="space-y-5">
          <RadioCards<HalfDirection>
            legend="Where to cut"
            value={dir}
            onChange={setDir}
            options={[
              { value: 'auto', label: 'Automatic', description: 'Landscape pages down the middle, portrait pages across the middle' },
              { value: 'vertical', label: 'Left and right', description: 'A vertical cut: the left half first, then the right half' },
              { value: 'horizontal', label: 'Top and bottom', description: 'A horizontal cut: the top half first, then the bottom half' },
            ]}
          />
          <TextField label="Only these pages (empty = all)" value={rangeText} onChange={setRangeText} error={sel.error} placeholder="e.g. 1-4" />
          <p className={note}>Each page you choose becomes two pages. Text and links stay as they are; nothing is turned into a picture.</p>
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-halves.pdf`,
        bytes: await splitInHalf(getBytes(files[0].id), { direction: dir, pages: sel.pages.length ? sel.pages : undefined }, progress),
        mime: PDF_MIME,
      })}
    />
  )
}

/** Flip: mirror pages left-right or top-bottom. */
export const FlipTool: ToolPage = ({ tool }) => {
  const [axis, setAxis] = useState<FlipAxis>('horizontal')
  const [rangeText, setRangeText] = useState('')
  const [fileId, setFileId] = useState<string>()
  const { numPages } = usePdfDoc(fileId)
  const sel = usePageSelection(rangeText, numPages)
  return (
    <ToolShell
      tool={tool}
      runLabel="Flip pages"
      canRun={!sel.error}
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setRangeText('')
      }}
      options={() => (
        <div className="space-y-5">
          <RadioCards<FlipAxis>
            legend="Flip direction"
            value={axis}
            onChange={setAxis}
            options={[
              { value: 'horizontal', label: 'Left to right', description: 'Like a mirror: text reads backwards' },
              { value: 'vertical', label: 'Top to bottom', description: 'The page is mirrored upside down' },
            ]}
          />
          <TextField label="Only these pages (empty = all)" value={rangeText} onChange={setRangeText} error={sel.error} placeholder="e.g. 2-" />
          <p className={note}>Flipped pages are redrawn as they are, so text stays text. Links and form fields on a flipped page are not kept.</p>
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-flipped.pdf`,
        bytes: await flipPages(getBytes(files[0].id), { axis, pages: sel.pages.length ? sel.pages : undefined }, progress),
        mime: PDF_MIME,
      })}
    />
  )
}

/** Grayscale: every page in shades of gray. */
export const GrayscaleTool: ToolPage = ({ tool }) => (
  <ToolShell
    tool={tool}
    runLabel="Convert to grayscale"
    options={() => (
      <Notice kind="info" title="How this works">
        Each page is drawn in your browser, turned gray and saved as a picture (about 180 dpi). The text then cannot be selected. Run OCR PDF afterwards if you need searchable text.
      </Notice>
    )}
    run={async ({ files, progress }) => {
      const pages = await renderGrayscalePages(getBytes(files[0].id), (f) => progress(f * 0.8, 'Converting pages'))
      return { name: `${baseName(files[0].name)}-grayscale.pdf`, bytes: await pdfFromPageImages(pages, (f) => progress(0.8 + f * 0.2)), mime: PDF_MIME }
    }}
  />
)
