import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { dragPs, exportAndDownload, fitPage, openEditor, pickTool, writeEditorPdf } from './editorHelpers'
import { inspectForm } from '../src/editor/forms'

const DIR = join(import.meta.dirname, '.tmp')
mkdirSync(DIR, { recursive: true })

async function formWithRequired(name: string) {
  const d = await PDFDocument.create()
  const p = d.addPage([400, 300])
  const form = d.getForm()
  const who = form.createTextField('full_name')
  who.addToPage(p, { x: 40, y: 220, width: 200, height: 22 })
  who.enableRequired()
  form.createTextField('nickname').addToPage(p, { x: 40, y: 170, width: 200, height: 22 })
  const ok = form.createCheckBox('agree')
  ok.addToPage(p, { x: 40, y: 120, width: 16, height: 16 })
  ok.enableRequired()
  const path = join(DIR, name)
  writeFileSync(path, await d.save())
  return path
}
async function buttonOnly(name: string) {
  const d = await PDFDocument.create()
  const p = d.addPage([400, 300])
  d.getForm().createButton('send').addToPage('Send', p, { x: 40, y: 200, width: 100, height: 24 })
  const path = join(DIR, name)
  writeFileSync(path, await d.save())
  return path
}
const readForm = async (path: string) => inspectForm(await PDFDocument.load(readFileSync(path)))

test('a PDF without fields: clear message, two actions, nothing created automatically', async ({ page }) => {
  await openEditor(page, '/fill-form', await writeEditorPdf('nofields.pdf', 1))
  const box = page.getByTestId('fill-none')
  await expect(box).toContainText('No fillable fields detected')
  await expect(box).toContainText('does not contain interactive form fields')
  await expect(page.getByTestId('create-fillable')).toHaveText(/Create Fillable Form/)
  await expect(page.getByTestId('choose-another-pdf')).toHaveText(/Choose Another PDF/)
  // exporting now would add nothing
  await expect(page.locator('[data-testid=field-box]')).toHaveCount(0)

  // Choose Another PDF goes back to the upload step
  await page.getByTestId('choose-another-pdf').click()
  await expect(page.getByText('Choose the form to fill')).toBeVisible()
})

test('create a fillable form: place, configure, duplicate, align, export a really interactive PDF, then fill it', async ({ page }) => {
  await openEditor(page, '/fill-form', await writeEditorPdf('create.pdf', 1))
  await fitPage(page)
  await page.getByTestId('create-fillable').click()
  await expect(page.getByTestId('fill-creating')).toBeVisible()
  await expect(page.getByTestId('toolmenu-forms')).toHaveClass(/bg-brand/) // a form tool is ready (the Forms group is lit)

  // the form tools are their own group; ordinary text is a different tool
  await expect(page.getByTestId('toolbar-form-fields')).toBeVisible()

  // a text field
  await dragPs(page, 0, [40, 140], [240, 164])
  await expect(page.getByTestId('field-badge')).toContainText('Text field')
  await page.getByTestId('field-name').fill('full_name')
  await page.getByTestId('field-required').check()
  await page.getByTestId('field-tooltip').fill('Your legal name')
  await page.getByTestId('field-maxlength').fill('60')
  await page.getByTestId('field-validation').selectOption('none')
  await expect(page.locator('[data-testid=field-box][data-selected=true]')).toHaveCount(1) // the selected one is marked

  // a second text field: numbers only, then duplicate it
  await pickTool(page, 'field-text')
  await dragPs(page, 0, [40, 180], [140, 204])
  await page.getByTestId('field-name').fill('age')
  await page.getByTestId('field-validation').selectOption('number')
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.getByTestId('field-name')).toHaveValue('age_2') // the copy is a separate field with its own name

  // a checkbox that starts ticked
  await pickTool(page, 'field-checkbox')
  await dragPs(page, 0, [40, 230], [56, 246])
  await page.getByTestId('field-name').fill('agree')
  await page.getByTestId('field-default').check()

  // two radio buttons of one group
  await pickTool(page, 'field-radio')
  await dragPs(page, 0, [200, 230], [216, 246])
  await page.getByTestId('field-name').fill('plan')
  await page.getByTestId('field-option').fill('Basic')
  await pickTool(page, 'field-radio')
  await dragPs(page, 0, [260, 230], [276, 246])
  await page.getByTestId('field-name').fill('plan')
  await page.getByTestId('field-option').fill('Pro')
  await page.getByTestId('field-default').check()
  await expect(page.getByTestId('radio-group-info')).toContainText('2 option')

  // a dropdown with its choices
  await pickTool(page, 'field-dropdown')
  await dragPs(page, 0, [260, 180], [380, 204])
  await page.getByTestId('field-name').fill('country')
  await page.getByTestId('field-choices').fill('Peru, Chile, Bolivia')

  // naming a field like another one is flagged
  await page.getByTestId('field-name').fill('age')
  await expect(page.getByTestId('field-name-warning')).toBeVisible()
  await page.getByTestId('field-name').fill('country')
  await expect(page.getByTestId('field-name-warning')).toHaveCount(0)

  // alignment of several selected fields
  await pickTool(page, 'select')
  await page.keyboard.press('Control+a')
  await expect(page.getByTestId('align-group')).toBeVisible()
  await page.keyboard.press('Escape')

  // ordinary text is not a field
  await pickTool(page, 'text')
  await page.mouse.click(...(await (async () => { const o = (await page.getByTestId('page-overlay').first().boundingBox())!; return [o.x + o.width * 0.7, o.y + o.height * 0.55] as [number, number] })()))
  await page.keyboard.type('Just a label')
  await page.keyboard.press('Escape')

  // export an interactive PDF
  const path = await exportAndDownload(page)
  await expect(page.getByTestId('result-panel')).toContainText('still an interactive form')
  const info = await readForm(path)
  const by = Object.fromEntries(info.fields.map((f) => [f.name, f]))
  expect(Object.keys(by).sort()).toEqual(['age', 'age_2', 'agree', 'country', 'full_name', 'plan'])
  expect(by.agree.value).toBe(true)
  expect(by.plan.options).toEqual(['Basic', 'Pro'])
  expect(by.plan.value).toBe('Pro')
  expect(by.country.options).toEqual(['Peru', 'Chile', 'Bolivia'])
  expect(by.full_name.required).toBe(true)
  expect(by.full_name.maxLength).toBe(60)
  expect(by.age.required).toBe(false)
  expect(info.fields.some((f) => f.name.toLowerCase().includes('label'))).toBe(false) // the text label is page content, not a field

  // the exported file is a form the Fill forms tool recognises
  await openEditor(page, '/fill-form', path)
  await fitPage(page)
  await expect(page.getByTestId('fill-detected')).toContainText('Fillable form detected. Click any field to enter your information.')
  await expect(page.getByTestId('fill-required')).toContainText('0 of 1 required field')
})

