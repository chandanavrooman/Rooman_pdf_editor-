import { useEffect, useMemo, useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { Notice } from '@/components/Notice'
import { Field, RadioCards, TextField } from '@/components/forms'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes, type StoredFileMeta } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { addBookmarks, parseBookmarkLines, readBookmarks, removeAnnotations } from '@/lib/pdfOps'
import { extractImages } from '@/lib/extractImages'
import { planRenames, type RenameInfo, type RenameSource } from '@/lib/renamePlan'
import { loadPdfFromBytes } from '@/lib/pdfjs'
import { PDFDocument } from 'pdf-lib'
import { usePageSelection } from './shared/pageSelection'
import { PDF_MIME, type ToolPage } from './shared/types'

const note = 'text-sm text-ink-600 dark:text-ink-300'

/** Extract images: every picture in the PDF as a PNG file. */
export const ExtractImagesTool: ToolPage = ({ tool }) => {
  const [minSize, setMinSize] = useState('64')
  const min = Math.max(1, Math.round(Number(minSize)) || 1)
  return (
    <ToolShell
      tool={tool}
      runLabel="Extract images"
      canRun={Number.isFinite(Number(minSize)) && Number(minSize) >= 1}
      options={() => (
        <div className="space-y-4">
          <TextField label="Skip pictures smaller than (pixels)" type="number" min={1} step={1} value={minSize} onChange={setMinSize} testId="extract-min" hint="Icons, bullets and thin lines are pictures too. Pictures where both sides are smaller than this are left out." />
          <p className={note}>Pictures come out as PNG files, named after their page. Only pictures stored in the PDF are found, not drawings made of lines and shapes.</p>
        </div>
      )}
      run={async ({ files, progress }) => {
        const found = await extractImages(getBytes(files[0].id), { minSize: min }, (f) => progress(f, 'Looking for pictures'))
        if (!found.length) throw new Error('No pictures were found in this PDF' + (min > 1 ? ` (larger than ${min} pixels).` : '.'))
        const base = baseName(files[0].name)
        return {
          outputs: found.map((f) => ({ name: `${base}-page-${f.page}-image-${f.index}.png`, bytes: f.png, mime: 'image/png' })),
          infos: [`${found.length} picture${found.length === 1 ? '' : 's'} found.`],
        }
      }}
    />
  )
}

/** Remove annotations: comments, highlights, drawings and/or links. */
export const RemoveAnnotationsTool: ToolPage = ({ tool }) => {
  const [markup, setMarkup] = useState(true)
  const [links, setLinks] = useState(false)
  const [rangeText, setRangeText] = useState('')
  const [fileId, setFileId] = useState<string>()
  const { numPages } = usePdfDoc(fileId)
  const sel = usePageSelection(rangeText, numPages)
  return (
    <ToolShell
      tool={tool}
      runLabel="Remove annotations"
      canRun={(markup || links) && !sel.error}
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setRangeText('')
      }}
      options={() => (
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="label">What to remove</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" data-testid="rm-markup" checked={markup} onChange={(e) => setMarkup(e.target.checked)} /> Comments and marks: highlights, underlines, notes, stamps, drawings, shapes and text boxes
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" data-testid="rm-links" checked={links} onChange={(e) => setLinks(e.target.checked)} /> Links (the clickable areas)
            </label>
          </fieldset>
          <TextField label="Only these pages (empty = all)" value={rangeText} onChange={setRangeText} error={sel.error} placeholder="e.g. 1-3" />
          <p className={note}>Form fields are never removed. Text and pictures that are part of the page itself, including text you added with the editor and saved, are not annotations and stay.</p>
        </div>
      )}
      run={async ({ files, progress }) => {
        const r = await removeAnnotations(getBytes(files[0].id), { markup, links }, sel.pages.length ? sel.pages : undefined, progress)
        const total = r.removed.markup + r.removed.links
        return {
          outputs: [{ name: `${baseName(files[0].name)}-clean.pdf`, bytes: r.bytes, mime: PDF_MIME }],
          infos: [total ? `Removed ${r.removed.markup} comment${r.removed.markup === 1 ? '' : 's'}/mark${r.removed.markup === 1 ? '' : 's'} and ${r.removed.links} link${r.removed.links === 1 ? '' : 's'}.` : 'There was nothing of that kind to remove.'],
        }
      }}
    />
  )
}

