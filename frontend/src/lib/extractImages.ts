import { pdfjs, loadPdfFromBytes } from '@/lib/pdfjs'

export interface FoundImage {
  /** 1-based */
  page: number
  index: number
  width: number
  height: number
  png: Uint8Array
}

export interface ExtractOptions {
  /** skip pictures smaller than this on both sides (icons, bullets, rules): pixels */
  minSize: number
}

export type RawImage = { width: number; height: number; kind?: number; data?: Uint8ClampedArray | Uint8Array; bitmap?: ImageBitmap }

export function getObj(page: { objs: { get: (id: string, cb: (v: unknown) => void) => void; has: (id: string) => boolean }; commonObjs: { get: (id: string, cb: (v: unknown) => void) => void; has: (id: string) => boolean } }, id: string): Promise<RawImage | null> {
  return new Promise((resolve) => {
    const store = id.startsWith('g_') ? page.commonObjs : page.objs
    const timer = setTimeout(() => resolve(null), 4000)
    try {
      store.get(id, (v) => {
        clearTimeout(timer)
        resolve((v as RawImage) ?? null)
      })
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

export async function toPng(img: RawImage): Promise<Uint8Array | null> {
  const { width, height } = img
  if (!width || !height) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0)
  else if (img.data) {
    const rgba = new Uint8ClampedArray(width * height * 4)
    const src = img.data
    if (img.kind === pdfjs.ImageKind.RGBA_32BPP || src.length === width * height * 4) rgba.set(src.subarray(0, rgba.length))
    else if (img.kind === pdfjs.ImageKind.RGB_24BPP || src.length === width * height * 3) {
      for (let i = 0, j = 0; i < width * height; i++, j += 3) {
        rgba[i * 4] = src[j]
        rgba[i * 4 + 1] = src[j + 1]
        rgba[i * 4 + 2] = src[j + 2]
        rgba[i * 4 + 3] = 255
      }
    } else {
      // 1 bit per pixel, rows padded to whole bytes
      const stride = (width + 7) >> 3
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const on = (src[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0
          const o = (y * width + x) * 4
          rgba[o] = rgba[o + 1] = rgba[o + 2] = on
          rgba[o + 3] = 255
        }
    }
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  } else return null
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** Every picture painted in the PDF, as PNG, in page order. The same picture used twice on a page is returned once. */
export async function extractImages(bytes: Uint8Array, opts: ExtractOptions, onProgress: (f: number) => void): Promise<FoundImage[]> {
  const task = loadPdfFromBytes(bytes)
  try {
    const doc = await task.promise
    const out: FoundImage[] = []
    const seen = new Set<string>()
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const ol = await page.getOperatorList()
      let idx = 0
      for (let i = 0; i < ol.fnArray.length; i++) {
        if (ol.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue
        const id = (ol.argsArray[i] as unknown[])[0] as string
        if (seen.has(id)) continue
        seen.add(id)
        const raw = await getObj(page as never, id)
        if (!raw || (raw.width < opts.minSize && raw.height < opts.minSize)) continue
        const png = await toPng(raw)
        if (png) out.push({ page: n, index: ++idx, width: raw.width, height: raw.height, png })
      }
      onProgress(n / doc.numPages)
    }
    return out
  } finally {
    await task.destroy()
  }
}
