import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { closeAuthDialog, useAuth } from '@/lib/auth'
import { AuthForm, type AuthMode } from './AuthForm'

/**
 * In-place sign-in / create-account modal (native <dialog>: focus trap, Esc to close), opened via openAuthDialog() —
 * e.g. from a server tool, so the user keeps their uploaded file and options. The header links to the /login page instead.
 */
export function AuthDialog() {
  const { dialogOpen, dialogReason } = useAuth()
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<AuthMode>('login')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (dialogOpen && !d.open) d.showModal()
    if (!dialogOpen && d.open) d.close()
  }, [dialogOpen])

  return (
    <dialog
      ref={ref}
      aria-labelledby="auth-title"
      onClose={() => dialogOpen && closeAuthDialog()}
      onClick={(e) => e.target === ref.current && closeAuthDialog()}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-ink-200 bg-white p-0 text-ink-900 shadow-2xl backdrop:bg-ink-950/60 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
      data-testid="auth-dialog"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="auth-title" className="text-xl font-bold">
            {mode === 'login' ? 'Sign in' : 'Create your account'}
          </h2>
          <button type="button" className="btn-ghost btn-sm !px-2" onClick={closeAuthDialog} aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-xs text-ink-500 dark:text-ink-400">
          An account is only needed for tools that process files on the server. Browser-side tools never need one.
        </p>
        {dialogOpen && <AuthForm mode={mode} onModeChange={setMode} reason={dialogReason} />}
      </div>
    </dialog>
  )
}
