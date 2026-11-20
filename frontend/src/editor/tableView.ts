import { loadFontForDisplay, type FontId } from './fontCatalog'
import { newId } from './state'
import type { Cell } from './tables'
import { layoutTable, tableFromCells, type Measure, type TableData } from './tableModel'
import { measureText } from './textLayout'
import type { TableObj } from './types'

/** Width of a string in a cell's font, measured in the browser the same way the export measures with the embedded font (no kerning). */
export const browserMeasure: Measure = (cell, s) => measureText(s, { family: 'helvetica', fontId: cell.fontId, size: cell.size, bold: cell.bold, italic: cell.italic })

/** The object patch that puts new table data in place AND refreshes the object's outer box (rows may have grown). */
export function retable(data: TableData): Pick<TableObj, 'data' | 'x' | 'y' | 'w' | 'h'> {
  const b = layoutTable(data, browserMeasure).bounds
  return { data, x: b.x, y: b.y, w: b.w, h: b.h }
}

/** Bounds of a detected table (page space). */
export function gridBounds(cells: Cell[]) {
  const x = Math.min(...cells.map((c) => c.x))
  const y = Math.min(...cells.map((c) => c.y))
  return { x, y, w: Math.max(...cells.map((c) => c.x + c.w)) - x, h: Math.max(...cells.map((c) => c.y + c.h)) - y }
}

/** Make the detected table around `cell` an editable table object (nothing changes on the page until the user edits it). */
export async function tableObjFromCell(cell: Cell, page: number): Promise<TableObj> {
  const data = tableFromCells(cell.grid)
  const fonts = new Map<string, [FontId, boolean, boolean]>()
  for (const row of data.rows) for (const c of row.cells) fonts.set(`${c.fontId}${c.bold}${c.italic}`, [c.fontId, c.bold, c.italic])
  await Promise.all([...fonts.values()].map(([id, b, i]) => loadFontForDisplay(id, b, i)))
  return { id: newId('tb'), type: 'table', page, ...retable(data), active: { r: cell.row, c: cell.col } }
}
