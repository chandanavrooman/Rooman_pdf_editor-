import type { DocumentInfo } from '@/lib/apiClient'
import type { SseEvent } from '@/lib/sse'
import { streamEventError, type Citation, type StreamError } from './shared'

export interface DiffChange {
  type: 'added' | 'removed' | 'changed'
  a_pages: number[]
  b_pages: number[]
  a_text: string
  b_text: string
}
export interface DiffPayload {
  identical: boolean
  mode?: string
  pages_a: number
  pages_b: number
  similarity: number
  summary: { added_lines: number; removed_lines: number; changed_blocks: number; total_changes: number }
  changes: DiffChange[]
  truncated?: boolean
}

export interface StreamState {
  status: 'idle' | 'streaming' | 'done' | 'error'
  text: string
  /** translate: the text of each page in order */
  segments: { page: number; text: string }[]
  citations: Citation[]
  documents: DocumentInfo[]
  diff: DiffPayload | null
  notices: string[]
  progress: { done: number; total: number } | null
  error: StreamError | null
}

export const initialStream: StreamState = { status: 'idle', text: '', segments: [], citations: [], documents: [], diff: null, notices: [], progress: null, error: null }

type Obj = Record<string, unknown>

export function reduceStream(s: StreamState, ev: SseEvent): StreamState {
  const d = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Obj
  switch (ev.event) {
    case 'token': {
      const t = String(d.text ?? '')
      const segments = s.segments.length ? s.segments.map((x, i) => (i === s.segments.length - 1 ? { ...x, text: x.text + t } : x)) : s.segments
      return { ...s, text: s.text + t, segments }
    }
    case 'page':
      return { ...s, segments: [...s.segments, { page: Number(d.page), text: '' }], text: s.text && !s.text.endsWith('\n\n') ? s.text + '\n\n' : s.text }
    case 'citation': {
      const c = d as unknown as Citation
      return s.citations.some((x) => x.page === c.page && x.document_id === c.document_id) ? s : { ...s, citations: [...s.citations, c] }
    }
    case 'progress':
      return { ...s, progress: { done: Number(d.done), total: Number(d.total) } }
    case 'notice':
      return { ...s, notices: [...s.notices, String(d.message ?? '')] }
    case 'diff':
      return { ...s, diff: d as unknown as DiffPayload }
    case 'done':
      return { ...s, status: 'done', documents: Array.isArray(d.documents) ? (d.documents as DocumentInfo[]) : s.documents }
    case 'error':
      return { ...s, status: 'error', error: streamEventError(d as { code?: string; message?: string }) }
    default:
      return s
  }
}
