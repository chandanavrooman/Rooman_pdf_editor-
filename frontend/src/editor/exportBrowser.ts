import regularUrl from '@/assets/fonts/NotoSans_400Regular.ttf?url'
import boldUrl from '@/assets/fonts/NotoSans_700Bold.ttf?url'
import italicUrl from '@/assets/fonts/NotoSans_400Regular_Italic.ttf?url'
import boldItalicUrl from '@/assets/fonts/NotoSans_700Bold_Italic.ttf?url'
import { exportEdited, type ExportOptions } from './export'
import type { FontBytesLoader, NotoVariant } from './fonts'
import { fetchFontBytes } from './fontCatalog'
import type { EditorDoc } from './types'

const URLS: Record<NotoVariant, string> = { regular: regularUrl, bold: boldUrl, italic: italicUrl, bolditalic: boldItalicUrl }

export const loadNotoFromNetwork: FontBytesLoader = async (v) => {
  const res = await fetch(URLS[v])
  if (!res.ok) throw new Error('Could not load the Unicode font.')
  return new Uint8Array(await res.arrayBuffer())
}

/** Export in the browser: pass a COPY of the original bytes (FileStore.getBytes gives one). */
export function exportInBrowser(original: Uint8Array, doc: EditorDoc, options?: ExportOptions) {
  return exportEdited(original, doc, options, { loadFontBytes: loadNotoFromNetwork, loadFont: fetchFontBytes })
}
