import type { ReactNode } from 'react'
import { AlertTriangle, CircleAlert, Info, ShieldCheck } from 'lucide-react'

const STYLES = {
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-100',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100',
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100',
  privacy: 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100',
} as const

export function Notice({ kind = 'info', children, title }: { kind?: keyof typeof STYLES; children: ReactNode; title?: string }) {
  const Icon = kind === 'error' ? CircleAlert : kind === 'warn' ? AlertTriangle : kind === 'privacy' ? ShieldCheck : Info
  return (
    <div role={kind === 'error' ? 'alert' : 'note'} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${STYLES[kind]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  )
}
