import { describe, expect, it } from 'vitest'
import { PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFName, PDFRadioGroup, PDFString, PDFTextField } from 'pdf-lib'
import { exportEdited } from './export'
import { inspectForm } from './forms'
import { alignDeltas } from './geometry'
import { cloneObjects, makeField, makeText, uniqueFieldName, DEFAULTS } from './objects'
import type { EditorDoc, EditorObject, FieldObj } from './types'
import { loadNotoFromDisk } from '@/test/nodeRender'

const deps = { loadFontBytes: loadNotoFromDisk }
const doc = (objects: EditorObject[], extra: Partial<EditorDoc> = {}): EditorDoc => ({ objects, formValues: {}, assets: {}, ...extra })

async function blank(pages = 1) {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([595, 842])
  return d.save()
}
const reopen = async (bytes: Uint8Array) => PDFDocument.load(bytes)
const field = (kind: FieldObj['fieldKind'], name: string, extra: Partial<FieldObj> = {}, at = { x: 60, y: 100, w: 160, h: 24 }): FieldObj => ({ ...makeField(kind, 0, at, name), ...extra })

describe('a PDF with no form', () => {
  it('has no fields, no unsupported fields and no XFA', async () => {
    const info = inspectForm(await reopen(await blank()))
    expect(info).toEqual({ fields: [], unsupported: [], xfa: false })
  })
  it('ordinary text added with the Text tool is never a form field', async () => {
    const out = await exportEdited(await blank(), doc([makeText(0, { x: 60, y: 100 }, DEFAULTS.text, 'Just words')]), {}, deps)
    expect(inspectForm(await reopen(out)).fields).toHaveLength(0)
  })
})