/** Create bookmarks: type a list of titles and pages. */
export const CreateBookmarksTool: ToolPage = ({ tool }) => {
  const [text, setText] = useState('')
  const [fileId, setFileId] = useState<string>()
  const [existing, setExisting] = useState(0)
  const { numPages } = usePdfDoc(fileId)
  const parsed = useMemo(() => parseBookmarkLines(text, numPages || 1), [text, numPages])
  const ok = numPages > 0 && parsed.items.length > 0 && parsed.errors.length === 0
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    readBookmarks(getBytes(fileId)).then(
      (b) => {
        if (cancelled) return
        setExisting(b.length)
        setText(b.map((x) => `${'  '.repeat(x.level)}${x.title}, ${x.page}`).join('\n'))
      },
      () => !cancelled && setExisting(0),
    )
    return () => {
      cancelled = true
    }
  }, [fileId])
  return (
    <ToolShell
      tool={tool}
      runLabel="Create bookmarks"
      canRun={ok}
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setText('')
        setExisting(0)
      }}
      options={() => (
        <div className="space-y-4">
          <Field label="Bookmarks, one per line" htmlFor="bm-text" error={parsed.errors[0] ?? null} hint={`Write the title, a comma, then the page number${numPages ? ` (1 to ${numPages})` : ''}. Start a line with two spaces to put it inside the bookmark above.`}>
            <textarea id="bm-text" data-testid="bm-text" className={`input min-h-48 font-mono text-sm ${parsed.errors.length ? '!border-red-500' : ''}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Introduction, 1\n  Background, 2\nMethods, 5\nResults, 9'} spellCheck={false} />
          </Field>
          {existing > 0 && <Notice kind="info">This PDF already has {existing} bookmark{existing === 1 ? '' : 's'}; they are listed above so you can change them. The list you save replaces them.</Notice>}
          {parsed.errors.length > 1 && <p className="text-xs text-red-600 dark:text-red-400">{parsed.errors.length - 1} more line{parsed.errors.length === 2 ? '' : 's'} to fix.</p>}
          {ok && <p className={note} data-testid="bm-count">{parsed.items.length} bookmark{parsed.items.length === 1 ? '' : 's'} will be saved.</p>}
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-bookmarked.pdf`,
        bytes: await addBookmarks(getBytes(files[0].id), parsed.items, progress),
        mime: PDF_MIME,
      })}
    />
  )
}

async function readInfo(f: StoredFileMeta): Promise<RenameInfo> {
  const bytes = getBytes(f.id)
  const info: RenameInfo = { name: f.name }
  try {
    const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    info.title = d.getTitle()?.trim() || undefined
  } catch {
    /* unreadable properties: the name falls back */
  }
  const task = loadPdfFromBytes(bytes)
  try {
    const doc = await task.promise
    const tc = await (await doc.getPage(1)).getTextContent()
    const items = tc.items.filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i && !!i.str.trim())
    if (items.length) {
      // the topmost line: items on the same baseline as the highest one
      const top = Math.max(...items.map((i) => i.transform[5]))
      info.firstLine = items.filter((i) => Math.abs(i.transform[5] - top) < 2).map((i) => i.str.trim()).join(' ')
    }
  } catch {
    /* no text: the name falls back */
  } finally {
    await task.destroy()
  }
  return info
}

/** Rename: give PDFs new names from their title, their first line of text, or a pattern. */
export const RenameTool: ToolPage = ({ tool }) => {
  const [source, setSource] = useState<RenameSource>('title')
  const [pattern, setPattern] = useState('{name}-{n:2}')
  const [infos, setInfos] = useState<RenameInfo[]>([])
  const names = useMemo(() => planRenames(infos, source, pattern), [infos, source, pattern])
  return (
    <ToolShell
      tool={tool}
      multiple
      runLabel="Rename PDFs"
      uploadTitle="Choose the PDF files to rename"
      canRun={infos.length > 0}
      onFilesChange={(f) => {
        setInfos(f.map((x) => ({ name: x.name })))
        void Promise.all(f.map(readInfo)).then(setInfos)
      }}
      options={() => (
        <div className="space-y-5">
          <RadioCards<RenameSource>
            legend="Name each file after"
            value={source}
            onChange={setSource}
            options={[
              { value: 'title', label: 'Its title', description: 'The title in the PDF properties; the old name if it has none' },
              { value: 'first-line', label: 'Its first line', description: 'The first line of text on page 1' },
              { value: 'pattern', label: 'A pattern', description: 'For example Invoice-{n:3}: Invoice-001, Invoice-002' },
            ]}
          />
          {source === 'pattern' && <TextField label="Pattern" value={pattern} onChange={setPattern} testId="rename-pattern" hint="{n} counts from 1 ({n:3} gives 001), {name} is the old name, {title} the document title." />}
          <div data-testid="rename-preview">
            <p className="label">New names</p>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 text-sm dark:divide-ink-800 dark:border-ink-700">
              {infos.map((f, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                  <span className="min-w-0 truncate text-ink-500" title={f.name}>{f.name}</span>
                  <span aria-hidden="true">→</span>
                  <span className="min-w-0 truncate font-medium" data-testid="rename-new" title={names[i]}>{names[i]}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className={note}>The files are not changed, only their names. Characters that file names cannot hold are replaced by spaces.</p>
        </div>
      )}
      run={async ({ files }) => {
        const fresh = await Promise.all(files.map(readInfo))
        const out = planRenames(fresh, source, pattern)
        return { outputs: files.map((f, i) => ({ name: out[i], bytes: getBytes(f.id), mime: PDF_MIME })) }
      }}
    />
  )
}
