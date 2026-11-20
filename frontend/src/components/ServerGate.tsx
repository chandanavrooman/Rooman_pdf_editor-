import type { ReactNode } from 'react'
import { LogIn } from 'lucide-react'
import { Notice } from './Notice'
import { useAuth, openAuthDialog } from '@/lib/auth'
import { useCapabilities } from '@/hooks/useCapabilities'
import type { ToolMeta } from '@/lib/tools'

/** Which backend capability (key of `capabilities.tools`) and external program each server tool depends on. */
export const TOOL_REQUIRES: Record<string, { cap: string; program: string }> = {
  'compress-pdf': { cap: 'compress', program: 'gs' },
  'ocr-pdf': { cap: 'ocr', program: 'tesseract' },
  'deskew-pdf': { cap: 'deskew', program: 'tesseract' },
  'word-to-pdf': { cap: 'word_to_pdf', program: 'soffice' },
  'excel-to-pdf': { cap: 'excel_to_pdf', program: 'soffice' },
  'powerpoint-to-pdf': { cap: 'powerpoint_to_pdf', program: 'soffice' },
}

/**
 * Everything a server tool must satisfy before it can run: signed in, backend reachable, external program installed.
 * Returns `blocked` (disable the run button) and the notices to show.
 */
export function useServerGate(tool: ToolMeta): { blocked: boolean; node: ReactNode } {
  const { token } = useAuth()
  const { caps, loading } = useCapabilities(tool.runsIn === 'server')
  if (tool.runsIn !== 'server') return { blocked: false, node: null }

  const nodes: ReactNode[] = []
  let blocked = false
  if (!token && caps?.local_test_mode) {
    blocked = true
    nodes.push(
      <Notice key="auth" kind="info" title="Starting local test session…">
        Sign-in is skipped in local test mode.
      </Notice>,
    )
  } else if (!token) {
    blocked = true
    nodes.push(
      <Notice key="auth" kind="info" title="Sign in to use server tools">
        <p>Server tools keep your files private to your account. Create a free account or sign in to continue.</p>
        <button type="button" className="btn-primary btn-sm mt-2" onClick={() => openAuthDialog('Sign in to use server tools.')} data-testid="gate-sign-in">
          <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in / Create account
        </button>
      </Notice>,
    )
  }
  if (!loading && !caps) {
    blocked = true
    nodes.push(
      <Notice key="down" kind="error" title="The server is not reachable">
        Start the backend (see the README) and reload this page.
      </Notice>,
    )
  }
  const req = TOOL_REQUIRES[tool.id]
  if (caps && req && caps.tools[req.cap] === false) {
    blocked = true
    const prog = caps.programs[req.program]
    nodes.push(
      <Notice key="missing" kind="error" title={`${prog?.label ?? req.program} is not installed on the server`}>
        <span data-testid="tool-missing">This tool needs it. {prog?.install ? `Install it: ${prog.install}` : 'Ask the administrator to install it.'}</span>
      </Notice>,
    )
  }
  if (caps && tool.id === 'pdf-to-word' && caps.tools.pdf_to_word_ocr_for_scans === false) {
    nodes.push(
      <Notice key="ocrwarn" kind="warn" title="Scanned PDFs will be embedded as images">
        Tesseract is not installed on the server, so scanned pages cannot be turned into editable text.
      </Notice>,
    )
  }
  return { blocked, node: nodes.length ? <div className="space-y-3">{nodes}</div> : null }
}