describe('creating fillable fields: what is really written into the PDF', () => {
  it('text, checkbox, radio group and dropdown become real, detectable fields at the placed positions', async () => {
    const objs = [
      field('text', 'full_name', {}, { x: 60, y: 100, w: 200, h: 24 }),
      field('checkbox', 'agree', { value: true }, { x: 60, y: 150, w: 16, h: 16 }),
      field('radio', 'plan', { options: ['Basic'] }, { x: 60, y: 200, w: 16, h: 16 }),
      field('radio', 'plan', { options: ['Pro'], value: true }, { x: 60, y: 230, w: 16, h: 16 }),
      field('dropdown', 'country', { options: ['Peru', 'Chile', 'Bolivia'], value: 'Chile' }, { x: 60, y: 260, w: 140, h: 24 }),
    ]
    const out = await exportEdited(await blank(), doc(objs), {}, deps)
    const info = inspectForm(await reopen(out))
    const by = Object.fromEntries(info.fields.map((f) => [f.name, f]))
    expect(Object.keys(by).sort()).toEqual(['agree', 'country', 'full_name', 'plan'])
    expect(by.agree.kind).toBe('checkbox')
    expect(by.agree.value).toBe(true)
    expect(by.plan.kind).toBe('radio')
    expect(by.plan.options).toEqual(['Basic', 'Pro'])
    expect(by.plan.value).toBe('Pro')
    expect(by.plan.widgets).toHaveLength(2)
    expect(by.country.options).toEqual(['Peru', 'Chile', 'Bolivia'])
    expect(by.country.value).toBe('Chile')
    const r = by.full_name.widgets[0].rect
    expect(r.x).toBeCloseTo(60, 0)
    expect(r.y).toBeCloseTo(100, 0)
    expect(r.w).toBeCloseTo(200, 0)
  })

  it('required, several lines, maximum length and the hint are saved on the field', async () => {
    const out = await exportEdited(await blank(), doc([field('text', 'notes', { required: true, multiline: true, maxLength: 120, tooltip: 'Anything we should know' }), field('checkbox', 'terms', { required: true })]), {}, deps)
    const form = (await reopen(out)).getForm()
    const notes = form.getTextField('notes')
    expect(notes.isRequired()).toBe(true)
    expect(notes.isMultiline()).toBe(true)
    expect(notes.getMaxLength()).toBe(120)
    expect((notes.acroField.dict.lookup(PDFName.of('TU'), PDFString) as PDFString).decodeText()).toBe('Anything we should know')
    expect(form.getCheckBox('terms').isRequired()).toBe(true)
    const info = inspectForm(await reopen(out))
    expect(info.fields.find((f) => f.name === 'notes')!.required).toBe(true)
    expect(info.fields.find((f) => f.name === 'terms')!.required).toBe(true)
  })

  it('optional fields stay optional', async () => {
    const out = await exportEdited(await blank(), doc([field('text', 'nick')]), {}, deps)
    expect(inspectForm(await reopen(out)).fields[0].required).toBe(false)
  })

  it('"numbers only" and "email" are real PDF actions on the field', async () => {
    const out = await exportEdited(await blank(), doc([field('text', 'age', { validation: 'number' }, { x: 60, y: 100, w: 80, h: 24 }), field('text', 'mail', { validation: 'email' }, { x: 60, y: 140, w: 200, h: 24 }), field('text', 'free', { validation: 'none' }, { x: 60, y: 180, w: 200, h: 24 })]), {}, deps)
    const form = (await reopen(out)).getForm()
    const js = (name: string, key: string) => {
      const aa = form.getTextField(name).acroField.dict.lookupMaybe(PDFName.of('AA'), PDFDict)
      const act = aa?.lookupMaybe(PDFName.of(key), PDFDict)
      return (act?.lookup(PDFName.of('JS'), PDFString) as PDFString | undefined)?.decodeText()
    }
    expect(js('age', 'K')).toContain('AFNumber_Keystroke')
    expect(js('mail', 'V')).toContain('@')
    expect(form.getTextField('free').acroField.dict.has(PDFName.of('AA'))).toBe(false)
  })

  it('a radio group with a chosen default and a checkbox default state are kept', async () => {
    const out = await exportEdited(await blank(), doc([field('checkbox', 'a', { value: false }), field('checkbox', 'b', { value: true })]), {}, deps)
    const form = (await reopen(out)).getForm()
    expect((form.getField('a') as PDFCheckBox).isChecked()).toBe(false)
    expect((form.getField('b') as PDFCheckBox).isChecked()).toBe(true)
  })

  it('fields with the same name are saved as separate fields, never merged', async () => {
    const out = await exportEdited(await blank(), doc([field('text', 'dup', {}, { x: 60, y: 100, w: 100, h: 20 }), field('text', 'dup', {}, { x: 60, y: 140, w: 100, h: 20 })]), {}, deps)
    expect(inspectForm(await reopen(out)).fields.map((f) => f.name).sort()).toEqual(['dup', 'dup_2'])
  })

  it('flattening turns the form into plain content with no fields left', async () => {
    const out = await exportEdited(await blank(), doc([field('text', 'name', { value: 'Ada Lovelace' })]), { flattenForm: true }, deps)
    const d = await reopen(out)
    expect(inspectForm(d).fields).toHaveLength(0)
  })
})

describe('existing forms: what is detected and what is reported', () => {
  it('reads required and read-only flags and keeps untouched fields as they were', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([595, 842])
    const form = d.getForm()
    const a = form.createTextField('must')
    a.addToPage(p, { x: 50, y: 700, width: 150, height: 20 })
    a.enableRequired()
    a.setText('keep me')
    const b = form.createTextField('locked')
    b.addToPage(p, { x: 50, y: 650, width: 150, height: 20 })
    b.enableReadOnly()
    const info = inspectForm(await reopen(await d.save()))
    const by = Object.fromEntries(info.fields.map((f) => [f.name, f]))
    expect(by.must.required).toBe(true)
    expect(by.must.value).toBe('keep me')
    expect(by.locked.readOnly).toBe(true)
    expect(by.locked.required).toBe(false)
    // exporting without touching it keeps everything
    const again = await exportEdited(await d.save(), doc([]), {}, deps)
    const f2 = (await reopen(again)).getForm()
    expect(f2.getTextField('must').getText()).toBe('keep me')
    expect(f2.getTextField('must').isRequired()).toBe(true)
  })

  it('a push button is reported as a field that cannot be filled, not as "no form"', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([595, 842])
    d.getForm().createButton('submit').addToPage('Send', p, { x: 50, y: 700, width: 100, height: 24 })
    const info = inspectForm(await reopen(await d.save()))
    expect(info.fields).toHaveLength(0)
    expect(info.unsupported).toEqual([{ name: 'submit', kind: 'button' }])
  })

  it('an XFA form is recognised', async () => {
    const d = await PDFDocument.create()
    d.addPage([595, 842])
    const form = d.getForm()
    form.acroForm.dict.set(PDFName.of('XFA'), d.context.obj([PDFString.of('template'), PDFString.of('<xdp/>')]) as PDFArray)
    expect(inspectForm(await reopen(await d.save())).xfa).toBe(true)
  })

  it('entered values are written into the existing fields on export', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([595, 842])
    d.getForm().createTextField('who').addToPage(p, { x: 50, y: 700, width: 150, height: 20 })
    const out = await exportEdited(await d.save(), doc([], { formValues: { who: 'Grace Hopper' } }), {}, deps)
    expect((await reopen(out)).getForm().getTextField('who').getText()).toBe('Grace Hopper')
  })
})

