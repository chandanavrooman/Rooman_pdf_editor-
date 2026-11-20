import { describe, expect, it } from 'vitest'
import { COLOR_PRESETS, hexToRgb255, hsvToHex, hsvToRgb, normalizeHex, presetName, readableOn, rgbToHex, rgbToHsv, sameColor } from './color'

describe('normalizeHex', () => {
  it.each([['#27449A', '#27449a'], ['27449a', '#27449a'], ['  #1A9A8A ', '#1a9a8a'], ['#fa0', '#ffaa00'], ['FFF', '#ffffff'], ['#000000', '#000000']])('%j -> %j', (a, b) => expect(normalizeHex(a)).toBe(b))
  it.each(['', '#', '#12', '#12345', '#1234567', 'blue', '#gggggg', '##123456', '#12 34 56'])('rejects %j', (a) => expect(normalizeHex(a)).toBeNull())
})

describe('rgb <-> hex', () => {
  it('round trips every value exactly', () => {
    for (const hex of ['#000000', '#ffffff', '#27449a', '#1a9a8a', '#c3291e', '#010203', '#fedcba']) expect(rgbToHex(hexToRgb255(hex)!.r, hexToRgb255(hex)!.g, hexToRgb255(hex)!.b)).toBe(hex)
  })
  it('clamps and rounds', () => expect(rgbToHex(-5, 300, 127.6)).toBe('#00ff80'))
})

describe('hsv', () => {
  it('knows the primaries', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00')
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff')
    expect(hsvToHex({ h: 60, s: 1, v: 1 })).toBe('#ffff00')
    expect(hsvToHex({ h: 0, s: 0, v: 1 })).toBe('#ffffff')
    expect(hsvToHex({ h: 200, s: 0, v: 0 })).toBe('#000000')
  })
  it('hex -> hsv -> hex returns the same colour for every preset', () => {
    for (const p of COLOR_PRESETS) expect(hsvToHex(rgbToHsv(hexToRgb255(p.hex)!)), p.name).toBe(p.hex)
  })
  it('hex -> hsv -> hex is exact across the whole range (sampled)', () => {
    for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 17) {
      const hex = rgbToHex(r, g, b)
      expect(hsvToHex(rgbToHsv({ r, g, b })), hex).toBe(hex)
    }
  })
  it('keeps the hue of a grey when the caller keeps its own hsv', () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0)
    expect(hsvToRgb({ h: 200, s: 0, v: 0.5 })).toEqual({ r: 128, g: 128, b: 128 })
  })
})

describe('presets', () => {
  it('are the ten named colours, all valid and distinct', () => {
    expect(COLOR_PRESETS.map((p) => p.name)).toEqual(['Rooman navy', 'Blue', 'Teal', 'Green', 'Red', 'Amber', 'Purple', 'Black', 'White', 'Grey'])
    for (const p of COLOR_PRESETS) expect(normalizeHex(p.hex), p.name).toBe(p.hex)
    expect(new Set(COLOR_PRESETS.map((p) => p.hex)).size).toBe(10)
  })
  it('the colours in the brief are available as given', () => {
    expect(COLOR_PRESETS.find((p) => p.name === 'Blue')!.hex).toBe('#27449a')
    expect(COLOR_PRESETS.find((p) => p.name === 'Teal')!.hex).toBe('#1a9a8a')
    expect(COLOR_PRESETS.find((p) => p.name === 'Red')!.hex).toBe('#c3291e')
    expect(COLOR_PRESETS.find((p) => p.name === 'Black')!.hex).toBe('#000000')
  })
  it('recognises a preset whatever the case', () => {
    expect(presetName('#1A9A8A')).toBe('Teal')
    expect(presetName('#123456')).toBeUndefined()
    expect(sameColor('#FFF', '#ffffff')).toBe(true)
  })
  it('picks a readable tick colour', () => {
    expect(readableOn('#ffffff')).toBe('#000000')
    expect(readableOn('#000000')).toBe('#ffffff')
    expect(readableOn('#f59e2b')).toBe('#000000')
    expect(readableOn('#1b2a4e')).toBe('#ffffff')
  })
})
