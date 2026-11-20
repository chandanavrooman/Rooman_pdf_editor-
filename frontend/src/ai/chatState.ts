import type { DocumentInfo } from '@/lib/apiClient'
import type { SseEvent } from '@/lib/sse'
import { streamEventError, type Citation, type StreamError } from './shared'

export interface ToolCard {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'ok' | 'failed' | 'declined'
  message?: string
  notice?: string | null
  documents: DocumentInfo[]
  checks: string[]
  details?: Record<string, unknown>
}

export interface PendingConfirmation {
  action_id: string
  tool: string
  arguments: Record<string, unknown>
  message: string
  state: 'pending' | 'approved' | 'declined'
}

export interface AssistantMessage {
  id: string
  role: 'assistant'
  content: string
  citations: Citation[]
  tools: ToolCard[]
  confirmation: PendingConfirmation | null
  documents: DocumentInfo[]
  notices: string[]
  error: StreamError | null
  streaming: boolean
  status?: 'complete' | 'awaiting_confirmation' | 'max_iterations'
  toolsEnabled?: boolean
  toolsError?: string | null
}

export interface UserMessage {
  id: string
  role: 'user'
  content: string
}

export type ChatMessage = UserMessage | AssistantMessage

export const newAssistant = (id: string): AssistantMessage => ({
  id,
  role: 'assistant',
  content: '',
  citations: [],
  tools: [],
  confirmation: null,
  documents: [],
  notices: [],
  error: null,
  streaming: true,
})

type Obj = Record<string, unknown>
const asDocs = (v: unknown): DocumentInfo[] => (Array.isArray(v) ? (v as DocumentInfo[]) : [])

function addCitation(list: Citation[], c: Citation): Citation[] {
  return list.some((x) => x.page === c.page && x.document_id === c.document_id) ? list : [...list, c]
}

/** Pure reducer: fold one SSE event of the chat protocol into the assistant message. */
export function applyChatEvent(msg: AssistantMessage, ev: SseEvent): AssistantMessage {
  const d = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Obj
  switch (ev.event) {
    case 'meta':
      return { ...msg, toolsEnabled: d.tools_enabled as boolean | undefined, toolsError: (d.tools_error as string | null) ?? null }
    case 'token':
      return { ...msg, content: msg.content + String(d.text ?? '') }
    case 'citation':
      return { ...msg, citations: addCitation(msg.citations, d as unknown as Citation) }
    case 'notice':
      return { ...msg, notices: [...msg.notices, String(d.message ?? '')] }
    case 'tool_call': {
      const card: ToolCard = { id: String(d.id), name: String(d.name), args: (d.arguments as Obj) ?? {}, status: 'running', documents: [], checks: [] }
      return { ...msg, tools: [...msg.tools.filter((t) => t.id !== card.id), card] }
    }
    case 'tool_result': {
      const id = String(d.id)
      const verification = (d.verification as { checks?: string[]; problems?: string[] } | undefined) ?? {}
      const patch: Partial<ToolCard> = {
        status: d.declined ? 'declined' : d.ok ? 'ok' : 'failed',
        message: typeof d.message === 'string' ? d.message : undefined,
        notice: (d.notice as string | null) ?? null,
        documents: asDocs(d.documents),
        checks: [...(verification.checks ?? []), ...(verification.problems ?? []).map((p) => `⚠ ${p}`)],
        details: d.details as Obj | undefined,
      }
      const exists = msg.tools.some((t) => t.id === id)
      const tools = exists
        ? msg.tools.map((t) => (t.id === id ? { ...t, ...patch } : t))
        : [...msg.tools, { id, name: String(d.name), args: {}, documents: [], checks: [], ...patch } as ToolCard]
      return { ...msg, tools }
    }
    case 'confirmation_required':
      return {
        ...msg,
        confirmation: { action_id: String(d.action_id), tool: String(d.tool), arguments: (d.arguments as Obj) ?? {}, message: String(d.message ?? ''), state: 'pending' },
      }
    case 'done': {
      const citations = ((d.citations as Citation[] | undefined) ?? []).reduce(addCitation, msg.citations)
      return { ...msg, streaming: false, citations, documents: asDocs(d.documents), status: d.status as AssistantMessage['status'] }
    }
    case 'error':
      return { ...msg, streaming: false, error: streamEventError(d as { code?: string; message?: string }) }
    default:
      return msg
  }
}
