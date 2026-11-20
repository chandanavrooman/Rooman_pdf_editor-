import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdfFromStore } from '@/lib/pdfjs'

export interface PdfDocState {
  doc: PDFDocumentProxy | null
  numPages: number
  error: string | null
  loading: boolean
}

/**
 * Open a stored file with pdf.js. pdf.js gets its own COPY of the bytes, so the same stored file
 * can be opened by any number of viewers/tools. The loading task is destroyed on unmount.
 */
export function usePdfDoc(fileId: string | undefined): PdfDocState {
  const [state, setState] = useState<PdfDocState & { forId?: string }>({ doc: null, numPages: 0, error: null, loading: !!fileId })

  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    let task: ReturnType<typeof loadPdfFromStore> | null = null
    try {
      task = loadPdfFromStore(fileId)
    } catch (e) {
      queueMicrotask(() => !cancelled && setState({ doc: null, numPages: 0, error: e instanceof Error ? e.message : String(e), loading: false, forId: fileId }))
      return
    }
    task.promise.then(
      (doc) => {
        if (!cancelled) setState({ doc, numPages: doc.numPages, error: null, loading: false, forId: fileId })
      },
      (e: unknown) => {
        if (cancelled) return
        const name = (e as { name?: string })?.name
        const msg = name === 'PasswordException' ? 'This PDF is password protected. Unlock it first with the Unlock PDF tool.' : e instanceof Error ? e.message : String(e)
        setState({ doc: null, numPages: 0, error: msg, loading: false, forId: fileId })
      },
    )
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [fileId])

  if (!fileId) return { doc: null, numPages: 0, error: null, loading: false }
  if (state.forId !== fileId) return { doc: null, numPages: 0, error: null, loading: true }
  return state
}
