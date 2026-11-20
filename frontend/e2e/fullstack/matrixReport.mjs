// Turns the Playwright JSON report of matrix.spec.ts into the feature × document table used in TEST-REPORT.md.
//   PLAYWRIGHT_JSON_OUTPUT_NAME=e2e/.tmp/matrix.json npx playwright test -c playwright.fullstack.config.ts e2e/fullstack/matrix.spec.ts --reporter=list,json
//   node e2e/fullstack/matrixReport.mjs e2e/.tmp/matrix.json > e2e/.tmp/matrix.md
import { readFileSync } from 'node:fs'

const report = JSON.parse(readFileSync(process.argv[2] ?? 'e2e/.tmp/matrix.json', 'utf8'))
const rows = []
const walk = (suite) => {
  for (const s of suite.suites ?? []) walk(s)
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = t.results?.[t.results.length - 1]
      // runtime annotations can be reported on the test and on its result: de-duplicate
      const seen = new Set()
      const anns = [...(t.annotations ?? []), ...(last?.annotations ?? [])].filter((a) => {
        const k = `${a.type}\u0000${a.description}`
        return seen.has(k) ? false : (seen.add(k), true)
      })
      const m = anns.find((a) => a.type === 'matrix')
      if (!m) continue
      const { tool, doc, variant } = JSON.parse(m.description)
      const outcome = anns.find((a) => a.type === 'matrix-outcome')?.description
      const notes = anns.filter((a) => a.type === 'matrix-note').map((a) => a.description)
      const status = last?.status ?? 'skipped'
      const expectedFail = t.expectedStatus === 'failed'
      let mark
      if (status === 'passed' && outcome) mark = '⚠️ clear error (expected)'
      else if (status === 'passed') mark = '✅ pass'
      else if (status === 'failed' && expectedFail) mark = '❌ NOT WORKING (known)'
      else if (status === 'skipped') mark = '⏭ skipped'
      else mark = '❌ FAIL'
      const err = status === 'failed' ? (last?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 160) : ''
      rows.push({ tool, doc, variant, mark, detail: [outcome?.replace(/^clear-error: /, ''), ...notes, err].filter(Boolean).join(' · ') })
    }
  }
}
for (const s of report.suites ?? []) walk(s)
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const icon = (m) => (m.startsWith('✅') ? '✅' : m.startsWith('⚠️') ? '⚠️' : m.startsWith('❌') ? '❌' : '⏭')

// --grid: one row per tool (+variant), one column per standard PDF document; everything else listed below the grid
if (process.argv.includes('--grid')) {
  const DOCS = ['table', 'multipage', 'scanned', 'mixed', 'unicode', 'forms', 'images', 'single', 'large']
  const keyOf = (r) => (r.variant && !/^(every 1 page|range 1|page 1|only page|move page 2 first|single page)$/.test(r.variant) ? `${r.tool} (${r.variant})` : r.tool)
  const grid = new Map()
  const other = []
  for (const r of rows) {
    if (DOCS.includes(r.doc) && !/^chat:/.test(r.tool) && !/invalid|malformed|out of range|every page|broken|upload limit/.test(r.variant)) {
      const k = keyOf(r)
      if (!grid.has(k)) grid.set(k, {})
      grid.get(k)[r.doc] = icon(r.mark)
    } else other.push(r)
  }
  console.log(`| Tool | ${DOCS.join(' | ')} |`)
  console.log(`|---|${DOCS.map(() => ':-:').join('|')}|`)
  for (const [k, v] of grid) console.log(`| ${esc(k)} | ${DOCS.map((d) => v[d] ?? '–').join(' | ')} |`)
  console.log('\n**Other inputs, chat→MCP tools, negative cases and the chain**\n')
  console.log('| Tool | Input | Variant | Result | Details |')
  console.log('|---|---|---|---|---|')
  for (const r of other) console.log(`| ${esc(r.tool)} | ${esc(r.doc)} | ${esc(r.variant)} | ${r.mark} | ${esc(r.detail)} |`)
  const count = (p) => rows.filter((r) => r.mark.startsWith(p)).length
  console.log(`\nTotal cells: ${rows.length} — ✅ ${count('✅')} pass · ⚠️ ${count('⚠️')} clear expected error · ❌ ${count('❌')} failing · ⏭ ${count('⏭')} skipped`)
  process.exit(0)
}
console.log('| Tool | Document | Variant | Result | Details |')
console.log('|---|---|---|---|---|')
for (const r of rows) console.log(`| ${esc(r.tool)} | ${esc(r.doc)} | ${esc(r.variant)} | ${r.mark} | ${esc(r.detail)} |`)
const count = (p) => rows.filter((r) => r.mark.startsWith(p)).length
console.log(`\nTotal cells: ${rows.length} — ✅ ${count('✅')} pass · ⚠️ ${count('⚠️')} clear expected error · ❌ ${count('❌')} failing · ⏭ ${count('⏭')} skipped`)
