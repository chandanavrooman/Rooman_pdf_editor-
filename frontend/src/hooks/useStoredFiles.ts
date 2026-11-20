import { useMemo, useSyncExternalStore } from 'react'
import { listFiles, subscribe, type StoredFileMeta } from '@/lib/fileStore'

export function useAllStoredFiles(): StoredFileMeta[] {
  return useSyncExternalStore(subscribe, listFiles, listFiles)
}

/** Metas for the given ids, in the same order, skipping any that no longer exist. */
export function useStoredFiles(ids: string[]): StoredFileMeta[] {
  const all = useAllStoredFiles()
  return useMemo(() => ids.map((id) => all.find((f) => f.id === id)).filter((f): f is StoredFileMeta => !!f), [ids, all])
}
