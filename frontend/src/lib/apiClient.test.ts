import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiJson, errorFromBody, friendlyMessage, messageForCode } from './apiClient'
import { _resetAuth, getAuth, setSession } from './auth'

afterEach(() => {
  vi.unstubAllGlobals()
  _resetAuth()
})

describe('error mapping', () => {
  it('maps {detail, code, ...extra} bodies to ApiError', () => {
    const e = errorFromBody(503, { detail: 'Ghostscript is not installed on the server. Install it: brew install ghostscript', code: 'EXTERNAL_TOOL_MISSING', tool: 'gs' })
    expect(e).toBeInstanceOf(ApiError)
    expect(e.status).toBe(503)
    expect(e.code).toBe('EXTERNAL_TOOL_MISSING')
    expect(e.extra).toEqual({ tool: 'gs' })
    expect(friendlyMessage(e)).toContain('brew install ghostscript')
  })

  it('falls back to status-based messages when the body is not ours', () => {
    expect(errorFromBody(413, null).message).toMatch(/too large/i)
    expect(errorFromBody(500, null).code).toBe('HTTP_500')
    expect(errorFromBody(0, null).message).toMatch(/reach the server/i)
  })

  it('has clear texts for every AI error code', () => {
    expect(messageForCode('AI_KEY_MISSING', '')).toBe('The server has no AI key configured: set AI_API_KEY in .env and restart the backend.')
    expect(messageForCode('AI_KEY_INVALID', '')).toMatch(/rejected/)
    expect(messageForCode('AI_RATE_LIMITED', '')).toMatch(/rate-limiting/)
    expect(messageForCode('AI_MODEL_NOT_FOUND', '')).toMatch(/AI_MODEL/)
    expect(messageForCode('NO_TEXT_LAYER', '')).toMatch(/OCR/)
    expect(messageForCode('SOMETHING_ELSE', 'raw message')).toBe('raw message')
  })

  it('turns network failures (TypeError from fetch) into a readable message', () => {
    expect(friendlyMessage(new TypeError('Failed to fetch'))).toMatch(/reach the server/i)
  })
})

describe('apiJson', () => {
  it('sends the bearer token and JSON body, returns parsed JSON', async () => {
    setSession('tok', { id: '1', email: 'a@b.c', name: null })
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    expect(await apiJson('/optimize/compress', { document_id: 'x' })).toEqual({ ok: 1 })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/optimize/compress')
    expect(init.method).toBe('POST')
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok')
    expect(init.body).toBe('{"document_id":"x"}')
  })

  it('401 on a normal endpoint logs out and opens the sign-in dialog', async () => {
    setSession('tok', { id: '1', email: 'a@b.c', name: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'expired', code: 'INVALID_TOKEN' }), { status: 401 })))
    await expect(apiJson('/documents')).rejects.toMatchObject({ code: 'INVALID_TOKEN', status: 401 })
    const a = getAuth()
    expect(a.token).toBeNull()
    expect(a.dialogOpen).toBe(true)
    expect(a.dialogReason).toMatch(/expired/i)
  })

  it('401 on /auth/login (wrong password) does not touch the dialog or session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Wrong email or password', code: 'INVALID_CREDENTIALS' }), { status: 401 })))
    await expect(apiJson('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(getAuth().dialogOpen).toBe(false)
  })

  it('maps a rejected fetch to a NETWORK_ERROR ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(apiJson('/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })
})
