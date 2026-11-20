import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { embeddedCovers, embeddedKeyFor, registerEmbedded } from './embeddedFonts'
import type { OrigText } from './types'

const ttf = new Uint8Array(readFileSync('src/assets/fonts/LiberationSerif-Regular.ttf'))
const orig = { fontId: 'liberation-serif', bold: false, italic: false } as OrigText
const obj = (text: string, extra: Record<string, unknown> = {}) => ({ text, bold: false, italic: false, fontId: 'liberation-serif' as const, orig, autoWidth: true, embedKey: 'k1', ...extra })

describe('reusing the PDF’s own embedded font for edits', () => {
  it('registers TrueType fonts only', () => {
    expect(registerEmbedded('k1', ttf)).toBe('k1')
    expect(registerEmbedded('bad1', new Uint8Array([79, 84, 84, 79, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeUndefined() // CFF ("OTTO") cannot be embedded reliably
    expect(registerEmbedded('bad2', 'not bytes')).toBeUndefined()
  })
  it('is used only when every typed character is in the font', () => {
    registerEmbedded('k1', ttf)
    expect(embeddedCovers('k1', 'Hello world')).toBe(true)
    expect(embeddedCovers('k1', 'Hello \u4e2d')).toBe(false) // a CJK character is not in the font
    expect(embeddedKeyFor(obj('Hello'))).toBe('k1')
    expect(embeddedKeyFor(obj('Hello \u4e2d'))).toBeUndefined()
  })
  it('is not used once the typeface or style was changed', () => {
    registerEmbedded('k1', ttf)
    expect(embeddedKeyFor(obj('Hi', { bold: true }))).toBeUndefined()
    expect(embeddedKeyFor(obj('Hi', { italic: true }))).toBeUndefined()
    expect(embeddedKeyFor(obj('Hi', { fontId: 'tinos' }))).toBeUndefined()
    expect(embeddedKeyFor(obj('Hi', { embedKey: undefined }))).toBeUndefined()
  })
})
