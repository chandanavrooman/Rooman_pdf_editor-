import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { ToolCard } from '@/components/ToolCard'
import { CATEGORIES, TOOLS, searchTools, type ToolCategory } from '@/lib/tools'

export function Home() {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<ToolCategory | 'all'>('all')

  const filtered = useMemo(() => {
    const found = searchTools(query)
    return cat === 'all' ? found : found.filter((t) => t.category === cat)
  }, [query, cat])

  return (
    <>
      <section id="tools" className="mx-auto max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="tools-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 id="tools-heading" className="text-3xl font-extrabold tracking-tight">All tools</h1>
            <p className="text-sm text-ink-600 dark:text-ink-300">{TOOLS.filter((t) => t.status === 'available').length} ready to use{TOOLS.some((t) => t.status !== 'available') ? ` · ${TOOLS.filter((t) => t.status !== 'available').length} coming soon` : ''}</p>
          </div>
          <div className="relative w-full sm:w-80">
            <label htmlFor="tool-search" className="sr-only">Search tools</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input id="tool-search" type="search" className="input !pl-9" placeholder="Search tools…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="tool-search" />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {[{ id: 'all' as const, label: 'All' }, ...CATEGORIES].map((c) => (
            <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${cat === c.id ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-400 dark:bg-brand-400 dark:text-ink-950' : 'border-ink-200 bg-white hover:border-brand-400 dark:border-ink-700 dark:bg-ink-900'}`}>
              {c.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="mt-10 text-center text-ink-500" role="status">No tools match “{query}”.</p>
        ) : (
          CATEGORIES.map((c) => {
            const list = filtered.filter((t) => t.category === c.id)
            if (!list.length) return null
            return (
              <div key={c.id} className="mt-10" data-testid={`category-${c.id}`}>
                <h3 className="text-lg font-bold">{c.label}</h3>
                <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">{c.blurb}</p>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {list.map((t) => (
                    <li key={t.id}>
                      <ToolCard tool={t} />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })
        )}
      </section>
    </>
  )
}
