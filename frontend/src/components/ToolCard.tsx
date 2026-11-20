import { Link } from 'react-router-dom'
import { Cloud, Laptop } from 'lucide-react'
import type { ToolMeta } from '@/lib/tools'
import { ToolIcon } from './ToolIcon'

export function ToolCard({ tool, fileIds }: { tool: ToolMeta; fileIds?: string[] }) {
  const planned = tool.status !== 'available'
  return (
    <Link
      to={tool.route}
      state={fileIds && fileIds.length ? { fileIds } : undefined}
      data-testid={`tool-card-${tool.id}`}
      className="card group flex h-full flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-900/60 dark:text-brand-200">
          <ToolIcon name={tool.icon} className="h-5 w-5" />
        </span>
        {planned && <span className="chip bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300">Not available yet</span>}
      </div>
      <div className="flex-1">
        <h3 className="font-semibold">{tool.name}</h3>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{tool.description}</p>
      </div>
      {tool.runsIn === 'browser' ? (
        <span className="chip w-fit bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
          <Laptop className="h-3 w-3" aria-hidden="true" /> Runs in your browser
        </span>
      ) : (
        <span className="chip w-fit bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <Cloud className="h-3 w-3" aria-hidden="true" /> Uploads file to server
        </span>
      )}
    </Link>
  )
}
