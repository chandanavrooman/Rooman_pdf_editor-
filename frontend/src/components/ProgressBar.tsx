export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  return (
    <div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Processing progress" className="h-3 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-200 dark:bg-brand-400" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-center text-sm text-ink-600 dark:text-ink-300" aria-live="polite" data-testid="progress-label">
        {label} · {pct}%
      </p>
    </div>
  )
}
