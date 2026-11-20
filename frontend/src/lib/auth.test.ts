import { beforeEach, describe, expect, it, vi } from 'vitest'

// node has no sessionStorage: provide a tiny one before the module loads
function installStorage(initial?: Record<string, string>) {
  const data = new Map(Object.entries(initial ?? {}))
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) })
  return data
}

describe('auth store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('keeps the session in memory and mirrors it to sessionStorage', async () => {
    const data = installStorage()
    const auth = await import('./auth')
    expect(auth.isAuthenticated()).toBe(false)
    auth.setSession('tok', { id: '1', email: 'a@b.c', name: 'A' }, 3600)
    expect(auth.getToken()).toBe('tok')
    expect(JSON.parse(data.get('rooman.auth.v1')!).user.email).toBe('a@b.c')
    auth.logout()
    expect(auth.getToken()).toBeNull()
    expect(data.has('rooman.auth.v1')).toBe(false)
  })

  it('restores a valid session after a reload and drops an expired one', async () => {
    installStorage({ 'rooman.auth.v1': JSON.stringify({ token: 't', user: { id: '1', email: 'x@y.z', name: null }, expiresAt: Date.now() + 60_000 }) })
    const a = await import('./auth')
    expect(a.getAuth().user?.email).toBe('x@y.z')

    vi.resetModules()
    installStorage({ 'rooman.auth.v1': JSON.stringify({ token: 't', user: { id: '1', email: 'x@y.z', name: null }, expiresAt: Date.now() - 1000 }) })
    const b = await import('./auth')
    expect(b.getToken()).toBeNull()
  })

  it('works without storage (blocked/private mode) and notifies subscribers', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    const auth = await import('./auth')
    const seen = vi.fn()
    const off = auth.subscribeAuth(seen)
    auth.setSession('tok', { id: '1', email: 'a@b.c', name: null })
    expect(auth.getToken()).toBe('tok')
    auth.openAuthDialog('why')
    expect(auth.getAuth()).toMatchObject({ dialogOpen: true, dialogReason: 'why' })
    auth.closeAuthDialog()
    off()
    const calls = seen.mock.calls.length
    auth.logout()
    expect(seen.mock.calls.length).toBe(calls)
  })

  it('signing in closes the dialog', async () => {
    installStorage()
    const auth = await import('./auth')
    auth.openAuthDialog('x')
    auth.setSession('t', { id: '1', email: 'a@b.c', name: null })
    expect(auth.getAuth().dialogOpen).toBe(false)
  })
})
