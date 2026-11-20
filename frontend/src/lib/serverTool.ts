import type { RunContext, RunResult, ToolOutput } from '@/components/ToolShell'
import { apiJson, ApiError, deleteDocument, downloadDocumentBytes, type DocumentInfo, type ToolResult } from './apiClient'
import type { StoredFileMeta } from './fileStore'
import { ensureServerDocument, forgetServerDocument } from './serverDocs'

export interface ServerRunSpec {
  /** path below /api, e.g. '/optimize/compress' */
  endpoint: string
  /** Request body, built from the uploaded input documents (same order as `files`). */
  body: (docs: DocumentInfo[]) => Record<string, unknown>
  /** Extra facts shown on the result page (before/after sizes …). */
  infos?: (res: ToolResult, ctx: { inputs: DocumentInfo[] }) => string[]
  /** Files to upload (default: all files of the run). */
  files?: StoredFileMeta[]
  /** Called with the raw ToolResult (e.g. to cache metadata). */
  onResult?: (res: ToolResult) => void
}

const UPLOAD_SHARE = 0.4

/**
 * Upload the input file(s) → call the tool endpoint → download the output document(s) with the Bearer token.
 * Progress: real upload progress for 0–40 %, an easing "server is working" estimate up to 90 %, then the download.
 * Output documents are fetched into memory and then deleted from the server immediately (inputs stay cached until the TTL
 * so that "Edit again" and chained tools do not upload the same file twice).
 */
export async function runServerTool(ctx: RunContext, spec: ServerRunSpec): Promise<RunResult> {
  const files = spec.files ?? ctx.files
  const attempt = async (): Promise<{ res: ToolResult; inputs: DocumentInfo[] }> => {
    const inputs: DocumentInfo[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      ctx.progress((i / files.length) * UPLOAD_SHARE, files.length > 1 ? `Uploading ${f.name} (${i + 1}/${files.length})` : `Uploading ${f.name}`)
      inputs.push(
        await ensureServerDocument(f, (fr) => ctx.progress(((i + fr) / files.length) * UPLOAD_SHARE, `Uploading ${f.name}`), ctx.signal),
      )
    }
    ctx.progress(UPLOAD_SHARE, 'Processing on the server…')
    const t0 = performance.now()
    const timer = setInterval(() => {
      const elapsed = (performance.now() - t0) / 1000
      ctx.progress(UPLOAD_SHARE + 0.5 * (1 - Math.exp(-elapsed / 12)), 'Processing on the server…')
    }, 400)
    try {
      const res = await apiJson<ToolResult>(spec.endpoint, spec.body(inputs), { signal: ctx.signal })
      return { res, inputs }
    } finally {
      clearInterval(timer)
    }
  }

  let out: { res: ToolResult; inputs: DocumentInfo[] }
  try {
    out = await attempt()
  } catch (e) {
    // the server may have deleted a cached input after its TTL: upload again once
    if (e instanceof ApiError && e.code === 'NOT_FOUND') {
      files.forEach((f) => forgetServerDocument(f.id))
      out = await attempt()
    } else throw e
  }
  const { res, inputs } = out
  spec.onResult?.(res)
  const outputs: ToolOutput[] = []
  for (let i = 0; i < res.documents.length; i++) {
    const d = res.documents[i]
    ctx.progress(0.9 + (i / res.documents.length) * 0.1, `Downloading ${d.filename}`)
    outputs.push({ name: d.filename, bytes: await downloadDocumentBytes(d, ctx.signal), mime: d.mime || 'application/octet-stream' })
  }
  res.documents.forEach((d) => void deleteDocument(d.id))
  return { outputs, notes: res.notice ? [res.notice] : [], infos: spec.infos?.(res, { inputs }) ?? [] }
}
