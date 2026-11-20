import { useEffect, useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { Checkbox, ColorField, Field, RadioCards, SelectField, TextField } from '@/components/forms'
import { Notice } from '@/components/Notice'
import { apiJson, friendlyMessage, uploadDocument } from '@/lib/apiClient'
import { useAuth } from '@/lib/auth'
import { ensureServerDocument } from '@/lib/serverDocs'
import { runServerTool } from '@/lib/serverTool'
import type { StoredFileMeta } from '@/lib/fileStore'
import type { ToolPage } from '../shared/types'

const PAGES_HINT = 'Leave empty for all pages, or e.g. 1-3,5'
const cleanPages = (v: string) => v.trim() || undefined

// ───────────────────────────────────────────────────────────── Protect
export const ProtectTool: ToolPage = ({ tool }) => {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [owner, setOwner] = useState('')
  const [allowPrint, setAllowPrint] = useState(true)
  const [allowCopy, setAllowCopy] = useState(true)
  const [allowModify, setAllowModify] = useState(false)
  const mismatch = pw2.length > 0 && pw !== pw2
  return (
    <ToolShell
      tool={tool}
      runLabel="Protect PDF"
      canRun={pw.length > 0 && pw === pw2}
      onFilesChange={() => {
        setPw('')
        setPw2('')
      }}
      options={() => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField label="Password to open the PDF" value={pw} onChange={setPw} testId="protect-password" />
            <PasswordField label="Repeat password" value={pw2} onChange={setPw2} testId="protect-password2" error={mismatch ? 'The passwords do not match' : null} />
          </div>
          <PasswordField label="Owner password (optional)" value={owner} onChange={setOwner} hint="Needed to change the permissions below. Leave empty to reuse the open password." testId="protect-owner" />
          <fieldset className="space-y-2">
            <legend className="label">Allow readers to</legend>
            <Checkbox label="Print" checked={allowPrint} onChange={setAllowPrint} />
            <Checkbox label="Copy text and images" checked={allowCopy} onChange={setAllowCopy} />
            <Checkbox label="Modify the document" checked={allowModify} onChange={setAllowModify} />
          </fieldset>
          <p className="text-xs text-ink-500 dark:text-ink-400">Encryption is AES-256. If you forget the password the file cannot be recovered.</p>
        </div>
      )}
      run={(ctx) =>
        runServerTool(ctx, {
          endpoint: '/security/protect',
          body: (d) => ({ document_id: d[0].id, user_password: pw, owner_password: owner || undefined, allow_print: allowPrint, allow_copy: allowCopy, allow_modify: allowModify }),
        })
      }
    />
  )
}

function PasswordField({ label, value, onChange, hint, error, testId }: { label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string | null; testId?: string }) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input className={`input ${error ? '!border-red-500' : ''}`} type="password" autoComplete="new-password" value={value} data-testid={testId} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

// ───────────────────────────────────────────────────────────── Unlock
export const UnlockTool: ToolPage = ({ tool }) => {
  const [pw, setPw] = useState('')
  return (
    <ToolShell
      tool={tool}
      runLabel="Unlock PDF"
      onFilesChange={() => setPw('')}
      options={() => (
        <div className="space-y-3">
          <PasswordField label="PDF password" value={pw} onChange={setPw} testId="unlock-password" hint="Leave empty if the PDF opens without a password but has editing/printing restrictions." />
          <Notice kind="info">You must know the password: this tool removes it, it cannot guess or crack passwords.</Notice>
        </div>
      )}
      run={(ctx) => runServerTool(ctx, { endpoint: '/security/unlock', body: (d) => ({ document_id: d[0].id, password: pw }) })}
    />
  )
}

// ───────────────────────────────────────────────────────────── Watermark
export const WatermarkTool: ToolPage = ({ tool }) => {
  const [kind, setKind] = useState<'text' | 'image'>('text')
  const [text, setText] = useState('CONFIDENTIAL')
  const [image, setImage] = useState<File | null>(null)
  const [opacity, setOpacity] = useState(30)
  const [rotation, setRotation] = useState('45')
  const [fontSize, setFontSize] = useState('60')
  const [color, setColor] = useState('#888888')
  const [layout, setLayout] = useState<'center' | 'tile'>('center')
  const [imageScale, setImageScale] = useState(50)
  const [pages, setPages] = useState('')
  const rot = Number(rotation)
  const fs = Number(fontSize)
  const valid = Number.isFinite(rot) && Math.abs(rot) <= 180 && Number.isFinite(fs) && fs >= 6 && fs <= 300 && (kind === 'text' ? text.trim().length > 0 : !!image)
  return (
    <ToolShell
      tool={tool}
      runLabel="Add watermark"
      canRun={valid}
      options={() => (
        <div className="space-y-4">
          <RadioCards legend="Watermark type" value={kind} onChange={setKind} options={[{ value: 'text', label: 'Text' }, { value: 'image', label: 'Image' }]} />
          {kind === 'text' ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <TextField label="Text" value={text} onChange={setText} testId="wm-text" />
              </div>
              <TextField label="Font size" type="number" min={6} max={300} value={fontSize} onChange={setFontSize} />
              <ColorField label="Colour" value={color} onChange={setColor} />
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Image (PNG or JPG)">
                <input type="file" accept="image/png,image/jpeg" data-testid="wm-image" aria-label="Watermark image" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="block text-sm" />
              </Field>
              <Field label={`Image size: ${imageScale}% of the page`}>
                <input type="range" min={10} max={100} value={imageScale} onChange={(e) => setImageScale(Number(e.target.value))} aria-label="Image size" className="w-full max-w-xs" />
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`Opacity: ${opacity}%`}>
              <input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Opacity" className="w-full" />
            </Field>
            <TextField label="Rotation (°)" type="number" min={-180} max={180} value={rotation} onChange={setRotation} error={Number.isFinite(rot) && Math.abs(rot) <= 180 ? null : 'Enter −180 to 180'} />
            <SelectField label="Layout" value={layout} onChange={setLayout} options={[{ value: 'center', label: 'Centered' }, { value: 'tile', label: 'Tiled' }]} />
          </div>
          <TextField label="Pages" value={pages} onChange={setPages} hint={PAGES_HINT} />
        </div>
      )}
      run={async (ctx) => {
        let imageDocId: string | undefined
        if (kind === 'image' && image) {
          ctx.progress(0.02, 'Uploading watermark image')
          imageDocId = (await uploadDocument(image, image.name, undefined, ctx.signal)).id
        }
        return runServerTool(ctx, {
          endpoint: '/security/watermark',
          body: (d) => ({
            document_id: d[0].id,
            ...(kind === 'text' ? { text: text.trim(), font_size: fs, color } : { image_document_id: imageDocId, image_scale: imageScale / 100 }),
            opacity: opacity / 100,
            rotation: rot,
            layout,
            pages: cleanPages(pages),
          }),
        })
      }}
    />
  )
}

