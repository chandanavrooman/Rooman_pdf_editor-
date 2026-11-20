import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NotoVariant } from '../editor/fonts'

const STD = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/')
const FONTS = fileURLToPath(new URL('../assets/fonts/', import.meta.url))

export interface Raster {
  width: number
  height: number
  /** RGBA */
  data: Uint8ClampedArray
}

/** Render one page of a PDF with REAL pdf.js + a real canvas (node). Boxes (page space, points) are painted black afterwards. */
export async function renderToCanvas(pdf: Uint8Array, pageIndex: number, scale: number) {
  const doc = await pdfjs.getDocument({ data: pdf.slice(0), standardFontDataUrl: STD, verbosity: 0, useSystemFonts: false }).promise
  try {
    const page = await doc.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
    return { canvas, ctx }
  } finally {
    await doc.loadingTask.destroy()
  }
}

export async function renderPixels(pdf: Uint8Array, pageIndex: number, scale = 1): Promise<Raster> {
  const { canvas, ctx } = await renderToCanvas(pdf, pageIndex, scale)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: img.data as unknown as Uint8ClampedArray }
}

const FILES: Record<NotoVariant, string> = {
  regular: 'NotoSans_400Regular.ttf',
  bold: 'NotoSans_700Bold.ttf',
  italic: 'NotoSans_400Regular_Italic.ttf',
  bolditalic: 'NotoSans_700Bold_Italic.ttf',
}
export const loadNotoFromDisk = async (v: NotoVariant) => new Uint8Array(readFileSync(FONTS + FILES[v]))

/** Are two renders identical outside `ignore` (page-space boxes, points; margin in px)? Returns the count of differing pixels outside. */
export function diffOutside(a: Raster, b: Raster, scale: number, ignore: { x: number; y: number; w: number; h: number }[], margin = 2): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY
  let diff = 0
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (ignore.some((r) => x >= r.x * scale - margin && x <= (r.x + r.w) * scale + margin && y >= r.y * scale - margin && y <= (r.y + r.h) * scale + margin)) continue
      const i = (y * a.width + x) * 4
      if (Math.abs(a.data[i] - b.data[i]) > 2 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 2 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 2) diff++
    }
  return diff
}

export function darkPixelsIn(r: Raster, scale: number, b: { x: number; y: number; w: number; h: number }): { dark: number; total: number } {
  let dark = 0
  let total = 0
  for (let y = Math.floor(b.y * scale); y < Math.ceil((b.y + b.h) * scale); y++)
    for (let x = Math.floor(b.x * scale); x < Math.ceil((b.x + b.w) * scale); x++) {
      const i = (y * r.width + x) * 4
      total++
      if (r.data[i] < 40 && r.data[i + 1] < 40 && r.data[i + 2] < 40) dark++
    }
  return { dark, total }
}
