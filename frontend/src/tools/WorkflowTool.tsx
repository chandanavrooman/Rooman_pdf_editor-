import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { ToolShell } from '@/components/ToolShell'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { STEP_LABELS, browserGrayscale, describeStep, newStep, runWorkflow, type WorkflowStep } from '@/lib/workflow'
import { PDF_MIME, type ToolPage } from './shared/types'

const KEY = 'rooman.workflow.steps'
const KINDS = Object.keys(STEP_LABELS) as WorkflowStep['kind'][]
const select = 'input !py-1 text-sm'

function load(): WorkflowStep[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? (v.filter((s) => s && KINDS.includes(s.kind)) as WorkflowStep[]) : []
  } catch {
    return []
  }
}

function StepEditor({ s, onChange }: { s: WorkflowStep; onChange: (s: WorkflowStep) => void }) {
  switch (s.kind) {
    case 'rotate':
      return (
        <select className={select} aria-label="Rotation" value={s.degrees} onChange={(e) => onChange({ ...s, degrees: Number(e.target.value) as 90 | 180 | 270 })}>
          <option value={90}>90° clockwise</option>
          <option value={180}>180°</option>
          <option value={270}>90° counter-clockwise</option>
        </select>
      )
    case 'flip':
      return (
        <select className={select} aria-label="Flip direction" value={s.axis} onChange={(e) => onChange({ ...s, axis: e.target.value as 'horizontal' | 'vertical' })}>
          <option value="horizontal">Left to right</option>
          <option value="vertical">Top to bottom</option>
        </select>
      )
    case 'split-half':
      return (
        <select className={select} aria-label="Where to cut" value={s.direction} onChange={(e) => onChange({ ...s, direction: e.target.value as 'auto' | 'vertical' | 'horizontal' })}>
          <option value="auto">Automatic</option>
          <option value="vertical">Left and right</option>
          <option value="horizontal">Top and bottom</option>
        </select>
      )
    case 'delete-pages':
    case 'extract-pages':
      return <input className={`${select} w-40`} aria-label="Pages" placeholder="e.g. 1-3, 5" value={s.pages} onChange={(e) => onChange({ ...s, pages: e.target.value })} />
    case 'remove-annotations':
      return (
        <span className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={s.markup} onChange={(e) => onChange({ ...s, markup: e.target.checked })} /> Comments and marks
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={s.links} onChange={(e) => onChange({ ...s, links: e.target.checked })} /> Links
          </label>
        </span>
      )
    case 'grayscale':
      return null
  }
}

/** Workflows: a list of steps that run one after the other on a file. The list is remembered on this device. */
const WorkflowTool: ToolPage = ({ tool }) => {
  const [steps, setSteps] = useState<WorkflowStep[]>(load)
  const [add, setAdd] = useState<WorkflowStep['kind']>('rotate')
  const [fileId, setFileId] = useState<string>()
  const { numPages } = usePdfDoc(fileId)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(steps))
    } catch {
      /* private window: the list just is not remembered */
    }
  }, [steps])
  const move = (i: number, d: number) =>
    setSteps((l) => {
      const j = i + d
      if (j < 0 || j >= l.length) return l
      const n = [...l]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  const problems = steps.map((s) => describeStep(s, numPages || undefined).error)
  return (
    <ToolShell
      tool={tool}
      runLabel="Run workflow"
      canRun={steps.length > 0 && problems.every((p) => !p)}
      onFilesChange={(f) => setFileId(f[0]?.id)}
      options={() => (
        <div className="space-y-4">
          <p className="text-sm text-ink-600 dark:text-ink-300">Build a list of steps. They run in order, each one on the result of the one before. The list is saved on this device for next time.</p>
          <ol className="space-y-2" data-testid="wf-steps">
            {steps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 px-3 py-2 dark:border-ink-700" data-testid="wf-step">
                <span className="w-6 shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-300">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{STEP_LABELS[s.kind]}</span>
                  <span className="mt-1 block">
                    <StepEditor s={s} onChange={(n) => setSteps((l) => l.map((x, k) => (k === i ? n : x)))} />
                  </span>
                  {problems[i] && (
                    <span role="alert" className="mt-1 block text-xs font-medium text-red-600 dark:text-red-400">
                      {problems[i]}
                    </span>
                  )}
                </span>
                <span className="flex gap-0.5">
                  <button type="button" className="btn-ghost btn-sm !px-1.5" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" className="btn-ghost btn-sm !px-1.5" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" className="btn-ghost btn-sm !px-1.5" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((l) => l.filter((_, k) => k !== i))}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
            {!steps.length && <li className="text-sm text-ink-500">No steps yet. Choose one below and press Add step.</li>}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <select className={select} aria-label="Step to add" data-testid="wf-add-kind" value={add} onChange={(e) => setAdd(e.target.value as WorkflowStep['kind'])}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {STEP_LABELS[k]}
                </option>
              ))}
            </select>
            <button type="button" className="btn-secondary btn-sm" data-testid="wf-add" onClick={() => setSteps((l) => [...l, newStep(add)])}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add step
            </button>
            {steps.length > 0 && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSteps([])}>
                Clear all
              </button>
            )}
          </div>
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-workflow.pdf`,
        bytes: await runWorkflow(getBytes(files[0].id), steps, { grayscale: browserGrayscale }, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default WorkflowTool