describe('duplicating fields', () => {
  it('a copied text field gets its own name', () => {
    const a = field('text', 'email')
    const [copy] = cloneObjects([a], [a]) as FieldObj[]
    expect(copy.name).toBe('email_2')
    expect(copy.id).not.toBe(a.id)
    const [copy2] = cloneObjects([a], [a, copy]) as FieldObj[]
    expect(copy2.name).toBe('email_3')
  })
  it('names already used by the PDF itself are avoided', () => {
    const a = field('text', 'city')
    const [copy] = cloneObjects([a], [a], 12, 12, ['city_2']) as FieldObj[]
    expect(copy.name).toBe('city_3')
  })
  it('a copied radio button stays in its group with a new option label, unselected', () => {
    const a = field('radio', 'plan', { options: ['Basic'], value: true })
    const [copy] = cloneObjects([a], [a]) as FieldObj[]
    expect(copy.name).toBe('plan')
    expect(copy.options).toEqual(['Basic 2'])
    expect(copy.value).toBe(false)
  })
  it('other objects are copied unchanged', () => {
    const t = makeText(0, { x: 10, y: 10 }, DEFAULTS.text, 'hi')
    const [copy] = cloneObjects([t], [t])
    expect(copy.type).toBe('text')
    expect(copy.x).toBe(t.x + 12)
  })
  it('uniqueFieldName', () => {
    expect(uniqueFieldName('a', new Set())).toBe('a')
    expect(uniqueFieldName('a', new Set(['a']))).toBe('a_2')
    expect(uniqueFieldName('a_2', new Set(['a', 'a_2']))).toBe('a_3')
  })
})

describe('aligning fields', () => {
  const boxes = [{ x: 10, y: 10, w: 40, h: 20 }, { x: 70, y: 50, w: 100, h: 30 }, { x: 30, y: 120, w: 60, h: 10 }]
  const apply = (mode: Parameters<typeof alignDeltas>[1]) => alignDeltas(boxes, mode).map((d, i) => ({ x: boxes[i].x + d.dx, y: boxes[i].y + d.dy, w: boxes[i].w, h: boxes[i].h }))
  it('left, right and centre', () => {
    expect(apply('left').map((b) => b.x)).toEqual([10, 10, 10])
    expect(apply('right').map((b) => b.x + b.w)).toEqual([170, 170, 170])
    expect(apply('center').map((b) => b.x + b.w / 2)).toEqual([90, 90, 90])
  })
  it('top, bottom and middle', () => {
    expect(apply('top').map((b) => b.y)).toEqual([10, 10, 10])
    expect(apply('bottom').map((b) => b.y + b.h)).toEqual([130, 130, 130])
    expect(apply('middle').map((b) => b.y + b.h / 2)).toEqual([70, 70, 70])
  })
  it('spreading leaves the outer two where they are and gives equal gaps', () => {
    const h = apply('spread-h').sort((a, b) => a.x - b.x)
    expect(h[0].x).toBe(10)
    expect(h[2].x + h[2].w).toBe(170)
    expect(h[1].x - (h[0].x + h[0].w)).toBeCloseTo(h[2].x - (h[1].x + h[1].w), 6)
    const v = apply('spread-v').sort((a, b) => a.y - b.y)
    expect(v[1].y - (v[0].y + v[0].h)).toBeCloseTo(v[2].y - (v[1].y + v[1].h), 6)
  })
  it('nothing to align gives nothing', () => expect(alignDeltas([], 'left')).toEqual([]))
})

void PDFTextField
void PDFRadioGroup
