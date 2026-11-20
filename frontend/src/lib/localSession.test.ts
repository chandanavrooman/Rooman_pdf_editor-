import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiJson, startLocalSession } from './apiClient'
import { _resetAuth, getAuth } from './auth'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const session = (token: string) => ({ access_token: token, token_type: 'bearer', expires_in: 3600, user: { id: 'u1', email: 'local-test@rooman.local', name: 'Local tester' } })

afterEach(() => {
  vi.unstubAllGlobals()
  _resetAuth()
})

describe('local test mode (backend LOCAL_TEST_MODE)', () => {
  it('returns false and stays signed out when the backend does not offer it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'Not found', code: 'NOT_FOUND' }, 404)))
    expect(await startLocalSession()).toBe(false)
    expect(getAuth().token).toBeNull()
    expect(getAuth().localTest).toBe(false)
  })

  it('gets a session without sign-in and marks it as a local test session', async () => {
    const f = vi.fn().mockResolvedValue(json(session('local-1')))
    vi.stubGlobal('fetch', f)
    expect(await startLocalSession()).toBe(true)
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/local-session')
    expect(init.method).toBe('POST')
    expect(getAuth()).toMatchObject({ token: 'local-1', localTest: true, dialogOpen: false })
  })

  it('a 401 in local test mode silently renews the session instead of opening the sign-in dialog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(session('old'))))
    await startLocalSession()
    const f = vi.fn()
      .mockResolvedValueOnce(json({ detail: 'expired', code: 'INVALID_TOKEN' }, 401))
      .mockResolvedValueOnce(json(session('new')))
    vi.stubGlobal('fetch', f)
    await expect(apiJson('/documents')).rejects.toMatchObject({ status: 401 })
    await vi.waitFor(() => expect(getAuth().token).toBe('new'))
    expect(getAuth().dialogOpen).toBe(false)
    expect((f.mock.calls[1] as [string])[0]).toBe('/api/auth/local-session')
  })
})
