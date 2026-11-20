import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { FlaskConical, LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { logout, useAuth } from '@/lib/auth'
import { forgetAllServerDocuments } from '@/lib/serverDocs'
import { useCapabilities } from '@/hooks/useCapabilities'
import { TOOLS } from '@/lib/tools'
import { AuthDialog } from './AuthDialog'
import { Logo } from './Logo'
import { ToolsMenu } from './ToolsMenu'
import { ThemeToggle } from './ThemeToggle'

/** The shortcuts next to the Tools menu. */
const QUICK = [
  { label: 'Compress', to: '/compress-pdf' },
  { label: 'Convert', to: '/pdf-to-word' },
  { label: 'Merge', to: '/merge-pdf' },
  { label: 'Edit', to: '/edit' },
  { label: 'Sign', to: '/sign-pdf' },
  { label: 'AI PDF', to: '/ai-assistant' },
]

export function Layout() {
  const { user, localTest } = useAuth()
  const { pathname } = useLocation()
  // Only pages of server tools (incl. AI) talk to the backend; browser-only pages never do.
  // On those pages the capabilities fetch also starts the local test session when the backend has LOCAL_TEST_MODE on.
  useCapabilities(TOOLS.some((t) => t.runsIn === 'server' && t.route === pathname))
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-ink-900 focus:shadow-lg">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/85 backdrop-blur dark:border-ink-800 dark:bg-ink-950/85">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-5">
            <Link to="/" aria-label="Rooman PDF home" className="whitespace-nowrap rounded-lg">
              <Logo />
            </Link>
            <ToolsMenu />
            <nav aria-label="Popular tools" className="hidden items-center gap-1 md:flex">
              {QUICK.map((q) => (
                <NavLink key={q.to} to={q.to} className={({ isActive }) => `rounded-lg px-2.5 py-2 text-sm font-medium transition hover:bg-ink-100 dark:hover:bg-ink-800 ${isActive ? 'text-brand-700 dark:text-brand-300' : 'text-ink-800 dark:text-ink-100'}`}>
                  {q.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <nav aria-label="Account" className="flex items-center gap-1">
            <span className="chip hidden bg-brand-50 text-brand-800 xl:inline-flex dark:bg-brand-900/50 dark:text-brand-200">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Most tools run in your browser
            </span>
            {user && localTest ? (
              <span
                className="chip bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                title="LOCAL_TEST_MODE is on in .env: sign-in is skipped. Development only."
                data-testid="local-test-badge"
              >
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Local test mode
              </span>
            ) : user ? (
              <span className="flex items-center gap-1" data-testid="user-menu">
                <span className="chip hidden max-w-[12rem] truncate bg-ink-100 text-ink-700 sm:inline-flex dark:bg-ink-800 dark:text-ink-200" title={user.email}>
                  <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> {user.name || user.email}
                </span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { logout(); forgetAllServerDocuments() }} data-testid="logout">
                  <LogOut className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Sign out</span>
                </button>
              </span>
            ) : (
              pathname !== '/login' && pathname !== '/signup' && (
                <Link to={`/login${pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`}`} className="btn-secondary btn-sm" aria-label="Sign in" data-testid="sign-in">
                  <LogIn className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Sign in</span>
                </Link>
              )
            )}
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <AuthDialog />
      <main id="main" className="flex-1" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="border-t border-ink-200 py-6 text-center text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
        © {new Date().getFullYear()} Rooman PDF. Browser tools keep your files on this device; server tools say so before you upload.
      </footer>
    </div>
  )
}
