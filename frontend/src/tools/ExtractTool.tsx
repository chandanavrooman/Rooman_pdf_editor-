import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { PageSelector } from '@/components/PageSelector'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { extractPages } from '@/lib/pdfOps'
import { usePageSelection } from './shared/pageSelection'
import { PDF_MIME, type ToolPage } from './shared/types'

const ExtractTool: ToolPage = ({ tool }) => {
  const [text, setText] = useState('')
  const [fileId, setFileId] = useState<string>()
  const { doc, numPages } = usePdfDoc(fileId)
  const { pages, error } = usePageSelection(text, numPages)
  return (
    <ToolShell
      tool={tool}
      runLabel="Extract pages"
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setText('')
      }}
      canRun={pages.length > 0 && !error}
      options={() => <PageSelector doc={doc} numPages={numPages} text={text} onText={setText} pages={pages} error={error} label="Pages to extract" />}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-extracted.pdf`,
        bytes: await extractPages(getBytes(files[0].id), pages, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default ExtractTool
