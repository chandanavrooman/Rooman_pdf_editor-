import { useId, useRef, useState, type DragEvent } from 'react'
import { FileUp } from 'lucide-react'

export interface DropzoneProps {
  onFiles: (files: File[]) => void
  multiple?: boolean
  /** file input accept attribute */
  accept?: string
  title?: string
  hint?: string
  compact?: boolean
  disabled?: boolean
}

export function Dropzone({ onFiles, multiple = false, accept = 'application/pdf,.pdf', title, hint, compact, disabled }: DropzoneProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const handle = (list: FileList | null) => {
    if (!list || !list.length) return
    onFiles(Array.from(list))
    if (input.current) input.current.value = '' // allow picking the same file again
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (!disabled) handle(e.dataTransfer.files)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`relative rounded-2xl border-2 border-dashed text-center transition ${compact ? 'p-5' : 'p-10 sm:p-14'} ${
        over ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-ink-300 bg-white hover:border-brand-400 dark:border-ink-700 dark:bg-ink-900'
      } focus-within:ring-2 focus-within:ring-brand-500`}
    >
      <input ref={input} id={id} type="file" accept={accept} multiple={multiple} disabled={disabled} className="sr-only" data-testid="file-input" onChange={(e) => handle(e.target.files)} />
      <FileUp className={`mx-auto text-brand-600 dark:text-brand-300 ${compact ? 'h-7 w-7' : 'h-10 w-10'}`} aria-hidden="true" />
      <p className={`mt-3 font-semibold ${compact ? 'text-sm' : 'text-lg'}`}>{title ?? (multiple ? 'Drop your PDF files here' : 'Drop your PDF here')}</p>
      <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{hint ?? 'or choose from your device'}</p>
      <label htmlFor={id} className="btn-primary mt-4 cursor-pointer">
        {multiple ? 'Select files' : 'Select file'}
      </label>
    </div>
  )
}
