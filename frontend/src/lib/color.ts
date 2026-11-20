/** Colour helpers shared by the colour picker. Colours travel through the app as lowercase '#rrggbb'. */

export interface Rgb {
  r: number
  g: number
  b: number
}
/** h 0..360, s and v 0..1 */
export interface Hsv {
  h: number
  s: number
  v: number
}

/** The one-click colours. Order is the order they are shown in. */
export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: 'Rooman navy', hex: '#1b2a4e' },
  { name: 'Blue', hex: '#27449a' },
  { name: 'Teal', hex: '#1a9a8a' },
  { name: 'Green', hex: '#2e9e4f' },
  { name: 'Red', hex: '#c3291e' },
  { name: 'Amber', hex: '#f59e2b' },
  { name: 'Purple', hex: '#7c3aed' },
  { name: 'Black', hex: '#000000' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Grey', hex: '#6b7280' },
]

/** "#27449A", "27449a", "#fa0" -> "#27449a" / "#ffaa00". Anything else -> null. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  let h = m[1].toLowerCase()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return '#' + h
}

export function hexToRgb255(hex: string): Rgb | null {
  const n = normalizeHex(hex)
  if (!n) return null
  const v = parseInt(n.slice(1), 16)
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
}

const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => byte(c).toString(16).padStart(2, '0')).join('')
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let rgb: [number, number, number]
  if (hh < 1) rgb = [c, x, 0]
  else if (hh < 2) rgb = [x, c, 0]
  else if (hh < 3) rgb = [0, c, x]
  else if (hh < 4) rgb = [0, x, c]
  else if (hh < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const [r, g, b] = rgb
  const m = v - c
  return { r: byte((r + m) * 255), g: byte((g + m) * 255), b: byte((b + m) * 255) }
}

export const hsvToHex = (hsv: Hsv) => {
  const { r, g, b } = hsvToRgb(hsv)
  return rgbToHex(r, g, b)
}

export const sameColor = (a: string, b: string) => (normalizeHex(a) ?? a.toLowerCase()) === (normalizeHex(b) ?? b.toLowerCase())

/** The name of a preset colour, if `hex` is one. */
export const presetName = (hex: string) => COLOR_PRESETS.find((p) => sameColor(p.hex, hex))?.name

/** Black or white, whichever reads better on top of `hex` (for the tick on a selected swatch). */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const c = hexToRgb255(hex) ?? { r: 0, g: 0, b: 0 }
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
  return lum > 0.6 ? '#000000' : '#ffffff'
}
