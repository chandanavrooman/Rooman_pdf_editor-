import { Suspense } from 'react'
import { Link } from 'react-router-dom'
import { Hammer, Loader2 } from 'lucide-react'
import type { ToolMeta } from '@/lib/tools'
import { toolComponents } from '@/tools'
import { ToolIcon } from '@/components/ToolIcon'

export function NotAvailable({ tool }: { tool: ToolMeta }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
        <ToolIcon name={tool.icon} className="h-7 w-7" />
      </span>
      <h1 className="mt-5 text-3xl font-bold tracking-tight">{tool.name}</h1>
      <p className="mt-2 text-ink-600 dark:text-ink-300">{tool.description}</p>
      <div className="card mt-8 flex items-center justify-center gap-3 p-6 text-left" role="status" data-testid="not-available">
        <Hammer className="h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />
        <p className="text-sm">
          <strong>Not available yet.</strong> This tool is planned but has not been built, so it is not usable today
          {tool.runsIn === 'server' ? ' (it will process files on the Rooman PDF server).' : '.'}
        </p>
      </div>
      <Link to="/tools" className="btn-primary mt-8">
        Browse available tools
      </Link>
    </div>
  )
}

export function ToolRoute({ tool }: { tool: ToolMeta }) {
  const Component = toolComponents[tool.id]
  if (tool.status !== 'available' || !Component) return <NotAvailable tool={tool} />
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-20" role="status" aria-label="Loading tool">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      }
    >
      <Component key={tool.id} tool={tool} />
    </Suspense>
  )
}
