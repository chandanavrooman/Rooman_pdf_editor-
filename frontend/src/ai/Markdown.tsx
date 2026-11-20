import { Fragment, type ReactNode } from 'react'
import { downloadDocumentBytes, friendlyMessage } from '@/lib/apiClient'
import { downloadBytes } from '@/lib/download'

/**
 * A small, SAFE markdown renderer for model output. It builds React elements only (React escapes all text), never uses
 * dangerouslySetInnerHTML, only links to http(s) URLs or to our own authenticated download URLs, and turns page
 * citations like "[p. 3]", "[pp. 3-5]" or "[D2 p. 4]" into clickable chips.
 */
export interface CitationClick {
  page: number
  /** "D1", "D2"… when several documents are attached */
  label?: string
}

const CITE = /^\[(?:(D\d+)\s*[,:]?\s*)?pp?\.\s*([\d,\s\-–and&]+)\]$/i
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[(?:D\d+\s*[,:]?\s*)?pp?\.\s*[\d,\s\-–and&]+\]|\[[^\]\n]+\]\([^)\s]+\)|(?<![*\w])\*[^*\s][^*\n]*\*(?![*\w]))/gi
const DOWNLOAD = /^\/api\/documents\/([0-9a-f]{32})\/download$/

export function parseCitation(token: string): { label?: string; pages: { page: number; text: string }[] } | null {
  const m = CITE.exec(token)
  if (!m) return null
  const pages: { page: number; text: string }[] = []
  for (const part of m[2].split(/[,&]|\band\b/i)) {
    const t = part.trim()
    if (!t) continue
    const r = /^(\d+)\s*[-–]\s*(\d+)$/.exec(t)
    if (r) pages.push({ page: Number(r[1]), text: `${r[1]}–${r[2]}` })
    else if (/^\d+$/.test(t)) pages.push({ page: Number(t), text: t })
  }
  return pages.length ? { label: m[1]?.toUpperCase(), pages } : null
}

function DownloadLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="font-medium text-brand-700 underline dark:text-brand-300"
      onClick={() => {
        void downloadDocumentBytes({ id }).then(
          (b) => downloadBytes('rooman-result', b),
          (e) => alert(friendlyMessage(e)),
        )
      }}
    >
      {children}
    </button>
  )
}

/** Citations of pages that do not exist (e.g. "[p. 2]" in a 1-page PDF) are shown as plain text, never as a clickable chip. */
export type PageValidator = (c: CitationClick) => boolean

export function Inline({ text, onCitation, validPage }: { text: string; onCitation?: (c: CitationClick) => void; validPage?: PageValidator }): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    if (m.index > last) out.push(text.slice(last, m.index))
    last = m.index + tok.length
    const key = k++
    const cite = parseCitation(tok)
    if (cite) {
      out.push(
        <Fragment key={key}>
          {cite.pages.map((p, i) =>
            validPage && !validPage({ page: p.page, label: cite.label }) ? (
              <span key={i} className="text-xs text-ink-500 dark:text-ink-400" title="This page is not in the document" data-testid="citation-invalid">
                {cite.label ? `${cite.label} ` : ''}p. {p.text}
              </span>
            ) : (
            <button
              key={i}
              type="button"
              className="mx-0.5 inline-flex items-center rounded-md bg-brand-100 px-1.5 py-0.5 align-baseline text-xs font-semibold text-brand-800 hover:bg-brand-200 focus-visible:outline-2 focus-visible:outline-brand-500 dark:bg-brand-900/60 dark:text-brand-100"
              data-testid="citation-chip"
              data-page={p.page}
              onClick={() => onCitation?.({ page: p.page, label: cite.label })}
              aria-label={`Go to page ${p.text}${cite.label ? ` of document ${cite.label}` : ''}`}
            >
              {cite.label ? `${cite.label} ` : ''}p. {p.text}
            </button>
            ),
          )}
        </Fragment>,
      )
    } else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={key} className="rounded bg-ink-100 px-1 py-0.5 text-[0.85em] dark:bg-ink-800">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!
      const [, label, url] = lm
      const dl = DOWNLOAD.exec(url)
      if (dl) out.push(<DownloadLink key={key} id={dl[1]}>{label}</DownloadLink>)
      else if (/^https?:\/\//i.test(url)) out.push(<a key={key} href={url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-300">{label}</a>)
      else out.push(label)
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'code'; text: string }
  | { t: 'table'; rows: string[][] }

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', text: para.join(' ') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line)) {
      flush()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      blocks.push({ t: 'code', text: buf.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push({ t: 'h', level: h[1].length, text: h[2] })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush()
      const rows = [cells(line)]
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]))
      i--
      blocks.push({ t: 'table', rows })
      continue
    }
    const li = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line)
    if (li) {
      flush()
      const kind = li[1] ? 'ol' : 'ul'
      const last = blocks[blocks.length - 1]
      if (last && last.t === kind) last.items.push(li[2])
      else blocks.push({ t: kind, items: [li[2]] })
      continue
    }
    para.push(line.trim())
  }
  flush()
  return blocks
}

export function Markdown({ text, onCitation, validPage }: { text: string; onCitation?: (c: CitationClick) => void; validPage?: PageValidator }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h':
            return <p key={i} className={`font-bold ${b.level <= 2 ? 'text-base' : 'text-sm'}`}><Inline text={b.text} onCitation={onCitation} validPage={validPage} /></p>
          case 'ul':
            return <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((x, j) => <li key={j}><Inline text={x} onCitation={onCitation} validPage={validPage} /></li>)}</ul>
          case 'ol':
            return <ol key={i} className="list-decimal space-y-1 pl-5">{b.items.map((x, j) => <li key={j}><Inline text={x} onCitation={onCitation} validPage={validPage} /></li>)}</ol>
          case 'code':
            return <pre key={i} className="overflow-auto rounded-lg bg-ink-100 p-3 text-xs dark:bg-ink-800"><code>{b.text}</code></pre>
          case 'table':
            return (
              <div key={i} className="overflow-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead><tr>{b.rows[0].map((c, j) => <th key={j} className="border border-ink-200 bg-ink-50 px-2 py-1 text-left dark:border-ink-700 dark:bg-ink-800"><Inline text={c} onCitation={onCitation} validPage={validPage} /></th>)}</tr></thead>
                  <tbody>{b.rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border border-ink-200 px-2 py-1 dark:border-ink-700"><Inline text={c} onCitation={onCitation} validPage={validPage} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            )
          default:
            return <p key={i}><Inline text={b.text} onCitation={onCitation} validPage={validPage} /></p>
        }
      })}
    </div>
  )
}
