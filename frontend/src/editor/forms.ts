import { PDFButton, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField, type PDFPage } from 'pdf-lib'
import { boxPdfToPs, pageGeometry } from './geometry'
import type { Box } from './types'

export type DetectedKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist'

export interface DetectedWidget {
  /** 0-based page index */
  page: number
  /** rectangle in page space */
  rect: Box
  /** for checkboxes / radio buttons: the export value that means "on" */
  onValue?: string
}

export interface DetectedField {
  /** fully qualified name — the key used in EditorDoc.formValues */
  name: string
  kind: DetectedKind
  value: string | boolean | string[]
  options: string[]
  multiline: boolean
  readOnly: boolean
  /** the form says this field must be filled in */
  required: boolean
  maxLength?: number
  widgets: DetectedWidget[]
}

/** A field this tool cannot fill in (a push button, a signature field ...). */
export interface UnsupportedField {
  name: string
  kind: 'button' | 'signature' | 'other'
}

export interface FormInfo {
  fields: DetectedField[]
  /** fields that exist but cannot be filled here: reported, never silently ignored */
  unsupported: UnsupportedField[]
  /** an XFA form (Adobe's dynamic forms): the fields live in XML this tool does not read */
  xfa: boolean
}

function widgetPageMap(pages: PDFPage[]): Map<PDFDict, number> {
  const map = new Map<PDFDict, number>()
  pages.forEach((p, i) => {
    const annots = p.node.Annots()
    if (!annots) return
    for (let k = 0; k < annots.size(); k++) {
      const d = p.node.context.lookupMaybe(annots.get(k), PDFDict)
      if (d) map.set(d, i)
    }
  })
  return map
}

/** Read the existing AcroForm fields (and where their widgets sit) from a PDF. Returns [] if there is no form. */
export function detectFields(doc: PDFDocument): DetectedField[] {
  return inspectForm(doc).fields
}

/** The fillable fields of a PDF, plus an honest account of what is there but cannot be filled. */
export function inspectForm(doc: PDFDocument): FormInfo {
  const pages = doc.getPages()
  let fields
  let xfa: boolean
  try {
    // read the XFA marker BEFORE asking pdf-lib for the form: pdf-lib removes it as soon as it opens the form
    xfa = !!doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.has(PDFName.of('XFA'))
    fields = doc.getForm().getFields()
  } catch {
    return { fields: [], unsupported: [], xfa: false }
  }
  const pageOf = widgetPageMap(pages)
  const geoms = pages.map(pageGeometry)
  const out: DetectedField[] = []
  const unsupported: UnsupportedField[] = []
  for (const f of fields) {
    let kind: DetectedKind
    let value: DetectedField['value']
    let options: string[] = []
    let multiline = false
    let maxLength: number | undefined
    if (f instanceof PDFTextField) {
      kind = 'text'
      value = f.getText() ?? ''
      multiline = f.isMultiline()
      maxLength = f.getMaxLength()
    } else if (f instanceof PDFCheckBox) {
      kind = 'checkbox'
      value = f.isChecked()
    } else if (f instanceof PDFRadioGroup) {
      kind = 'radio'
      value = f.getSelected() ?? ''
      options = f.getOptions()
    } else if (f instanceof PDFDropdown) {
      kind = 'dropdown'
      value = f.getSelected()[0] ?? ''
      options = f.getOptions()
    } else if (f instanceof PDFOptionList) {
      kind = 'optionlist'
      value = f.getSelected()
      options = f.getOptions()
    } else {
      // buttons and signature fields cannot be filled here: say so instead of pretending they are not there
      unsupported.push({ name: f.getName(), kind: f instanceof PDFButton ? 'button' : f instanceof PDFSignature ? 'signature' : 'other' })
      continue
    }
    const widgets: DetectedWidget[] = []
    const ws = f.acroField.getWidgets()
    ws.forEach((w, i) => {
      const page = pageOf.get(w.dict)
      if (page === undefined) return
      const r = w.getRectangle()
      let onValue: string | undefined
      if (kind === 'radio') onValue = options[i] ?? undefined
      else if (kind === 'checkbox') onValue = undefined
      widgets.push({ page, rect: boxPdfToPs(geoms[page], { x: r.x, y: r.y, w: r.width, h: r.height }), onValue })
    })
    if (!widgets.length) continue
    out.push({ name: f.getName(), kind, value, options, multiline, readOnly: f.isReadOnly(), required: f.isRequired(), maxLength, widgets })
  }
  return { fields: out, unsupported, xfa }
}
