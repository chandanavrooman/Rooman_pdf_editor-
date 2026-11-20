import { useMemo } from 'react'
import { parsePageList } from '@/lib/ranges'

/** Parse a page-range text safely: returns the page list or a user-facing error. */
export function usePageSelection(text: string, total: number) {
  return useMemo(() => {
    if (!text.trim() || total < 1) return { pages: [] as number[], error: null as string | null }
    try {
      return { pages: parsePageList(text, total), error: null }
    } catch (e) {
      return { pages: [] as number[], error: e instanceof Error ? e.message : String(e) }
    }
  }, [text, total])
}
