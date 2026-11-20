import { describe, expect, it } from 'vitest'
import { formatPageList, parsePageList, parseRanges } from './ranges'

describe('parseRanges', () => {
  it('parses singles and ranges', () => {
    expect(parseRanges('1-3,5,8-10', 10)).toEqual([{ start: 1, end: 3 }, { start: 5, end: 5 }, { start: 8, end: 10 }])
  })
  it('supports open ranges, last and all', () => {
    expect(parseRanges('8-', 10)).toEqual([{ start: 8, end: 10 }])
    expect(parseRanges('-3', 10)).toEqual([{ start: 1, end: 3 }])
    expect(parseRanges('2-last', 10)).toEqual([{ start: 2, end: 10 }])
    expect(parseRanges('last', 10)).toEqual([{ start: 10, end: 10 }])
    expect(parseRanges('ALL', 4)).toEqual([{ start: 1, end: 4 }])
  })
  it('tolerates spaces and semicolons', () => {
    expect(parsePageList(' 1 - 2 ; 4 ', 5)).toEqual([1, 2, 4])
  })
  it('rejects bad input with clear messages', () => {
    expect(() => parseRanges('', 5)).toThrow(/at least one/)
    expect(() => parseRanges('0', 5)).toThrow(/start at 1/)
    expect(() => parseRanges('6', 5)).toThrow(/out of range/)
    expect(() => parseRanges('4-2', 5)).toThrow(/backwards/)
    expect(() => parseRanges('a', 5)).toThrow(/not a valid page/)
    expect(() => parseRanges('1-2-3', 5)).toThrow(/not a valid range/)
  })
  it('dedupes unless asked to keep duplicates', () => {
    expect(parsePageList('1-3,2-4', 5)).toEqual([1, 2, 3, 4])
    expect(parsePageList('1,1', 5, true)).toEqual([1, 1])
  })
  it('formats lists compactly', () => {
    expect(formatPageList([5, 1, 2, 3, 8, 9])).toBe('1-3,5,8-9')
  })
})
