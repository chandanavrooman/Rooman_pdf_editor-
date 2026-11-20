import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, Upload, X } from 'lucide-react'
import '@fontsource/dancing-script/400.css'
import '@fontsource/caveat/400.css'
import '@fontsource/homemade-apple/400.css'
import { SIGNATURE_FONTS, canvasToPng, forgetSignature, imageFileToAsset, loadSavedSignatures, renderTypedSignature, saveSignature, trimCanvas } from './signature'

export interface SignatureResult {
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

type Tab = 'draw' | 'type' | 'upload'
const INKS = ['#111827', '#1d4ed8', '#7f1d1d']

export function SignatureDialog({ onCancel, onDone }: { onCancel: () => void; onDone: (r: SignatureResult) => void }) {
  const [tab, setTab] = useState<Tab>('draw')
  const [ink, setInk] = useState(INKS[0])
  const [text, setText] = useState('')
  const [fontId, setFontId] = useState<string>(SIGNATURE_FONTS[0].id)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string[]>(() => loadSavedSignatures())
  const [uploaded, setUploaded] = useState<SignatureResult | null>(null)
  const [drawn, setDrawn] = useState(false)
  const pad = useRef<HTMLCanvasElement>(null)
  const typedPreview = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('button, input')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  // typed preview
  useEffect(() => {
    if (tab !== 'type') return
    let cancelled = false
    const family = SIGNATURE_FONTS.find((f) => f.id === fontId)!.family
    renderTypedSignature(text, family, ink).then((c) => {
      const v = typedPreview.current
      if (cancelled || !v) return
      const ctx = v.getContext('2d')!
      ctx.clearRect(0, 0, v.width, v.height)
      if (!c) return
      const k = Math.min(v.width / c.width, v.height / c.height, 1)
      ctx.drawImage(c, (v.width - c.width * k) / 2, (v.height - c.height * k) / 2, c.width * k, c.height * k)
    })
    return () => {
      cancelled = true
    }
  }, [tab, text, fontId, ink])

  const pos = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * pad.current!.width) / r.width, y: ((e.clientY - r.top) * pad.current!.height) / r.height }
  }
  const down = (e: React.PointerEvent) => {
    pad.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = pos(e)
    last.current = p
    const ctx = pad.current!.getContext('2d')!
    ctx.fillStyle = ink
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2)
    ctx.fill()
    setDrawn(true)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return
    const p = pos(e)
    const ctx = pad.current!.getContext('2d')!
    ctx.strokeStyle = ink
    ctx.lineWidth = 3.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }
  const up = () => {
    drawing.current = false
    last.current = null
  }
  const clearPad = useCallback(() => {
    const c = pad.current
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setDrawn(false)
  }, [])

  const finish = async (r: SignatureResult, dataUrl?: string) => {
    if (remember && dataUrl) saveSignature(dataUrl)
    onDone(r)
  }

  const confirmCurrent = async () => {
    setError(null)
    try {
      if (tab === 'draw') {
        const t = pad.current && trimCanvas(pad.current)
        if (!t) return setError('Draw your signature first.')
        await finish({ bytes: await canvasToPng(t), mime: 'image/png', width: t.width, height: t.height }, t.toDataURL('image/png'))
      } else if (tab === 'type') {
        const family = SIGNATURE_FONTS.find((f) => f.id === fontId)!.family
        const c = await renderTypedSignature(text, family, ink)
        if (!c) return setError('Type your name first.')
        await finish({ bytes: await canvasToPng(c), mime: 'image/png', width: c.width, height: c.height }, c.toDataURL('image/png'))
      } else {
        if (!uploaded) return setError('Choose an image of your signature first.')
        await finish(uploaded)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const pickSaved = async (url: string) => {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob)
    onDone({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', width: bmp.width, height: bmp.height })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="sig-title" className="card w-full max-w-xl p-5 shadow-2xl" data-testid="signature-dialog">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="sig-title" className="text-lg font-bold">
            Add your signature
          </h2>
          <button type="button" className="btn-ghost btn-sm !px-2" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {saved.length > 0 && (
          <div className="mb-4">
            <p className="mb-1 text-xs font-medium text-ink-500">Saved on this device</p>
            <ul className="flex flex-wrap gap-2">
              {saved.map((s) => (
                <li key={s} className="flex items-center rounded-lg border border-ink-200 bg-white p-1 dark:border-ink-700">
                  <button type="button" onClick={() => void pickSaved(s)} aria-label="Use this saved signature" data-testid="saved-signature">
                    <img src={s} alt="Saved signature" className="h-9 max-w-[8rem] object-contain" />
                  </button>
                  <button type="button" className="p-1 text-ink-500 hover:text-red-600" aria-label="Forget this signature" onClick={() => { forgetSignature(s); setSaved(loadSavedSignatures()) }}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div role="tablist" aria-label="Signature type" className="mb-3 flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
          {(['draw', 'type', 'upload'] as Tab[]).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} data-testid={`sig-tab-${t}`} onClick={() => setTab(t)} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? 'bg-white shadow-sm dark:bg-ink-900' : 'text-ink-600 dark:text-ink-300'}`}>
              {t}
            </button>
          ))}
        </div>

        {tab !== 'upload' && (
          <div className="mb-3 flex items-center gap-2 text-xs text-ink-600 dark:text-ink-300" role="group" aria-label="Ink color">
            Ink
            {INKS.map((c) => (
              <button key={c} type="button" aria-label={`Ink ${c}`} aria-pressed={ink === c} onClick={() => setInk(c)} className={`h-6 w-6 rounded-full border-2 ${ink === c ? 'border-brand-600' : 'border-transparent'}`} style={{ background: c }} />
            ))}
          </div>
        )}

        {tab === 'draw' && (
          <div>
            <canvas ref={pad} width={760} height={260} data-testid="signature-pad" aria-label="Signature drawing area" className="h-40 w-full touch-none rounded-xl border border-dashed border-ink-300 bg-white dark:border-ink-600" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
            <button type="button" className="btn-ghost btn-sm mt-2" onClick={clearPad} disabled={!drawn}>
              Clear
            </button>
          </div>
        )}
        {tab === 'type' && (
          <div className="space-y-3">
            <label className="block">
              <span className="label">Your name</span>
              <input className="input" data-testid="signature-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your name" autoComplete="off" />
            </label>
            <div className="flex gap-2" role="group" aria-label="Style">
              {SIGNATURE_FONTS.map((f) => (
                <button key={f.id} type="button" aria-pressed={fontId === f.id} onClick={() => setFontId(f.id)} className={`flex-1 rounded-lg border px-2 py-1.5 text-lg ${fontId === f.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-ink-200 dark:border-ink-700'}`} style={{ fontFamily: f.family }}>
                  {text.trim() || f.label}
                </button>
              ))}
            </div>
            <canvas ref={typedPreview} width={760} height={200} aria-label="Signature preview" className="h-28 w-full rounded-xl border border-ink-200 bg-white dark:border-ink-700" />
          </div>
        )}
        {tab === 'upload' && (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink-300 p-6 text-center text-sm dark:border-ink-600">
              <Upload className="h-6 w-6 text-brand-600" aria-hidden="true" />
              <span>Choose a PNG or JPG of your signature</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                data-testid="signature-file"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    setUploaded(await imageFileToAsset(f))
                    setError(null)
                  } catch {
                    setError('That image could not be read.')
                  }
                }}
              />
            </label>
            {uploaded && <img alt="Uploaded signature preview" className="mx-auto max-h-28 rounded border border-ink-200 bg-white p-1" src={URL.createObjectURL(new Blob([uploaded.bytes.slice(0)], { type: uploaded.mime }))} />}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={() => void confirmCurrent()} data-testid="signature-use">
              Use signature
            </button>
          </div>
        </div>
        <p className="hint">Signatures are images created in your browser; nothing is uploaded. This is a visual signature, not a certificate-based digital signature.</p>
      </div>
    </div>
  )
}
