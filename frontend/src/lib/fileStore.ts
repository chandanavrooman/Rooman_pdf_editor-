/**
 * FileStore — in-memory store for files the user has loaded.
 *
 * CONVENTION (app-wide): the stored ArrayBuffer is PRIVATE to this module.
 * Nothing outside may hold a reference to it. Consumers call `getBytes(id)`,
 * which ALWAYS returns a fresh copy, so pdf.js / pdf-lib / workers can
 * transfer or detach it without ever affecting the stored original.
 * Never add an API that returns the internal buffer.
 */

export interface StoredFileMeta {
  id: string
  name: string
  size: number
  mime: string
  /** 'pdf' = verified %PDF magic bytes. 'other' = any other file (docx, images…). */
  kind: 'pdf' | 'other'
  addedAt: number
}

interface Entry extends StoredFileMeta {
  buffer: ArrayBuffer
}

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let snapshot: StoredFileMeta[] = []
let counter = 0

function emit() {
  snapshot = [...entries.values()].map(toMeta)
  listeners.forEach((l) => l())
}

function toMeta(e: Entry): StoredFileMeta {
  const { id, name, size, mime, kind, addedAt } = e
  return { id, name, size, mime, kind, addedAt }
}

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

/** True when the bytes start with "%PDF-" (allowing leading whitespace/BOM junk up to 1024 bytes, as readers do). */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 4, 1024)
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true
  }
  return false
}

function nextId(): string {
  counter += 1
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `f${counter}-${rnd}`
}

export interface AddOptions {
  /** Require PDF magic bytes (default true). Pass false for docx/xlsx/images etc. */
  pdf?: boolean
  mime?: string
}

/** Store a COPY of the given bytes. The caller's buffer is never retained. */
export function addBytes(name: string, bytes: Uint8Array | ArrayBuffer, opts: AddOptions = {}): StoredFileMeta {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const requirePdf = opts.pdf ?? true
  if (requirePdf && !hasPdfMagic(view)) {
    throw new FileValidationError(`"${name}" is not a valid PDF (missing %PDF header).`)
  }
  if (view.byteLength === 0) throw new FileValidationError(`"${name}" is empty.`)
  // Copy into a brand-new ArrayBuffer owned by the store.
  const buffer = new ArrayBuffer(view.byteLength)
  new Uint8Array(buffer).set(view)
  const entry: Entry = {
    id: nextId(),
    name,
    size: view.byteLength,
    mime: opts.mime ?? (requirePdf ? 'application/pdf' : 'application/octet-stream'),
    kind: requirePdf ? 'pdf' : 'other',
    addedAt: Date.now(),
    buffer,
  }
  entries.set(entry.id, entry)
  emit()
  return toMeta(entry)
}

export async function addFile(file: File, opts: AddOptions = {}): Promise<StoredFileMeta> {
  const buf = await file.arrayBuffer()
  return addBytes(file.name, new Uint8Array(buf), { mime: file.type || undefined, ...opts })
}

/** Returns a FRESH copy of the stored bytes every call. Safe to transfer/detach. */
export function getBytes(id: string): Uint8Array {
  const e = entries.get(id)
  if (!e) throw new Error(`File ${id} is no longer available. Please upload it again.`)
  return new Uint8Array(e.buffer.slice(0))
}

export function getMeta(id: string): StoredFileMeta | undefined {
  const e = entries.get(id)
  return e ? toMeta(e) : undefined
}

export function hasFile(id: string): boolean {
  return entries.has(id)
}

export function removeFile(id: string): void {
  if (entries.delete(id)) emit()
}

export function clearAll(): void {
  entries.clear()
  emit()
}

export function listFiles(): StoredFileMeta[] {
  return snapshot
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Test helper: byteLength of the internal buffer (a detached buffer reports 0). */
export function _internalByteLength(id: string): number {
  return entries.get(id)?.buffer.byteLength ?? -1
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
