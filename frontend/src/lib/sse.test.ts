import { afterEach, describe, expect, it, vi } from 'vitest'
import { SseParser, streamSse } from './sse'
import { _resetAuth, setSession } from './auth'
import { ApiError } from './apiClient'

const FRAMES =
  'event: meta\ndata: {"model":"m"}\n\n' + ': ping\n\n' + 'event: token\ndata: {"text":"Héllo "}\n\n' + 'event: token\ndata: {"text":"wörld"}\n\n' + 'event: done\ndata: {"status":"complete"}\n\n'

describe('SseParser', () => {
  it('parses multiple events delivered in one chunk and ignores comment pings', () => {
    const evs = new SseParser().push(FRAMES)
    expect(evs.map((e) => e.event)).toEqual(['meta', 'token', 'token', 'done'])
    expect(evs[1].data).toEqual({ text: 'Héllo ' })
  })

  it('gives identical results no matter where the stream is cut (every split point)', () => {
    const whole = new SseParser().push(FRAMES).map((e) => [e.event, e.data])
    for (let i = 1; i < FRAMES.length; i++) {
      const p = new SseParser()
      const got = [...p.push(FRAMES.slice(0, i)), ...p.push(FRAMES.slice(i))].map((e) => [e.event, e.data])
      expect(got).toEqual(whole)
    }
  })

  it('handles one-character chunks and CRLF line endings', () => {
    const p = new SseParser()
    const out = [...FRAMES.replace(/\n/g, '\r\n')].flatMap((c) => p.push(c))
    expect(out.map((e) => e.event)).toEqual(['meta', 'token', 'token', 'done'])
  })

  it('joins multi-line data fields and keeps non-JSON data as a string', () => {
    const [a, b] = new SseParser().push('data: line1\ndata: line2\n\nevent: x\ndata: {"a":1}\n\n')
    expect(a.event).toBe('message')
    expect(a.data).toBe('line1\nline2')
    expect(b.data).toEqual({ a: 1 })
  })

  it('delivers error events like any other event', () => {
    const [e] = new SseParser().push('event: error\ndata: {"code":"AI_KEY_INVALID","message":"bad key","status":401}\n\n')
    expect(e.event).toBe('error')
    expect(e.data).toEqual({ code: 'AI_KEY_INVALID', message: 'bad key', status: 401 })
  })

  it('flushes a trailing frame without the final blank line on end()', () => {
    const p = new SseParser()
    expect(p.push('event: done\ndata: {"ok":true}\n')).toEqual([])
    expect(p.end()[0].data).toEqual({ ok: true })
  })
})

describe('streamSse', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    _resetAuth()
  })

  const streamOf = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder()
        chunks.forEach((x) => c.enqueue(enc.encode(x)))
        c.close()
      },
    })

  it('streams events from a fetch response with the bearer token, even when a UTF-8 character is split', async () => {
    setSession('tok123', { id: '1', email: 'a@b.c', name: null })
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"é"}\n\n')
    const cut = bytes.indexOf(0xc3) + 1 // split in the middle of the 2-byte character
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, cut))
        c.enqueue(bytes.slice(cut))
        c.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const seen: unknown[] = []
    await streamSse('/ai/chat', { x: 1 }, { onEvent: (e) => seen.push(e.data) })
    expect(seen).toEqual([{ text: 'é' }])
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok123')
    expect(init.method).toBe('POST')
  })

  it('throws ApiError for HTTP errors raised before the stream starts (AI_KEY_MISSING)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'no key', code: 'AI_KEY_MISSING' }), { status: 503 })))
    await expect(streamSse('/ai/chat', {}, { onEvent: () => {} })).rejects.toMatchObject({ name: 'ApiError', status: 503, code: 'AI_KEY_MISSING' })
  })

  it('reads a stream split across arbitrary network chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(streamOf(['event: tok', 'en\ndata: {"text":"a"}\n', '\nevent: done\ndata: {}\n\n']), { status: 200 })))
    const names: string[] = []
    await streamSse('/x', {}, { onEvent: (e) => names.push(e.event) })
    expect(names).toEqual(['token', 'done'])
  })

  it('signs the user out on 401', async () => {
    setSession('old', { id: '1', email: 'a@b.c', name: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'x', code: 'INVALID_TOKEN' }), { status: 401 })))
    const err = await streamSse('/ai/chat', {}, { onEvent: () => {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    const { getToken } = await import('./auth')
    expect(getToken()).toBeNull()
  })
})
