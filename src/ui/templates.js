// Built-in templates (proposals/2026-10-18-templates.md, "Built-in
// templates"): data in the UI, made into a new file through the same paths
// as importing one, so they work offline and need nothing in the worklet.

import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import slidesModel from '../slides/slidesModel.js'
import { slideExtensions } from './doc/extensions.js'
import { writeFragment } from './slides/importText.js'
import { importDocument } from './doc/docFiles.js'
import { toB64 } from './doc/pictures.js'
import { call } from './bridge.js'

export const BUILT_IN = [
  { id: 'budget', kind: 'sheet', title: 'Budget', about: 'Monthly income and spending, planned and actual' },
  { id: 'recipe', kind: 'doc', title: 'Recipe', about: 'Ingredients, steps and notes' },
  { id: 'meeting', kind: 'doc', title: 'Meeting notes', about: 'Agenda, notes, decisions and actions' },
  { id: 'deck', kind: 'slides', title: 'Simple deck', about: 'A title, an outline and a closing slide' }
]

// --- Budget ------------------------------------------------------------------

const MONEY = '#,##0.00'

function budgetTab () {
  const cells = []
  const styles = []
  const put = (row, col, input, num) => cells.push(num ? [row, col, String(input), num] : [row, col, String(input)])
  put(1, 1, 'Monthly budget')
  styles.push([1, 1, { b: true, size: 16 }])
  ;['Item', 'Planned', 'Actual', 'Difference'].forEach((t, i) => { put(3, i + 1, t); styles.push([3, i + 1, { b: true, fill: '#e8f0e0', bb: 'thin', ...(i ? { align: 'right' } : {}) }]) })
  const section = (row, title) => { put(row, 1, title); styles.push([row, 1, { b: true }]) }
  const line = (row, item, planned, plus) => {
    put(row, 1, item)
    put(row, 2, planned, MONEY)
    put(row, 3, 0, MONEY)
    put(row, 4, plus ? `=C${row}-B${row}` : `=B${row}-C${row}`, MONEY)
  }
  const total = (row, title, from, to, plus) => {
    put(row, 1, title)
    put(row, 2, `=SUM(B${from}:B${to})`, MONEY)
    put(row, 3, `=SUM(C${from}:C${to})`, MONEY)
    put(row, 4, plus ? `=C${row}-B${row}` : `=B${row}-C${row}`, MONEY)
    for (let c = 1; c <= 4; c++) styles.push([row, c, { b: true, bt: 'thin' }])
  }
  section(4, 'Income')
  line(5, 'Salary', 3000, true)
  line(6, 'Other income', 200, true)
  total(7, 'Total income', 5, 6, true)
  section(9, 'Spending')
  ;[['Rent or mortgage', 1200], ['Groceries', 450], ['Utilities', 150], ['Transport', 120], ['Phone and internet', 80], ['Going out', 150], ['Savings', 300]]
    .forEach(([item, n], i) => line(10 + i, item, n, false))
  total(17, 'Total spending', 10, 16, false)
  put(19, 1, 'Left over')
  put(19, 2, '=B7-B17', MONEY)
  put(19, 3, '=C7-C17', MONEY)
  for (let c = 1; c <= 3; c++) styles.push([19, c, { b: true, fill: '#e8f0e0' }])
  put(21, 1, 'Fill in Actual as you go.')
  styles.push([21, 1, { i: true, color: '#6b716b' }])
  return { name: 'Budget', cells, styles, widths: { 1: 200, 2: 110, 3: 110, 4: 110 }, freeze: { rows: 3 } }
}

// --- Documents ---------------------------------------------------------------

const RECIPE = `<h1>Recipe name</h1>
<p><strong>Serves:</strong> 4 &nbsp; <strong>Prep:</strong> 15 minutes &nbsp; <strong>Cook:</strong> 30 minutes</p>
<h2>Ingredients</h2>
<ul><li><p>200 g first ingredient</p></li><li><p>1 tbsp second ingredient</p></li><li><p>A pinch of salt</p></li></ul>
<h2>Steps</h2>
<ol><li><p>Get everything ready.</p></li><li><p>Mix the ingredients.</p></li><li><p>Cook until done.</p></li></ol>
<h2>Notes</h2>
<p>Swaps, tips and what to serve it with.</p>`

const MEETING = `<h1>Meeting notes</h1>
<p><strong>Date:</strong> </p>
<p><strong>People:</strong> </p>
<h2>Agenda</h2>
<ol><li><p>First topic</p></li><li><p>Second topic</p></li></ol>
<h2>Notes</h2>
<p></p>
<h2>Decisions</h2>
<ul><li><p></p></li></ul>
<h2>Actions</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Who does what, by when</p></li></ul>`

// --- Slides --------------------------------------------------------------------

const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const bullets = (items) => ({ type: 'doc', content: [{ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [para(t)] })) }] })
const lines = (...texts) => ({ type: 'doc', content: texts.map(para) })

function deckUpdate (title) {
  const schema = getSchema(slideExtensions())
  const doc = new Y.Doc()
  try {
    doc.transact(() => {
      const fill = (slideId, texts) => {
        for (const { map } of slidesModel.elements(doc, slideId)) {
          const json = texts[map.get('role')]
          if (json) writeFragment(Y, map.get('text'), json, schema)
        }
      }
      const first = slidesModel.initDeck(doc, { title })
      slidesModel.setLayout(doc, first, 'title')
      fill(first, { title: lines('Your title'), body: lines('Your name, the date') })
      const outline = slidesModel.addSlide(doc, { after: first, layout: 'content' })
      fill(outline, { title: lines('What this is about'), body: bullets(['The first point', 'The second point', 'The third point']) })
      const detail = slidesModel.addSlide(doc, { after: outline, layout: 'twoColumns' })
      fill(detail, { title: lines('Side by side'), body: bullets(['Before', 'What it costs']), body2: bullets(['After', 'What it gives']) })
      const end = slidesModel.addSlide(doc, { after: detail, layout: 'title' })
      fill(end, { title: lines('Thank you'), body: lines('Questions?') })
    })
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

// Make a new file from a built-in template. Resolves to { sheetId }.
export async function makeBuiltIn (id) {
  const t = BUILT_IN.find((x) => x.id === id)
  if (!t) throw new Error('No such template')
  if (id === 'budget') return call('sheet:import', { title: t.title, tabs: [budgetTab()], names: [] })
  if (id === 'recipe' || id === 'meeting') return importDocument(new TextEncoder().encode(id === 'recipe' ? RECIPE : MEETING), t.title + '.html')
  return call('slides:import', { title: t.title, update: toB64(deckUpdate(t.title)) })
}
