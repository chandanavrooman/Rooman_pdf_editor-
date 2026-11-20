import { useState } from 'react'
import { ToolShell, type AcceptSpec } from '@/components/ToolShell'
import { RadioCards, SelectField, TextField } from '@/components/forms'
import { runServerTool } from '@/lib/serverTool'
import { apiJson, deleteDocument, downloadDocumentBytes, type ToolResult } from '@/lib/apiClient'
import { getBytes } from '@/lib/fileStore'
import type { ToolPage } from '../shared/types'

const PAGES_HINT = 'Leave empty for all pages, or e.g. 1-3,5'
const cleanPages = (v: string) => v.trim() || undefined

export const PdfToWord: ToolPage = ({ tool }) => (
  <ToolShell
    tool={tool}
    runLabel="Convert to Word"
    options={() => <p className="text-sm text-ink-600 dark:text-ink-300">Tables, alignment, colours and fonts are kept. Scanned pages are recognised with OCR when Tesseract is installed on the server; you will see a notice if the layout could not be kept.</p>}
    run={(ctx) => runServerTool(ctx, { endpoint: '/convert/pdf-to-word', body: (d) => ({ document_id: d[0].id }) })}
  />
)

export const PdfToExcel: ToolPage = ({ tool }) => {
  const [pages, setPages] = useState('')
  return (
    <ToolShell
      tool={tool}
      runLabel="Convert to Excel"
      options={() => <TextField label="Pages" value={pages} onChange={setPages} hint={`${PAGES_HINT}. Each table becomes a sheet.`} />}
      run={(ctx) => runServerTool(ctx, { endpoint: '/convert/pdf-to-excel', body: (d) => ({ document_id: d[0].id, pages: cleanPages(pages) }) })}
    />
  )
}

export const PdfToPowerPoint: ToolPage = ({ tool }) => {
  const [mode, setMode] = useState<'image' | 'editable'>('image')
  return (
    <ToolShell
      tool={tool}
      runLabel="Convert to PowerPoint"
      options={() => (
        <RadioCards
          legend="Slide type"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'image', label: 'Exact pages (images)', description: 'Each page is a full-slide picture — looks identical, text is not editable.' },
            { value: 'editable', label: 'Editable text', description: 'Page graphics as background with real text boxes (fonts matched by name).' },
          ]}
        />
      )}
      run={(ctx) => runServerTool(ctx, { endpoint: '/convert/pdf-to-powerpoint', body: (d) => ({ document_id: d[0].id, mode }) })}
    />
  )
}

function makePdfToImages(format: 'png' | 'jpg'): ToolPage {
  return function PdfToImagesTool({ tool }) {
    const [dpi, setDpi] = useState('150')
    const [pages, setPages] = useState('')
    return (
      <ToolShell
        tool={tool}
        runLabel={`Convert to ${format.toUpperCase()}`}
        options={() => (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Resolution" value={dpi} onChange={setDpi} options={[{ value: '72', label: '72 dpi (screen)' }, { value: '150', label: '150 dpi (good)' }, { value: '300', label: '300 dpi (print)' }]} />
            <TextField label="Pages" value={pages} onChange={setPages} hint={PAGES_HINT} />
          </div>
        )}
        run={(ctx) => runServerTool(ctx, { endpoint: '/convert/pdf-to-images', body: (d) => ({ document_id: d[0].id, format, dpi: Number(dpi), pages: cleanPages(pages) }) })}
      />
    )
  }
}
export const PdfToJpg = makePdfToImages('jpg')
export const PdfToPng = makePdfToImages('png')

export const PdfToText: ToolPage = ({ tool }) => {
  const [pages, setPages] = useState('')
  return (
    <ToolShell
      tool={tool}
      runLabel="Extract text"
      options={() => <TextField label="Pages" value={pages} onChange={setPages} hint={PAGES_HINT} />}
      run={(ctx) => runServerTool(ctx, { endpoint: '/convert/pdf-to-text', body: (d) => ({ document_id: d[0].id, pages: cleanPages(pages) }) })}
    />
  )
}

function makeOfficeToPdf(ext: string, label: string, endpoint: string): ToolPage {
  const accept: AcceptSpec = { extensions: [ext], label }
  return function OfficeToPdfTool({ tool }) {
    return (
      <ToolShell
        tool={tool}
        accept={accept}
        runLabel="Convert to PDF"
        uploadTitle={`Choose a ${label} file`}
        run={(ctx) => runServerTool(ctx, { endpoint, body: (d) => ({ document_id: d[0].id }) })}
      />
    )
  }
}
export const WordToPdf = makeOfficeToPdf('docx', '.docx Word', '/convert/word-to-pdf')
export const ExcelToPdf = makeOfficeToPdf('xlsx', '.xlsx Excel', '/convert/excel-to-pdf')
export const PowerPointToPdf = makeOfficeToPdf('pptx', '.pptx PowerPoint', '/convert/powerpoint-to-pdf')

