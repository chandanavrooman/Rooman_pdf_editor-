import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-4xl font-bold">Page not found</h1>
      <p className="mt-3 text-ink-600 dark:text-ink-300">That page does not exist.</p>
      <Link to="/tools" className="btn-primary mt-6">Back to all tools</Link>
    </div>
  )
}
