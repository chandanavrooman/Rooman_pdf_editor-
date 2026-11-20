export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-brand-600 dark:fill-brand-400" />
      <path d="M10 6.5h8.2L24 12.3V25a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 9 25V8a1.5 1.5 0 0 1 1-1.5z" fill="#fff" />
      <path d="M18.2 6.5v5.1a.7.7 0 0 0 .7.7H24z" fill="#a9e9de" />
      <path d="M12.5 17.5h7M12.5 21h7" stroke="#167e77" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="23.5" cy="23.5" r="3.2" fill="#ffb454" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">
        Rooman <span className="text-brand-600 dark:text-brand-300">PDF</span>
      </span>
    </span>
  )
}
