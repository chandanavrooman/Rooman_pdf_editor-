/** Helpers for creating signature images (draw / type / upload) and remembering them in this browser. */

export const SIGNATURE_FONTS = [
  { id: 'dancing', label: 'Flowing', family: '"Dancing Script", cursive' },
  { id: 'caveat', label: 'Handwritten', family: '"Caveat", cursive' },
  { id: 'apple', label: 'Casual', family: '"Homemade Apple", cursive' },
] as const

const STORE_KEY = 'rooman-pdf.signatures'

export function loadSavedSignatures(): string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && x.startsWith('data:image/png')).slice(0, 4) : []
  } catch {
    return []
  }
}
export function saveSignature(dataUrl: string): void {
  try {
    const list = [dataUrl, ...loadSavedSignatures().filter((x) => x !== dataUrl)].slice(0, 4)
    localStorage.setItem(STORE_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable (private mode…): signatures just are not remembered */
  }
}
export function forgetSignature(dataUrl: string): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(loadSavedSignatures().filter((x) => x !== dataUrl)))
  } catch {
    /* ignore */
  }
}

/** Crop transparent margins of a canvas, with a small padding. Returns null when the canvas is empty. */
export function trimCanvas(src: HTMLCanvasElement, pad = 4): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')
  if (!ctx) return null
  const { width, height } = src
  const data = ctx.getImageData(0, 0, width, height).data
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad)
  y1 = Math.min(height - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('Could not encode the signature image.'))), 'image/png'),
  )
}

export async function renderTypedSignature(text: string, family: string, color: string): Promise<HTMLCanvasElement | null> {
  const t = text.trim()
  if (!t) return null
  const size = 96
  try {
    await document.fonts.load(`${size}px ${family}`, t)
  } catch {
    /* font not loadable: canvas falls back to the generic family */
  }
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = `${size}px ${family}`
  const w = Math.ceil(ctx.measureText(t).width) + 40
  c.width = Math.min(w, 2400)
  c.height = Math.round(size * 1.8)
  ctx.font = `${size}px ${family}`
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(t, 20, size * 1.2)
  return trimCanvas(c)
}

/** Intrinsic size of an SVG: width/height attributes, else its viewBox, else the browser default 300 x 150. */
export function svgSize(text: string): { width: number; height: number } {
  const tag = /<svg[\s>][^>]*>?/i.exec(text)?.[0] ?? ''
  const num = (name: string) => {
    const m = new RegExp(String.raw`\s${name}\s*=\s*["']\s*([0-9.]+)\s*(px|pt)?\s*["']`, 'i').exec(tag)
    return m ? parseFloat(m[1]) * (m[2] === 'pt' ? 96 / 72 : 1) : 0
  }
  let width = num('width')
  let height = num('height')
  const vb = /viewBox\s*=\s*["']\s*[-0-9.]+[ ,]+[-0-9.]+[ ,]+([0-9.]+)[ ,]+([0-9.]+)\s*["']/i.exec(tag)
  if (vb) {
    const vw = parseFloat(vb[1])
    const vh = parseFloat(vb[2])
    if (!width && !height) [width, height] = [vw, vh]
    else if (!width) width = (height * vw) / vh
    else if (!height) height = (width * vh) / vw
  }
  return { width: width > 0 ? width : 300, height: height > 0 ? height : 150 }
}

/** Rasterise an SVG to a PNG (PDF has no SVG image type here). Scripts never run: the SVG is only drawn through an <img>. */
async function svgToPng(file: File): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const text = await file.text()
  const { width, height } = svgSize(text)
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('The SVG could not be drawn.'))
      img.src = url
    })
    // draw at about 3x so the PNG stays sharp when placed, within a safe canvas size
    const k = Math.min(3, 2400 / Math.max(width, height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(width * k))
    c.height = Math.max(1, Math.round(height * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return { bytes: await canvasToPng(c), width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Decode any browser-supported image into a PNG (so webp/gif/svg etc. can be placed). Returns bytes + mime. */
export async function imageFileToAsset(file: File): Promise<{ bytes: Uint8Array; mime: 'image/png' | 'image/jpeg'; width: number; height: number }> {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return { ...(await svgToPng(file)), mime: 'image/png' }
  const buf = new Uint8Array(await file.arrayBuffer())
  const bmp = await createImageBitmap(new Blob([buf.slice(0)], { type: file.type }))
  const { width, height } = bmp
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8
  if (isPng || isJpg) {
    bmp.close()
    return { bytes: buf, mime: isPng ? 'image/png' : 'image/jpeg', width, height }
  }
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return { bytes: await canvasToPng(c), mime: 'image/png', width, height }
}
