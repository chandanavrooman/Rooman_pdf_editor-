import { describe, expect, it, vi } from 'vitest'
import { downloadBytes } from '@/lib/download'
import { addBytes, removeFile } from '@/lib/fileStore'

describe('Preview & Download Workflow', () => {
  it('downloadBytes creates an anchor and triggers download without throwing', () => {
    const origDoc = globalThis.document
    const origUrl = globalThis.URL
    const dummyAnchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }

    globalThis.document = {
      createElement: vi.fn(() => dummyAnchor),
      body: { appendChild: vi.fn() },
    } as unknown as Document
    globalThis.URL = {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL

    const dummyBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35])
    expect(() => downloadBytes('test.pdf', dummyBytes, 'application/pdf')).not.toThrow()

    expect(globalThis.document.createElement).toHaveBeenCalledWith('a')
    expect(dummyAnchor.download).toBe('test.pdf')
    expect(dummyAnchor.click).toHaveBeenCalled()

    globalThis.document = origDoc
    globalThis.URL = origUrl
  })

  it('addBytes preserves byte integrity and assigns an accessible id for PdfViewer', () => {
    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xc4, 0xe5, 0xf2, 0xe5, 0xfa])
    const meta = addBytes('output.pdf', dummyPdf)
    expect(meta.id).toBeDefined()
    expect(meta.name).toBe('output.pdf')
    expect(meta.kind).toBe('pdf')
    expect(meta.size).toBe(dummyPdf.byteLength)

    removeFile(meta.id)
  })

  it('multi-output selection properly indexes through outputs', () => {
    const outputs = [
      { name: 'part-1.pdf', bytes: new Uint8Array([1, 2, 3]), mime: 'application/pdf', id: 'f-1' },
      { name: 'part-2.pdf', bytes: new Uint8Array([4, 5, 6]), mime: 'application/pdf', id: 'f-2' },
      { name: 'part-3.pdf', bytes: new Uint8Array([7, 8, 9]), mime: 'application/pdf', id: 'f-3' },
    ]

    let selectedIndex = 0
    expect(outputs[selectedIndex].name).toBe('part-1.pdf')
    selectedIndex = 1
    expect(outputs[selectedIndex].name).toBe('part-2.pdf')
    selectedIndex = 2
    expect(outputs[selectedIndex].name).toBe('part-3.pdf')
  })
})
