import { createContext, useContext, type Dispatch } from 'react'
import type { Action, EditorState } from './state'
import type { ToolDefaults } from './objects'
import type { DetectedField } from './forms'
import type { ImageRect } from './imageSnap'
import type { SnapItem } from './textSnap'

export type ToolId =
  | 'select'
  | 'delete-image'
  | 'text'
  | 'whiteout'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'draw'
  | 'image'
  | 'link'
  | 'signature'
  | 'field-text'
  | 'field-checkbox'
  | 'field-radio'
  | 'field-dropdown'
  | 'table'

export interface PendingAsset {
  id: string
  kind: 'image' | 'signature'
  /** natural size ratio w/h */
  aspect: number
  /** natural width in points to start from */
  width: number
}

export interface EditorCtx {
  state: EditorState
  dispatch: Dispatch<Action>
  tool: ToolId
  setTool: (t: ToolId) => void
  defaults: ToolDefaults
  setDefaults: (fn: (d: ToolDefaults) => ToolDefaults) => void
  assetUrl: (id: string) => string | undefined
  pendingAsset: PendingAsset | null
  setPendingAsset: (a: PendingAsset | null) => void
  fields: DetectedField[]
  snap: (pageIndex: number) => Promise<SnapItem[]>
  /** text runs of a page WITH its tables cut into cells: asked for only when the Table tool is picked */
  tableItems: (pageIndex: number) => Promise<SnapItem[]>
  /** development only: every text item pdf.js returns (including empty ones) with its raw values */
  debug: boolean
  rawItems: (pageIndex: number) => Promise<SnapItem[]>
  /** pictures already in the PDF, and a way to lift one out so it can be moved, resized, deleted or replaced */
  images: (pageIndex: number) => Promise<ImageRect[]>
  liftImage: (pageIndex: number, r: ImageRect, opts?: { backgroundOnly?: boolean }) => Promise<{ assetId: string; bg: string } | null>
  addAsset: (bytes: Uint8Array, mime: 'image/png' | 'image/jpeg') => string
  editingId: string | null
  setEditingId: (id: string | null) => void
  numPages: number
  /** tell the user something (non-blocking) */
  notify: (msg: string) => void
  /** a warning that stays until it is dismissed or undone (e.g. a field was placed over existing text) */
  warn: (msg: string) => void
}

export const EditorContext = createContext<EditorCtx | null>(null)

export function useEditor(): EditorCtx {
  const c = useContext(EditorContext)
  if (!c) throw new Error('useEditor must be used inside the editor')
  return c
}

/** Tools that stay active after drawing one object. */
export const STICKY_TOOLS: ToolId[] = ['draw', 'highlight', 'underline', 'strike']
