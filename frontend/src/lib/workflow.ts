import { PDFDocument } from 'pdf-lib'
import { deletePages, extractPages, flipPages, removeAnnotations, rotateAll, splitInHalf, pdfFromPageImages, type FlipAxis, type HalfDirection } from '@/lib/pdfOps'
import { parsePageList } from '@/lib/ranges'

/** One step of a workflow. Every step takes a PDF and gives back a PDF. */
export type WorkflowStep =
  | { kind: 'rotate'; degrees: 90 | 180 | 270 }
  | { kind: 'flip'; axis: FlipAxis }
  | { kind: 'split-half'; direction: HalfDirection }
  | { kind: 'delete-pages'; pages: string }
  | { kind: 'extract-pages'; pages: string }
  | { kind: 'remove-annotations'; markup: boolean; links: boolean }
  | { kind: 'grayscale' }

export const STEP_LABELS: Record<WorkflowStep['kind'], string> = {
  rotate: 'Rotate all pages',
  flip: 'Flip pages',
  'split-half': 'Split pages in half',
  'delete-pages': 'Delete pages',
  'extract-pages': 'Keep only some pages',
  'remove-annotations': 'Remove annotations',
  grayscale: 'Convert to grayscale',
}

export const newStep = (kind: WorkflowStep['kind']): WorkflowStep => {
  switch (kind) {
    case 'rotate':
      return { kind, degrees: 90 }
    case 'flip':
      return { kind, axis: 'horizontal' }
    case 'split-half':
      return { kind, direction: 'auto' }
    case 'delete-pages':
    case 'extract-pages':
      return { kind, pages: '' }
    case 'remove-annotations':
      return { kind, markup: true, links: false }
    case 'grayscale':
      return { kind }
  }
}

/** A short sentence for the list of steps, or an error when the step is not filled in. */
export function describeStep(s: WorkflowStep, pageCount?: number): { text: string; error?: string } {
  switch (s.kind) {
    case 'rotate':
      return { text: `Rotate all pages ${s.degrees}° clockwise` }
    case 'flip':
      return { text: s.axis === 'horizontal' ? 'Flip left to right' : 'Flip top to bottom' }
    case 'split-half':
      return { text: `Split every page in half (${s.direction === 'auto' ? 'automatic' : s.direction === 'vertical' ? 'left and right' : 'top and bottom'})` }
    case 'delete-pages':
    case 'extract-pages': {
      const verb = s.kind === 'delete-pages' ? 'Delete' : 'Keep only'
      if (!s.pages.trim()) return { text: `${verb} pages …`, error: 'Type the pages, like 1-3, 5.' }
      try {
        if (pageCount) parsePageList(s.pages, pageCount)
        return { text: `${verb} pages ${s.pages.trim()}` }
      } catch (e) {
        return { text: `${verb} pages ${s.pages.trim()}`, error: e instanceof Error ? e.message : String(e) }
      }
    }
    case 'remove-annotations':
      return !s.markup && !s.links ? { text: 'Remove annotations', error: 'Tick comments and marks, links, or both.' } : { text: `Remove ${[s.markup && 'comments and marks', s.links && 'links'].filter(Boolean).join(' and ')}` }
    case 'grayscale':
      return { text: 'Convert to grayscale (pages become pictures)' }
  }
}

export interface WorkflowEnv {
  /** turn pages into gray pictures (needs a browser); supplied by the page */
  grayscale: (bytes: Uint8Array, onProgress: (f: number) => void) => Promise<Uint8Array>
}

/** The real grayscale step: render in the browser. Kept apart so the other steps run (and are tested) without a canvas. */
export async function browserGrayscale(bytes: Uint8Array, onProgress: (f: number) => void): Promise<Uint8Array> {
  const { renderGrayscalePages } = await import('@/lib/grayscaleRaster')
  const pages = await renderGrayscalePages(bytes, (f) => onProgress(f * 0.8))
  return pdfFromPageImages(pages, (f) => onProgress(0.8 + f * 0.2))
}

export async function runStep(bytes: Uint8Array, s: WorkflowStep, env: WorkflowEnv, onProgress: (f: number) => void): Promise<Uint8Array> {
  const count = async () => (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount()
  switch (s.kind) {
    case 'rotate':
      return rotateAll(bytes, s.degrees, (f) => onProgress(f))
    case 'flip':
      return flipPages(bytes, { axis: s.axis }, onProgress)
    case 'split-half':
      return splitInHalf(bytes, { direction: s.direction }, onProgress)
    case 'delete-pages':
      return deletePages(bytes, parsePageList(s.pages, await count()), onProgress)
    case 'extract-pages':
      return extractPages(bytes, parsePageList(s.pages, await count()), onProgress)
    case 'remove-annotations':
      return (await removeAnnotations(bytes, { markup: s.markup, links: s.links }, undefined, onProgress)).bytes
    case 'grayscale':
      return env.grayscale(bytes, onProgress)
  }
}

/** Run the steps in order; each one works on the result of the one before. Stops with a message that names the failing step. */
export async function runWorkflow(bytes: Uint8Array, steps: WorkflowStep[], env: WorkflowEnv, onProgress: (f: number, label?: string) => void): Promise<Uint8Array> {
  if (!steps.length) throw new Error('Add at least one step.')
  let cur = bytes
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    onProgress(i / steps.length, `Step ${i + 1} of ${steps.length}: ${STEP_LABELS[s.kind]}`)
    try {
      cur = await runStep(cur, s, env, (f) => onProgress((i + f) / steps.length, `Step ${i + 1} of ${steps.length}: ${STEP_LABELS[s.kind]}`))
    } catch (e) {
      throw new Error(`Step ${i + 1} (${STEP_LABELS[s.kind]}) failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
  }
  onProgress(1)
  return cur
}
