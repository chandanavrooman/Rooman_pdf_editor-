import { useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { PageSelector } from '@/components/PageSelector'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { deletePages } from '@/lib/pdfOps'
import { usePageSelection } from './shared/pageSelection'
import { PDF_MIME, type ToolPage } from './shared/types'

const DeleteTool: ToolPage = ({ tool }) => {
  const [text, setText] = useState('')
  const [fileId, setFileId] = useState<string>()
  const { doc, numPages } = usePdfDoc(fileId)
  const { pages, error } = usePageSelection(text, numPages)
  return (
    <ToolShell
      tool={tool}
      runLabel="Delete pages"
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setText('')
      }}
      canRun={pages.length > 0 && !error}
      options={() => <PageSelector doc={doc} numPages={numPages} text={text} onText={setText} pages={pages} error={error} tone="danger" label="Pages to delete" />}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-edited.pdf`,
        bytes: await deletePages(getBytes(files[0].id), pages, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default DeleteTool
