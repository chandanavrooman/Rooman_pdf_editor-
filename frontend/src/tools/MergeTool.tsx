import { ToolShell } from '@/components/ToolShell'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { mergePdfs } from '@/lib/pdfOps'
import { PDF_MIME, type ToolPage } from './shared/types'

const MergeTool: ToolPage = ({ tool }) => (
  <ToolShell
    tool={tool}
    multiple
    minFiles={2}
    runLabel="Merge PDF"
    uploadTitle="Choose the PDF files to merge"
    options={() => <p className="text-sm text-ink-600 dark:text-ink-300">Files are merged in the order listed above. Drag a file or use the arrows to change the order.</p>}
    run={async ({ files, progress }) => {
      const bytes = await mergePdfs(files.map((f) => ({ name: f.name, bytes: getBytes(f.id) })), progress)
      return { name: `${baseName(files[0].name)}-merged.pdf`, bytes, mime: PDF_MIME }
    }}
  />
)
export default MergeTool
