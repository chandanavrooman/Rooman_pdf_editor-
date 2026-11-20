import { zipSync } from 'fflate'
import type { OpFile } from './common'

/** Build a zip. PDFs are already compressed, so entries are stored (level 0). Duplicate names are de-duplicated. */
export function zipFiles(files: OpFile[]): Uint8Array {
  const data: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  for (const f of files) {
    let name = f.name
    let i = 2
    while (used.has(name)) {
      const dot = f.name.lastIndexOf('.')
      name = dot > 0 ? `${f.name.slice(0, dot)} (${i})${f.name.slice(dot)}` : `${f.name} (${i})`
      i++
    }
    used.add(name)
    data[name] = f.bytes.slice(0)
  }
  return zipSync(data, { level: 0 })
}
