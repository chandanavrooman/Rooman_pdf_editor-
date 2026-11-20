import { expect, test, type Page } from '@playwright/test'
import { expectToolOn, openEditor, openToolMenu, writeEditorPdf } from './editorHelpers'

const TOOLS = ['select', 'text', 'whiteout', 'rect', 'ellipse', 'line', 'arrow', 'highlight', 'underline', 'strike', 'draw', 'table', 'link', 'image', 'delete-image', 'signature', 'field-text', 'field-checkbox', 'field-radio', 'field-dropdown']

/** Every tool button: fully inside the toolbar, not hidden by an overflow ancestor, label not truncated. */
async function clippedButtons(page: Page) {
  return page.evaluate(() => {
    const tb = document.querySelector('[data-testid=editor-toolbar]')!
    const tr = tb.getBoundingClientRect()
    const bad: string[] = []
    for (const el of tb.querySelectorAll<HTMLButtonElement>('button[data-testid^=tool-]')) {
      const r = el.getBoundingClientRect()
      const label = el.querySelector('span')
      const inside = r.left >= tr.left - 0.5 && r.right <= tr.right + 0.5 && r.top >= tr.top - 0.5 && r.bottom <= tr.bottom + 0.5
      const labelFits = !label || label.scrollWidth <= label.clientWidth + 0.5
      let hidden = false
      for (let n: HTMLElement | null = el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).overflow === 'visible') continue
        const rr = n.getBoundingClientRect()
        if (r.right > rr.right + 0.5 || r.left < rr.left - 0.5 || r.bottom > rr.bottom + 0.5 || r.top < rr.top - 0.5) hidden = true
      }
      if (!inside || !labelFits || hidden || r.width === 0 || !el.checkVisibility()) bad.push(`${el.dataset.testid} (${label?.textContent})`)
    }
    return bad
  })
}

for (const width of [1920, 1366, 1024]) {
  test(`toolbar at ${width}px: every tool is visible and unclipped after a PDF loads`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openEditor(page, '/edit', await writeEditorPdf('toolbar.pdf'), { fit: false })
    // the toolbar is one row like Sejda's: tools that share a drop-down (Forms, Annotate, Shapes, Table) are reached through their arrow
    expect(await clippedButtons(page)).toEqual([])
    await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true') // the Text tool is on from the start, as in Sejda
    for (const id of TOOLS) {
      await openToolMenu(page, id)
      await expect(page.getByTestId(`tool-${id}`), id).toBeVisible()
      await page.getByTestId(`tool-${id}`).click({ trial: true })
      if (id === 'image' || id === 'signature') continue // these open a chooser / dialog
      await page.getByTestId(`tool-${id}`).click()
      await expectToolOn(page, id)
    }

  })
}