test('filling an existing form: required fields are flagged, navigation, values saved, flatten option', async ({ page }) => {
  await openEditor(page, '/fill-form', await formWithRequired('required.pdf'))
  await fitPage(page)
  await expect(page.getByTestId('fill-detected')).toContainText('Fillable form detected. Click any field to enter your information.')
  await expect(page.getByTestId('fill-summary')).toContainText('3 fields found')
  await expect(page.getByTestId('fill-required')).toHaveText('0 of 2 required fields filled in')
  await expect(page.locator('[data-field=full_name][data-missing=true]')).toHaveCount(1)
  await expect(page.locator('[data-field=nickname][data-missing=true]')).toHaveCount(0) // optional: not flagged

  // Next field moves through the fields, top to bottom
  await page.getByTestId('field-next').click()
  await expect(page.locator('[data-field=full_name]')).toBeFocused()
  await page.getByTestId('field-next').click()
  await expect(page.locator('[data-field=nickname]')).toBeFocused()
  await page.getByTestId('field-prev').click()
  await expect(page.locator('[data-field=full_name]')).toBeFocused()

  await page.locator('[data-field=full_name]').fill('Ada Lovelace')
  await expect(page.getByTestId('fill-required')).toHaveText('1 of 2 required fields filled in')
  await expect(page.locator('[data-field=full_name][data-missing=true]')).toHaveCount(0)

  // what was typed survives a change of tool
  await pickTool(page, 'rect')
  await pickTool(page, 'select')
  await expect(page.locator('[data-field=full_name]')).toHaveValue('Ada Lovelace')
  await page.locator('[data-field=agree]').check()
  await expect(page.getByTestId('fill-required')).toHaveText('2 of 2 required fields filled in')

  // interactive export keeps field names, values and the required flag
  const interactive = await exportAndDownload(page)
  const a = await readForm(interactive)
  expect(a.fields.map((f) => f.name).sort()).toEqual(['agree', 'full_name', 'nickname'])
  expect(a.fields.find((f) => f.name === 'full_name')!.value).toBe('Ada Lovelace')
  expect(a.fields.find((f) => f.name === 'full_name')!.required).toBe(true)
  expect(a.fields.find((f) => f.name === 'agree')!.value).toBe(true)
})

test('flatten: the filled form becomes a normal document without fields', async ({ page }) => {
  await openEditor(page, '/fill-form', await formWithRequired('flat.pdf'))
  await fitPage(page)
  await page.locator('[data-field=full_name]').fill('Grace Hopper')
  await page.getByTestId('flatten-form').check()
  const out = await exportAndDownload(page)
  await expect(page.getByTestId('result-panel')).toContainText('flattened')
  expect((await readForm(out)).fields).toHaveLength(0)
})

test('a PDF whose only fields are buttons is not called "no form"', async ({ page }) => {
  await openEditor(page, '/fill-form', await buttonOnly('button-only.pdf'))
  const box = page.getByTestId('fill-unsupported-only')
  await expect(box).toContainText('has form fields, but none that can be filled in here')
  await expect(box).toContainText('1 button')
  await expect(page.getByTestId('create-fillable')).toHaveText(/Add fields anyway/)
  await expect(page.getByTestId('fill-none')).toHaveCount(0)
})

test('the Edit PDF tool does not show the Fill forms panel', async ({ page }) => {
  await openEditor(page, '/edit', await writeEditorPdf('edit-only.pdf', 1))
  await expect(page.getByTestId('fill-none')).toHaveCount(0)
  await expect(page.getByTestId('fill-detected')).toHaveCount(0)
})

