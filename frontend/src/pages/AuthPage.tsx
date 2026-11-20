import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Clock, Lock, MonitorSmartphone, Sparkles } from 'lucide-react'
import { AuthForm, type AuthMode } from '@/components/AuthForm'
import { useAuth } from '@/lib/auth'
import { useCapabilities } from '@/hooks/useCapabilities'

/** Only same-app paths are allowed as a post-login destination (no open redirects). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login') || raw.startsWith('/signup')) return '/'
  return raw
}

/** Full-page sign-in (/login) and sign-up (/signup). After success it returns to `?next=` (default: all tools). */
export function AuthPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { user, localTest } = useAuth()
  const { caps } = useCapabilities()
  const ttl = caps?.limits.file_ttl_minutes

  useEffect(() => {
    document.title = `${mode === 'login' ? 'Sign in' : 'Create account'} · Rooman PDF`
  }, [mode])

  const switchMode = (m: AuthMode) => navigate({ pathname: m === 'login' ? '/login' : '/signup', search: params.toString() }, { replace: true })

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-[1fr_minmax(0,26rem)] md:items-center md:py-16" data-testid="auth-page">
      <section className="order-2 md:order-1">
        <p className="chip bg-brand-50 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Rooman PDF account
        </p>
        <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
          {mode === 'login' ? 'Welcome back.' : 'All your PDF tools, one account.'}
        </h2>
        <p className="mt-3 max-w-md text-ink-600 dark:text-ink-300">
          Sign in to use the tools that run on our server: compression, Word/Excel/PowerPoint conversion, OCR, protection and the AI assistant.
        </p>
        <ul className="mt-6 space-y-4">
          <li className="flex gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
            <span><strong>Private to you.</strong> Files you upload can only be opened with your account.</span>
          </li>
          <li className="flex gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
            <span><strong>Deleted automatically</strong> {ttl ? `${ttl} minutes after upload.` : 'shortly after processing.'}</span>
          </li>
          <li className="flex gap-3">
            <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
            <span><strong>No account needed</strong> for tools that run in your browser — merge, split, edit, sign and more.</span>
          </li>
        </ul>
      </section>

      <section className="card order-1 p-6 md:order-2 md:p-8" aria-labelledby="auth-page-title">
        {user ? (
          <div className="space-y-4 text-center" data-testid="auth-signed-in">
            <h1 id="auth-page-title" className="text-2xl font-bold">You're signed in</h1>
            <p className="text-ink-600 dark:text-ink-300">
              {localTest ? 'Local test mode is on (sign-in skipped).' : <>Signed in as <strong>{user.email}</strong>.</>}
            </p>
            <Link to={next} className="btn-primary w-full">
              Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <>
            <h1 id="auth-page-title" className="mb-1 text-2xl font-bold">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
            <p className="mb-6 text-sm text-ink-600 dark:text-ink-300">
              {mode === 'login' ? 'Use the email and password you registered with.' : 'Free. Takes a few seconds.'}
            </p>
            <AuthForm mode={mode} onModeChange={switchMode} onSuccess={() => navigate(next, { replace: true })} autoFocus />
          </>
        )}
      </section>
    </div>
  )
}
