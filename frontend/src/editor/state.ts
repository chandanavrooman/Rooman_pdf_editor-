import type { Asset, EditorObject, FieldValue } from './types'
import { dedupeObjects } from './annotations'

export interface Snapshot {
  objects: EditorObject[]
  formValues: Record<string, FieldValue>
}

export interface EditorState {
  present: Snapshot
  past: Snapshot[]
  future: Snapshot[]
  /** id of the interaction that produced the last change; changes with the same txn are merged into one undo step */
  txn: string | null
  selection: string[]
  /** increments on every change to `present` (used for the unsaved-changes guard) */
  revision: number
}

export const HISTORY_LIMIT = 200

export const initialState = (): EditorState => ({ present: { objects: [], formValues: {} }, past: [], future: [], txn: null, selection: [], revision: 0 })

export type Patch = Partial<EditorObject> | ((o: EditorObject) => Partial<EditorObject> | EditorObject)

export type Action =
  | { type: 'add'; objects: EditorObject[]; select?: boolean; txn?: string }
  | { type: 'remove'; ids: string[] }
  | { type: 'update'; ids: string[]; patch: Patch; txn?: string }
  | { type: 'setField'; name: string; value: FieldValue; txn?: string }
  | { type: 'reorder'; ids: string[]; to: 'front' | 'back' | 'forward' | 'backward' }
  | { type: 'select'; ids: string[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }

function commit(s: EditorState, next: Snapshot, txn: string | null): EditorState {
  if (txn && s.txn === txn) return { ...s, present: next, revision: s.revision + 1 }
  const past = [...s.past, s.present]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { ...s, present: next, past, future: [], txn, revision: s.revision + 1 }
}

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case 'add': {
      // the same highlight / underline / strike-out / link is never added twice
      const fresh = dedupeObjects(a.objects, s.present.objects)
      if (!fresh.length) return s
      const next = commit(s, { ...s.present, objects: [...s.present.objects, ...fresh] }, a.txn ?? null)
      return a.select === false ? next : { ...next, selection: fresh.map((o) => o.id) }
    }
    case 'remove': {
      const ids = new Set(a.ids)
      if (!s.present.objects.some((o) => ids.has(o.id))) return s
      const next = commit(s, { ...s.present, objects: s.present.objects.filter((o) => !ids.has(o.id)) }, null)
      return { ...next, selection: s.selection.filter((i) => !ids.has(i)) }
    }
    case 'update': {
      const ids = new Set(a.ids)
      let changed = false
      const objects = s.present.objects.map((o) => {
        if (!ids.has(o.id)) return o
        const p = typeof a.patch === 'function' ? a.patch(o) : a.patch
        const merged = { ...o, ...p } as EditorObject
        if (Object.keys(p).every((k) => (o as unknown as Record<string, unknown>)[k] === (p as Record<string, unknown>)[k])) return o
        changed = true
        return merged
      })
      if (!changed) return s
      return commit(s, { ...s.present, objects }, a.txn ?? null)
    }
    case 'setField': {
      const cur = s.present.formValues[a.name]
      if (cur !== undefined && JSON.stringify(cur) === JSON.stringify(a.value)) return s
      return commit(s, { ...s.present, formValues: { ...s.present.formValues, [a.name]: a.value } }, a.txn ?? null)
    }
    case 'reorder': {
      const ids = new Set(a.ids)
      const list = s.present.objects
      const sel = list.filter((o) => ids.has(o.id))
      if (!sel.length) return s
      const rest = list.filter((o) => !ids.has(o.id))
      let out: EditorObject[]
      if (a.to === 'front') out = [...rest, ...sel]
      else if (a.to === 'back') out = [...sel, ...rest]
      else {
        out = [...list]
        const idx = out.map((o, i) => (ids.has(o.id) ? i : -1)).filter((i) => i >= 0)
        if (a.to === 'forward') {
          for (const i of idx.reverse()) if (i < out.length - 1 && !ids.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]]
        } else {
          for (const i of idx) if (i > 0 && !ids.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]]
        }
      }
      if (out.every((o, i) => o === list[i])) return s
      return commit(s, { ...s.present, objects: out }, null)
    }
    case 'select':
      return { ...s, selection: a.ids }
    case 'undo': {
      if (!s.past.length) return s
      const prev = s.past[s.past.length - 1]
      const alive = new Set(prev.objects.map((o) => o.id))
      return { ...s, present: prev, past: s.past.slice(0, -1), future: [s.present, ...s.future], txn: null, selection: s.selection.filter((i) => alive.has(i)), revision: s.revision + 1 }
    }
    case 'redo': {
      if (!s.future.length) return s
      const nx = s.future[0]
      const alive = new Set(nx.objects.map((o) => o.id))
      return { ...s, present: nx, past: [...s.past, s.present], future: s.future.slice(1), txn: null, selection: s.selection.filter((i) => alive.has(i)), revision: s.revision + 1 }
    }
    case 'reset':
      return { ...initialState(), revision: s.revision + 1 }
  }
}

export const canUndo = (s: EditorState) => s.past.length > 0
export const canRedo = (s: EditorState) => s.future.length > 0

let counter = 0
export function newId(prefix = 'o'): string {
  counter += 1
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `${prefix}${counter}-${rnd}`
}

export type AssetMap = Record<string, Asset>