// ───────────────────────────────────────────────────────────── Metadata
interface Meta {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
}
const META_KEYS: (keyof Meta)[] = ['title', 'author', 'subject', 'keywords', 'creator', 'producer']
const EMPTY_META: Meta = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '' }

function MetadataFields({ file, orig, vals, setVals, clearAll, setClearAll, setOrig }: { file: StoredFileMeta; orig: Meta | null; vals: Meta; setVals: (m: Meta) => void; clearAll: boolean; setClearAll: (v: boolean) => void; setOrig: (m: Meta) => void }) {
  const { token } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<{ pages?: number; pdf_version?: string; encrypted?: boolean } | null>(null)
  useEffect(() => {
    if (!token) return
    let live = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const doc = await ensureServerDocument(file)
        const m = await apiJson<Record<string, unknown>>(`/security/metadata/${doc.id}`)
        if (!live) return
        const base = { ...EMPTY_META }
        for (const k of META_KEYS) base[k] = typeof m[k] === 'string' ? (m[k] as string) : ''
        setOrig(base)
        setVals(base)
        setInfo({ pages: m.pages as number, pdf_version: m.pdf_version as string, encrypted: m.encrypted as boolean })
      } catch (e) {
        if (live) setError(friendlyMessage(e))
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, token])
  if (!token) return <p className="text-sm text-ink-600 dark:text-ink-300">Sign in to read and edit the document properties.</p>
  return (
    <div className="space-y-4">
      {loading && <p role="status" className="text-sm text-ink-500">Reading properties…</p>}
      {error && <Notice kind="error">{error}</Notice>}
      {info && (
        <p className="text-xs text-ink-500 dark:text-ink-400" data-testid="meta-info">
          {info.pages} page(s) · PDF {info.pdf_version}
          {info.encrypted ? ' · encrypted' : ''}
        </p>
      )}
      {orig && (
        <div className="grid gap-4 sm:grid-cols-2">
          {META_KEYS.map((k) => (
            <TextField key={k} label={k[0].toUpperCase() + k.slice(1)} value={vals[k]} onChange={(v) => setVals({ ...vals, [k]: v })} testId={`meta-${k}`} />
          ))}
        </div>
      )}
      <Checkbox label="Remove all metadata" checked={clearAll} onChange={setClearAll} hint="Clears every property above (and the XMP packet)." />
    </div>
  )
}

export const MetadataTool: ToolPage = ({ tool }) => {
  const [orig, setOrig] = useState<Meta | null>(null)
  const [vals, setVals] = useState<Meta>(EMPTY_META)
  const [clearAll, setClearAll] = useState(false)
  const changed = META_KEYS.filter((k) => orig && vals[k] !== orig[k])
  return (
    <ToolShell
      tool={tool}
      runLabel="Save metadata"
      canRun={!!orig && (changed.length > 0 || clearAll)}
      onFilesChange={() => {
        setOrig(null)
        setVals(EMPTY_META)
        setClearAll(false)
      }}
      options={({ files }) => <MetadataFields file={files[0]} orig={orig} vals={vals} setVals={setVals} clearAll={clearAll} setClearAll={setClearAll} setOrig={setOrig} />}
      run={(ctx) =>
        runServerTool(ctx, {
          endpoint: '/security/metadata',
          body: (d) => ({ document_id: d[0].id, clear_all: clearAll, ...Object.fromEntries(changed.map((k) => [k, vals[k]])) }),
          infos: (res) => {
            const m = (res.details as { metadata?: Record<string, unknown> }).metadata
            return m ? [`Saved: ${META_KEYS.filter((k) => m[k]).map((k) => `${k} = “${String(m[k])}”`).join(' · ') || 'all properties cleared'}`] : []
          },
        })
      }
    />
  )
}
