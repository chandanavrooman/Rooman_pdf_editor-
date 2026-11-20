import { describe, expect, it } from 'vitest'
import { parseBlocks, parseCitation } from './Markdown'
import { applyChatEvent, newAssistant } from './chatState'
import { initialStream, reduceStream } from './streamState'
import type { SseEvent } from '@/lib/sse'

const ev = (event: string, data: unknown): SseEvent => ({ event, data, raw: JSON.stringify(data) })

describe('citations', () => {
  it('parses page markers in the formats the backend produces', () => {
    expect(parseCitation('[p. 3]')).toEqual({ label: undefined, pages: [{ page: 3, text: '3' }] })
    expect(parseCitation('[D2 p. 4]')).toEqual({ label: 'D2', pages: [{ page: 4, text: '4' }] })
    expect(parseCitation('[pp. 3-5]')?.pages).toEqual([{ page: 3, text: '3–5' }])
    expect(parseCitation('[p. 2, 7]')?.pages.map((p) => p.page)).toEqual([2, 7])
    expect(parseCitation('[a link](x)')).toBeNull()
  })
})

describe('markdown blocks', () => {
  it('splits paragraphs, lists, headings, code and tables without producing HTML', () => {
    const b = parseBlocks('# Title\n\nHello <script>alert(1)</script> world\n\n- a\n- b\n\n1. one\n2. two\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```')
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'table', 'code'])
    expect(b[1]).toEqual({ t: 'p', text: 'Hello <script>alert(1)</script> world' }) // kept as plain text; React escapes it
  })
})

describe('chat event reducer', () => {
  it('folds tokens, citations, a tool call and its result into one assistant message', () => {
    let m = newAssistant('a1')
    for (const e of [
      ev('meta', { tools_enabled: true }),
      ev('tool_call', { id: 'c1', name: 'extract_pages', arguments: { pages: '1-3' } }),
      ev('tool_result', { id: 'c1', name: 'extract_pages', ok: true, documents: [{ id: 'd'.repeat(32), filename: 'x.pdf', size: 10, pages: 3, download_url: '/x' }], verification: { checks: ['page count 3 as expected'], problems: [] } }),
      ev('token', { text: 'Done ' }),
      ev('token', { text: '[p. 2]' }),
      ev('citation', { document_id: 'd1', label: 'D1', page: 2, snippet: 's' }),
      ev('done', { status: 'complete', citations: [{ document_id: 'd1', label: 'D1', page: 2 }], documents: [{ id: 'z'.repeat(32), filename: 'y.pdf', size: 1, pages: 3, download_url: '/y' }] }),
    ]) m = applyChatEvent(m, e)
    expect(m.content).toBe('Done [p. 2]')
    expect(m.tools[0]).toMatchObject({ status: 'ok', name: 'extract_pages', checks: ['page count 3 as expected'] })
    expect(m.tools[0].documents[0].pages).toBe(3)
    expect(m.citations).toHaveLength(1) // de-duplicated between `citation` and `done`
    expect(m.streaming).toBe(false)
    expect(m.status).toBe('complete')
    expect(m.documents).toHaveLength(1)
  })

  it('confirmation_required shows a pending confirmation and the stream ends awaiting it', () => {
    let m = newAssistant('a1')
    m = applyChatEvent(m, ev('confirmation_required', { action_id: 'act12345', tool: 'delete_pages', arguments: { pages: '1,2' }, message: 'Delete pages 1,2 of x.pdf?', destructive: true }))
    m = applyChatEvent(m, ev('done', { status: 'awaiting_confirmation', action_id: 'act12345', documents: [] }))
    expect(m.confirmation).toMatchObject({ action_id: 'act12345', tool: 'delete_pages', state: 'pending' })
    expect(m.status).toBe('awaiting_confirmation')
  })

  it('declined tool results are marked declined; failures keep the message', () => {
    let m = newAssistant('a1')
    m = applyChatEvent(m, ev('tool_call', { id: 'c1', name: 'delete_pages', arguments: {} }))
    m = applyChatEvent(m, ev('tool_result', { id: 'c1', name: 'delete_pages', ok: false, declined: true, message: 'declined' }))
    expect(m.tools[0].status).toBe('declined')
    m = applyChatEvent(m, ev('tool_result', { id: 'c2', name: 'rotate_pdf', ok: false, message: 'angle must be 90, 180 or 270' }))
    expect(m.tools[1]).toMatchObject({ status: 'failed', message: 'angle must be 90, 180 or 270' })
  })

  it('error events become user-readable errors with the code kept', () => {
    const m = applyChatEvent(newAssistant('a1'), ev('error', { code: 'AI_KEY_INVALID', message: 'provider said 401', status: 401 }))
    expect(m.error?.code).toBe('AI_KEY_INVALID')
    expect(m.error?.message).toMatch(/key was rejected/i)
    expect(m.streaming).toBe(false)
  })
})

describe('feature stream reducer', () => {
  it('translate: page events start segments and tokens attach to the current page', () => {
    let s = initialStream
    for (const e of [ev('page', { page: 1, index: 1, total: 2 }), ev('token', { text: 'Hola' }), ev('page', { page: 2, index: 2, total: 2 }), ev('token', { text: 'Adiós' }), ev('done', { documents: [{ id: 'x' }] })]) s = reduceStream(s, e)
    expect(s.segments).toEqual([{ page: 1, text: 'Hola' }, { page: 2, text: 'Adiós' }])
    expect(s.status).toBe('done')
    expect(s.documents).toHaveLength(1)
  })

  it('compare: keeps the diff payload; summarize: progress events', () => {
    let s = reduceStream(initialStream, ev('diff', { identical: false, pages_a: 2, pages_b: 2, similarity: 0.9, summary: { added_lines: 1, removed_lines: 1, changed_blocks: 1, total_changes: 3 }, changes: [] }))
    expect(s.diff?.summary.total_changes).toBe(3)
    s = reduceStream(s, ev('progress', { stage: 'map', done: 2, total: 5 }))
    expect(s.progress).toEqual({ done: 2, total: 5 })
  })
})

// Regression (feature matrix): a 1-page PDF answered with "[p. 2]" used to render a clickable chip for a page that
// does not exist. Only pages inside the document become chips.
describe('citations of pages outside the document', () => {
  it('render as plain text, valid ones as chips', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { Markdown } = await import('./Markdown')
    const html = renderToStaticMarkup(createElement(Markdown, { text: 'See [p. 1] and [p. 2].', validPage: (c: { page: number }) => c.page <= 1 }))
    expect(html.match(/data-testid="citation-chip"/g)).toHaveLength(1)
    expect(html).toContain('data-page="1"')
    expect(html).not.toContain('data-page="2"')
    expect(html.replace(/<!-- -->/g, '')).toMatch(/data-testid="citation-invalid"[^>]*>p\. 2<\/span>/)
  })
})
