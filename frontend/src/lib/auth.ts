/**
 * Auth store: the JWT lives in memory and is mirrored to sessionStorage so a page reload keeps you signed in.
 *
 * TRADEOFF (deliberate): sessionStorage is readable by any script that runs on our origin (XSS), whereas an httpOnly cookie
 * is not. We chose a bearer token because the API is a separate origin in production (CORS, no cookies/CSRF handling) and
 * because sessionStorage — unlike localStorage — is cleared when the tab closes and is never shared with other tabs.
 * The app renders no unsanitised HTML (React escapes everything; the AI chat renders its own safe markdown subset), which
 * is the mitigation for the XSS risk. Tokens are short-lived (TOKEN_EXPIRE_MINUTES) and a 401 signs the user out.
 */
import { useSyncExternalStore } from 'react'

export interface AuthUser {
  id: string
  email: string
  name: string | null
}

export interface AuthState {
  token: string | null
  user: AuthUser | null
  expiresAt: number | null
  /** true when the session came from the backend's LOCAL_TEST_MODE (sign-in skipped for local testing) */
  localTest: boolean
  dialogOpen: boolean
  dialogReason: string | null
}

const KEY = 'rooman.auth.v1'

const EMPTY = { token: null, user: null, expiresAt: null, localTest: false }

function load(): Pick<AuthState, 'token' | 'user' | 'expiresAt' | 'localTest'> {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return EMPTY
    const v = JSON.parse(raw) as { token?: string; user?: AuthUser; expiresAt?: number; localTest?: boolean }
    if (!v.token || !v.user || (v.expiresAt && v.expiresAt < Date.now())) return EMPTY
    return { token: v.token, user: v.user, expiresAt: v.expiresAt ?? null, localTest: !!v.localTest }
  } catch {
    return EMPTY
  }
}

let state: AuthState = { ...load(), dialogOpen: false, dialogReason: null }
const listeners = new Set<() => void>()

function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function persist() {
  try {
    if (state.token && state.user) sessionStorage.setItem(KEY, JSON.stringify({ token: state.token, user: state.user, expiresAt: state.expiresAt, localTest: state.localTest }))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* storage blocked: the in-memory session still works */
  }
}

export function getAuth(): AuthState {
  return state
}
export function getToken(): string | null {
  return state.token
}
export function isAuthenticated(): boolean {
  return !!state.token
}

export function setSession(token: string, user: AuthUser, expiresInSeconds?: number, opts: { localTest?: boolean } = {}): void {
  set({ token, user, expiresAt: expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : null, localTest: !!opts.localTest, dialogOpen: false, dialogReason: null })
  persist()
}

export function logout(): void {
  set({ ...EMPTY })
  persist()
}

export function openAuthDialog(reason: string | null = null): void {
  set({ dialogOpen: true, dialogReason: reason })
}
export function closeAuthDialog(): void {
  set({ dialogOpen: false, dialogReason: null })
}

export function subscribeAuth(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribeAuth, getAuth, getAuth)
}

/** Test helper: reset the store (and storage). */
export function _resetAuth(): void {
  state = { ...EMPTY, dialogOpen: false, dialogReason: null }
  persist()
  listeners.forEach((l) => l())
}
