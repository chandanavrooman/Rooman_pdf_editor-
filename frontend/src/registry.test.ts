import { describe, expect, it } from 'vitest'
import { CATEGORIES, TOOLS, searchTools, toolById } from './lib/tools'

describe('tool registry', () => {
  it('has unique ids and routes', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length)
    expect(new Set(TOOLS.map((t) => t.route)).size).toBe(TOOLS.length)
  })
  it('only references existing related tools and categories', () => {
    const cats = new Set(CATEGORIES.map((c) => c.id))
    for (const t of TOOLS) {
      expect(cats.has(t.category)).toBe(true)
      for (const r of t.related) expect(toolById(r), `${t.id} -> ${r}`).toBeTruthy()
    }
  })
  it('covers the whole spec', () => {
    for (const id of ['merge-pdf', 'split-pdf', 'extract-pages', 'delete-pages', 'rotate-pdf', 'reorder-pages', 'crop-pdf', 'resize-pages', 'n-up', 'add-page-numbers', 'headers-footers', 'bates-numbering', 'edit-pdf', 'compress-pdf', 'ocr-pdf', 'protect-pdf', 'chat-pdf']) {
      expect(toolById(id)).toBeTruthy()
    }
  })
  it('searches by name and keyword', () => {
    expect(searchTools('combine').map((t) => t.id)).toContain('merge-pdf')
    expect(searchTools('zzzz')).toEqual([])
  })
  it('every available tool has a page component (checked at the module level)', async () => {
    const { toolComponents } = await import('./tools')
    for (const t of TOOLS.filter((x) => x.status === 'available')) expect(toolComponents[t.id], t.id).toBeTruthy()
  })
})
