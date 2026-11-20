export function downloadBytes(name: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes.slice(0) as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}
