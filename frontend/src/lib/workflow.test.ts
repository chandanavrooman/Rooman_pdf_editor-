import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { describeStep, newStep, runWorkflow, type WorkflowEnv } from './workflow'

const env: WorkflowEnv = { grayscale: async (b) => b }
async function doc(n: number, size: [number, number] = [200, 100]) {
  const d = await PDFDocument.create()
  for (let i = 0; i < n; i++) d.addPage(size)
  return d.save()
}
const noop = () => {}

describe('workflow', () => {
  it('runs steps in order on the result of the previous one', async () => {
    // 4 pages -> delete page 1 (3) -> split in half (6) -> keep only 1-2 (2)
    const out = await runWorkflow(await doc(4), [{ kind: 'delete-pages', pages: '1' }, { kind: 'split-half', direction: 'vertical' }, { kind: 'extract-pages', pages: '1-2' }], env, noop)
    const d = await PDFDocument.load(out)
    expect(d.getPageCount()).toBe(2)
    expect(d.getPage(0).getWidth()).toBe(100)
  })
  it('rotates and flips', async () => {
    const out = await runWorkflow(await doc(1), [{ kind: 'rotate', degrees: 90 }, { kind: 'flip', axis: 'horizontal' }], env, noop)
    const d = await PDFDocument.load(out)
    expect(d.getPage(0).getRotation().angle).toBe(90)
  })
  it('names the failing step', async () => {
    await expect(runWorkflow(await doc(2), [{ kind: 'rotate', degrees: 90 }, { kind: 'delete-pages', pages: '9' }], env, noop)).rejects.toThrow(/Step 2 \(Delete pages\) failed/)
  })
  it('needs at least one step, and reports unfinished steps', async () => {
    await expect(runWorkflow(await doc(1), [], env, noop)).rejects.toThrow(/at least one step/)
    expect(describeStep(newStep('delete-pages'), 5).error).toMatch(/Type the pages/)
    expect(describeStep({ kind: 'delete-pages', pages: '9' }, 5).error).toBeTruthy()
    expect(describeStep({ kind: 'remove-annotations', markup: false, links: false }).error).toBeTruthy()
  })
})
