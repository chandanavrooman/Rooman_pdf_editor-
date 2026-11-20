import { useEffect, useState } from 'react'
import { loadPdfFromStore } from '@/lib/pdfjs'

/**
 * Page counts of stored files, by id. `undefined` = still counting, `null` = the file could not be read (locked or damaged).
 * Each file is opened once; adding, removing or reordering files does not recount the others.
 */
export function usePageCounts(ids: string[]): Record<string, number | null | undefined> {
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const key = ids.join('|')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const id of ids) {
        if (cancelled) return
        if (counts[id] !== undefined) continue
        let n: number | null = null
        try {
          const task = loadPdfFromStore(id)
          try {
            n = (await task.promise).numPages
          } finally {
            await task.destroy()
          }
        } catch {
          n = null
        }
        if (cancelled) return
        setCounts((c) => (c[id] === n ? c : { ...c, [id]: n }))
      }
    })()
    return () => {
      cancelled = true
    }
    // `key` stands for the list of ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return counts
}
