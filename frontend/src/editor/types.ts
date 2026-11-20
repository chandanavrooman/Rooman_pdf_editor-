/**
 * Editor object model.
 *
 * COORDINATES: every object lives in "page space" (PS): points (1/72"), origin at the TOP-LEFT of the page as it is
 * displayed (i.e. with the page's own /Rotate applied, cropbox applied), y pointing DOWN. This is exactly pdf.js'
 * viewport at scale 1, so it is independent of zoom, and `geometry.ts` converts PS <-> PDF user space for export
 * (handling /Rotate and crop-box offsets).
 */
export type Color = string // '#rrggbb'
import type { FontId } from './fontCatalog'
import type { TableData } from './tableModel'
export type Family = 'helvetica' | 'times' | 'courier'
export type Align = 'left' | 'center' | 'right'

export interface Pt {
  x: number
  y: number
}
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Base extends Box {
  id: string
  /** 0-based page index */
  page: number
}

export interface TextObj extends Base {
  type: 'text'
  text: string
  family: Family
  size: number
  color: Color
  bold: boolean
  italic: boolean
  align: Align
  /** true: box grows with the text (no wrapping). false: wrap inside `w`. */
  autoWidth: boolean
  /** optional background fill color (e.g. '#ffffff' to cleanly cover original underlying text when editing) */
  fill?: Color
  /** bundled open-license font to embed; when unset the PDF standard font for `family` is used */
  fontId?: FontId
  /** page-space y of the first line's baseline. When set, `y` is derived from it so the text sits exactly on the original baseline. */
  baseline?: number
  /** label of the font found in the PDF (subset prefix removed), shown as "Font used" */
  fontUsed?: string
  /** the PDF does not embed this font (a standard font like Times New Roman / Arial the viewer supplies): edits then use the matching standard font so they look exactly like the text around them in every viewer */
  sysFont?: boolean
  /** key of the PDF's own embedded (TrueType) font for this run: edits use it when it holds every typed character (see embeddedFonts.ts) */
  embedKey?: string
  /** set when this object edits an EXISTING text run: export then only replaces the characters that changed */
  orig?: OrigText
  /** line spacing in points when it is not the default 1.2 × size (text blocks taken from a table cell keep the table's own spacing) */
  leading?: number
  /** extra space after every character in points (the PDF's Tc / Tw / justification), so edited text keeps the original's rhythm */
  letterSpacing?: number
  /** fill opacity 0..1 when the PDF paints the text with transparency (default 1) */
  opacity?: number
}
/** The existing PDF text run an edit started from (all page space, points). */
export interface OrigText {
  str: string
  /** left end of the run on its baseline */
  x: number
  baseline: number
  /** advance width of the run as laid out in the PDF */
  w: number
  /** style the run had; if none of it changed, only the changed characters are replaced */
  fontId: FontId
  size: number
  bold: boolean
  italic: boolean
  color: Color
  /** set when the edit is a whole table cell: every original line of the cell, and the cell's own text width */
  block?: { runs: { x: number; baseline: number; w: number }[]; leading: number; w: number }
}
export interface WhiteoutObj extends Base {
  type: 'whiteout'
  fill: Color
}
export interface ShapeObj extends Base {
  type: 'rect' | 'ellipse'
  stroke: Color | null
  strokeWidth: number
  fill: Color | null
}
export interface LineObj extends Base {
  type: 'line' | 'arrow'
  pts: [Pt, Pt]
  stroke: Color
  strokeWidth: number
}
export interface DrawObj extends Base {
  type: 'draw'
  pts: Pt[]
  stroke: Color
  strokeWidth: number
}
export interface MarkObj extends Base {
  type: 'highlight' | 'underline' | 'strike'
  color: Color
}
export interface ImageObj extends Base {
  type: 'image' | 'signature'
  assetId: string
  keepAspect: boolean
  /** the place a picture of the page had (or the box a replaced picture had): a replacement is fitted into it */
  slot?: { x: number; y: number; w: number; h: number }
  /** degrees, clockwise, about the centre of the box (default 0) */
  rotation?: number
  /** 0..1 (default 1) */
  opacity?: number
}
export type LinkTarget = { kind: 'url'; url: string } | { kind: 'page'; page: number }
export interface LinkObj extends Base {
  type: 'link'
  target: LinkTarget
  /** draw a thin outline around the clickable area so it is visible in any viewer (default: yes) */
  showBorder?: boolean
}
export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown'
export interface FieldObj extends Base {
  type: 'field'
  fieldKind: FieldKind
  /** field name; for radio buttons this is the group name */
  name: string
  /** dropdown choices (one per entry); for radio: the single option label */
  options: string[]
  /** default value: text, dropdown selection, checkbox checked, radio option selected */
  value: string | boolean
  /** the person filling the form must complete it (the PDF "required" flag) */
  required?: boolean
  /** a hint shown when the pointer rests on the field in a PDF viewer (the PDF "tooltip"); PDF has no faded placeholder text */
  tooltip?: string
  /** text fields: what may be typed. Enforced by the PDF viewer (needs JavaScript to be on there). */
  validation?: FieldValidation
  /** text fields: the most characters allowed */
  maxLength?: number
  /** text fields: several lines */
  multiline?: boolean
}
export type FieldValidation = 'none' | 'number' | 'email'

/** A table that was detected on the page and edited as a whole: rows, columns, shading, borders and the text of every cell. */
export interface TableObj extends Base {
  type: 'table'
  data: TableData
  /** the cell the toolbar commands apply to (UI state only, never exported) */
  active?: { r: number; c: number }
}

export type EditorObject = TableObj | TextObj | WhiteoutObj | ShapeObj | LineObj | DrawObj | MarkObj | ImageObj | LinkObj | FieldObj
export type ObjectType = EditorObject['type']

export type FieldValue = string | boolean | string[]

export interface Asset {
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
}

/** What the export engine needs. */
export interface EditorDoc {
  objects: EditorObject[]
  /** values for EXISTING form fields that the user changed, keyed by fully-qualified field name */
  formValues: Record<string, FieldValue>
  assets: Record<string, Asset>
}

export const PT_TYPES = ['line', 'arrow', 'draw'] as const
export const hasPts = (o: EditorObject): o is LineObj | DrawObj => o.type === 'line' || o.type === 'arrow' || o.type === 'draw'
