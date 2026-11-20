import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, LayoutGrid } from 'lucide-react'
import { CATEGORIES, TOOLS, type ToolCategory } from '@/lib/tools'
import { ToolIcon } from './ToolIcon'

/** A coloured tile per category, so the columns are easy to tell apart at a glance. */
const TILE: Record<ToolCategory, string> = {
  organize: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200',
  edit: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200',
  'from-pdf': 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
  'to-pdf': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
  optimize: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  security: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  sign: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-200',
  ai: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
}

const DOT: Record<ToolCategory, string> = {
  organize: 'bg-violet-400',
  edit: 'bg-teal-400',
  'from-pdf': 'bg-sky-400',
  'to-pdf': 'bg-orange-400',
  optimize: 'bg-emerald-400',
  security: 'bg-amber-400',
  sign: 'bg-pink-400',
  ai: 'bg-indigo-400',
}

/**
 * How the categories are packed into columns so the panel stays short: Organize (the longest list) gets a double-width
 * column of its own, the small categories share the others. A category missing here still shows, in an extra column.
 */
const COLUMNS: ToolCategory[][] = [['organize'], ['edit', 'from-pdf'], ['to-pdf', 'security'], ['optimize', 'sign'], ['ai']]

/**
 * "Tools" button + a full-width panel listing every available tool by category. It is generated from the tool registry,
 * so a tool added there shows up here with no further work. Closes on Escape, on a click outside, and when a tool is chosen.
 */
export function ToolsMenu() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const { pathname } = useLocation()

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = CATEGORIES.map((c) => ({ ...c, tools: TOOLS.filter((t) => t.category === c.id && t.status === 'available') })).filter((g) => g.tools.length)

  const byId = new Map(groups.map((g) => [g.id, g]))
  const placed = new Set(COLUMNS.flat())
  const columns = [...COLUMNS.map((c) => c.map((id) => byId.get(id)).filter((g): g is NonNullable<typeof g> => !!g)), ...groups.filter((g) => !placed.has(g.id)).map((g) => [g])].filter((c) => c.length)

  return (
    <div ref={root}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="tools-menu"
        data-testid="tools-menu-button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition ${
          open ? 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-100' : 'border-ink-200 bg-white text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800'
        }`}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        Tools
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id="tools-menu" data-testid="tools-menu" className="pointer-events-none absolute inset-x-0 top-full px-3 pt-2">
          <div className="pointer-events-auto mx-auto max-h-[calc(100vh-5rem)] max-w-7xl overflow-y-auto rounded-3xl border border-ink-200 bg-white p-5 shadow-2xl ring-1 ring-black/5 dark:border-ink-700 dark:bg-ink-900 dark:ring-white/5">
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3 lg:grid-cols-6">
              {columns.map((col, ci) => (
                <div key={ci} className={`flex flex-col gap-4 ${col.some((g) => g.id === 'organize') ? 'col-span-2' : ''}`}>
                  {col.map((g) => (
                    <section key={g.id} aria-label={g.label}>
                      <h2 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                        <span className={`h-2 w-2 rounded-full ${DOT[g.id]}`} aria-hidden="true" />
                        {g.label}
                      </h2>
                      <ul className={g.id === 'organize' ? 'grid grid-cols-2 gap-x-3' : ''}>
                        {g.tools.map((t) => (
                          <li key={t.id}>
                            <Link to={t.route} data-testid={`menu-${t.id}`} className="group flex items-center gap-2 rounded-xl px-1.5 py-[3px] text-[13px] text-ink-800 transition hover:bg-ink-100 dark:text-ink-100 dark:hover:bg-ink-800">
                              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition group-hover:scale-110 ${TILE[g.id]}`}>
                                <ToolIcon name={t.icon} className="h-3.5 w-3.5" />
                              </span>
                              <span className="leading-tight">{t.name}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
              <span>{groups.reduce((n, g) => n + g.tools.length, 0)} tools · most run privately in your browser</span>
              <Link to="/tools" data-testid="menu-all-tools" className="rounded-full bg-brand-50 px-3 py-1 font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-200">
                See all tools →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