const IMAGE_ACCEPT: AcceptSpec = { extensions: ['jpg', 'jpeg', 'png'], label: 'JPG or PNG image' }

export const ImagesToPdf: ToolPage = ({ tool }) => {
  const [pageSize, setPageSize] = useState<'fit' | 'a4' | 'letter'>('fit')
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto')
  const [margin, setMargin] = useState('0')
  const m = Number(margin)
  const marginOk = margin.trim() !== '' && Number.isFinite(m) && m >= 0 && m <= 50
  return (
    <ToolShell
      tool={tool}
      multiple
      accept={IMAGE_ACCEPT}
      runLabel="Create PDF"
      canRun={marginOk}
      uploadTitle="Choose images"
      options={() => (
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Page size" value={pageSize} onChange={setPageSize} options={[{ value: 'fit', label: 'Fit to image' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'US Letter' }]} />
          <SelectField label="Orientation" value={orientation} onChange={setOrientation} options={[{ value: 'auto', label: 'Automatic' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
          <TextField label="Margin (mm)" type="number" min={0} max={50} value={margin} onChange={setMargin} error={marginOk ? null : 'Enter 0–50'} />
        </div>
      )}
      run={(ctx) => runServerTool(ctx, { endpoint: '/convert/images-to-pdf', body: (d) => ({ document_ids: d.map((x) => x.id), page_size: pageSize, margin_mm: m, orientation }) })}
    />
  )
}

const TEXT_ACCEPT: AcceptSpec = { extensions: ['txt'], label: '.txt text' }

export const TextToPdf: ToolPage = ({ tool }) => {
  const [fontSize, setFontSize] = useState('11')
  const [pageSize, setPageSize] = useState<'a4' | 'letter'>('a4')
  const fs = Number(fontSize)
  const ok = Number.isFinite(fs) && fs >= 6 && fs <= 36
  return (
    <ToolShell
      tool={tool}
      accept={TEXT_ACCEPT}
      runLabel="Create PDF"
      canRun={ok}
      uploadTitle="Choose a .txt file"
      options={() => (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Font size (pt)" type="number" min={6} max={36} value={fontSize} onChange={setFontSize} error={ok ? null : 'Enter 6–36'} />
          <SelectField label="Page size" value={pageSize} onChange={setPageSize} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'US Letter' }]} />
        </div>
      )}
      run={(ctx) => runServerTool(ctx, { endpoint: '/convert/text-to-pdf', body: (d) => ({ document_id: d[0].id, font_size: fs, page_size: pageSize }) })}
    />
  )
}

const HTML_ACCEPT: AcceptSpec = { extensions: ['html', 'htm'], label: '.html web page' }

export const HtmlToPdf: ToolPage = ({ tool }) => {
  const [pageSize, setPageSize] = useState<'a4' | 'letter'>('a4')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  return (
    <ToolShell
      tool={tool}
      accept={HTML_ACCEPT}
      runLabel="Create PDF"
      uploadTitle="Choose an .html file"
      options={() => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Page size" value={pageSize} onChange={setPageSize} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'US Letter' }]} />
            <SelectField label="Orientation" value={orientation} onChange={setOrientation} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
          </div>
          <p className="text-sm text-ink-600 dark:text-ink-300">The page is drawn by a browser on the server. For safety, scripts are not run and nothing is loaded from the web or from other files: styles written in the file and pictures embedded in it (data: images) are kept.</p>
        </div>
      )}
      run={async (ctx) => {
        const html = new TextDecoder('utf-8').decode(getBytes(ctx.files[0].id))
        ctx.progress(0.2, 'Drawing the page on the server…')
        const res = await apiJson<ToolResult>('/convert/html-to-pdf', { html, page_size: pageSize, orientation }, { signal: ctx.signal })
        const d = res.documents[0]
        ctx.progress(0.9, `Downloading ${d.filename}`)
        const bytes = await downloadDocumentBytes(d, ctx.signal)
        void deleteDocument(d.id)
        return { outputs: [{ name: ctx.files[0].name.replace(/\.html?$/i, '') + '.pdf', bytes, mime: 'application/pdf' }], notes: res.notice ? [res.notice] : [] }
      }}
    />
  )
}
