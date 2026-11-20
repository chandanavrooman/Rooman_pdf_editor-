import { useId, useState, type FormEvent } from 'react'
import { Eye, EyeOff, LogIn, UserPlus } from 'lucide-react'
import { setSession, type AuthUser } from '@/lib/auth'
import { apiJson, friendlyMessage } from '@/lib/apiClient'
import { Notice } from './Notice'

interface AuthResponse {
  access_token: string
  expires_in: number
  user: AuthUser
}

export type AuthMode = 'login' | 'register'

/**
 * Sign-in / create-account form, shared by the /login and /signup pages and the in-tool sign-in dialog.
 * On success the session is stored (lib/auth) and `onSuccess` runs.
 */
export function AuthForm({ mode, onModeChange, onSuccess, reason, autoFocus = false }: {
  mode: AuthMode
  onModeChange: (m: AuthMode) => void
  onSuccess?: (user: AuthUser) => void
  reason?: string | null
  autoFocus?: boolean
}) {
  const ids = { name: useId(), email: useId(), password: useId() }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const switchMode = () => {
    onModeChange(mode === 'login' ? 'register' : 'login')
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    try {
      const body = mode === 'register' ? { email: email.trim(), password, name: name.trim() || undefined } : { email: email.trim(), password }
      const res = await apiJson<AuthResponse>(`/auth/${mode}`, body)
      setSession(res.access_token, res.user, res.expires_in)
      setPassword('')
      onSuccess?.(res.user)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const SubmitIcon = mode === 'login' ? LogIn : UserPlus
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {reason && <Notice kind="info">{reason}</Notice>}
      {mode === 'register' && (
        <div>
          <label className="label" htmlFor={ids.name}>Name <span className="font-normal text-ink-500">(optional)</span></label>
          <input id={ids.name} data-testid="auth-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      <div>
        <label className="label" htmlFor={ids.email}>Email</label>
        <input
          id={ids.email}
          data-testid="auth-email"
          className="input"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          autoFocus={autoFocus}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor={ids.password}>Password</label>
        <div className="relative">
          <input
            id={ids.password}
            data-testid="auth-password"
            className="input !pr-11"
            type={showPassword ? 'text' : 'password'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={mode === 'register' ? `${ids.password}-hint` : undefined}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-ink-500 hover:text-ink-800 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-ink-400 dark:hover:text-ink-100"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        {mode === 'register' && <p id={`${ids.password}-hint`} className="hint">At least 8 characters.</p>}
      </div>
      {error && (
        <Notice kind="error">
          <span data-testid="auth-error" role="alert">{error}</span>
        </Notice>
      )}
      <button type="submit" className="btn-primary w-full !py-2.5" disabled={busy || !email || !password} data-testid="auth-submit">
        <SubmitIcon className="h-4 w-4" aria-hidden="true" /> {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <p className="text-center text-sm text-ink-600 dark:text-ink-300">
        {mode === 'login' ? 'New to Rooman PDF?' : 'Already have an account?'}{' '}
        <button type="button" className="font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-300" onClick={switchMode} data-testid="auth-switch">
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </form>
  )
}
