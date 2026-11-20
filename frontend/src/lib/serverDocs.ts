/**
 * Cache of FileStore files already uploaded to the server (fileId → DocumentInfo), so chaining several server tools on the
 * same file (or editing again) uploads it once. Entries are dropped when they near their server-side expiry or when the
 * server says NOT_FOUND. Documents are deleted by the server after FILE_TTL_MINUTES regardless.
 */
import { getBytes, type StoredFileMeta } from './fileStore'
import { uploadDocument, type DocumentInfo } from './apiClient'

const cache = new Map<string, DocumentInfo>()

function fresh(d: DocumentInfo): boolean {
  if (!d.expires_at) return true
  const t = Date.parse(d.expires_at)
  return Number.isNaN(t) || t - Date.now() > 60_000
}

export function forgetServerDocument(fileId: string): void {
  cache.delete(fileId)
}
export function forgetAllServerDocuments(): void {
  cache.clear()
}
export function cachedServerDocument(fileId: string): DocumentInfo | undefined {
  const d = cache.get(fileId)
  return d && fresh(d) ? d : undefined
}

export async function ensureServerDocument(file: StoredFileMeta, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<DocumentInfo> {
  const hit = cachedServerDocument(file.id)
  if (hit) {
    onProgress?.(1)
    return hit
  }
  // getBytes returns a private copy; the Blob copies again, so the stored buffer is never exposed
  const blob = new Blob([getBytes(file.id) as BlobPart], { type: file.mime })
  const doc = await uploadDocument(blob, file.name, onProgress, signal)
  cache.set(file.id, doc)
  return doc
}
