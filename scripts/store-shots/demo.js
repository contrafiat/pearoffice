// The made-up community garden files for the store screenshots. Three people,
// Nick, Satoshi and Hal, are real PearOffice engines running here on the
// real network (no test network, no fake data).
//
//   node scripts/store-shots/demo.js [--data <folder>] [--port 8799]
//
// Nick makes a spreadsheet, a document and a deck, and Satoshi and Hal join
// them as editors. The device being photographed links to Nick as one of
// Nick's own devices: GET http://127.0.0.1:<port>/link answers with a fresh
// device link (one works at a time, for 5 minutes). The device is then Nick,
// the owner, with the files, and Satoshi and Hal show in each file: Satoshi
// on a cell of the budget, Hal on the chart slide. It keeps running until
// Ctrl+C. Data goes to a fresh folder in the system temp dir unless --data
// says otherwise.
//
// Files and text are fixed, so a retake shows the same thing.

const fs = require('fs')
const os = require('os')
const path = require('path')
const Y = require('yjs')
const b4a = require('b4a')
const Corestore = require('corestore')
const { Window } = require('happy-dom')
const { createSheetEngine } = require('../../src/worklet/engine')
const slidesModel = require('../../src/slides/slidesModel')

globalThis.window = new Window()

const http = require('http')

const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1]) || 8799
const dataAt = args.indexOf('--data')
const dataDir = dataAt >= 0 ? path.resolve(args[dataAt + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-shots-'))

function call (engine, method, a = {}) {
  const ctx = {
    engine,
    get identity () { return engine.identity },
    get store () { return engine.store },
    get swarm () { return engine.swarm },
    get localDb () { return engine.localDb },
    append: engine.append,
    emit: engine.emit,
    bases: engine.bases,
    createGroup: engine.createGroup,
    joinGroup: engine.joinGroup
  }
  return engine.methods[method](a, ctx)
}

async function person (name) {
  const logFile = path.join(dataDir, 'engines.log')
  const log = (...a) => fs.appendFileSync(logFile, new Date().toISOString().slice(11, 19) + ' ' + name + ': ' + a.join(' ') + '\n')
  const e = createSheetEngine({ corestore: new Corestore(path.join(dataDir, name.toLowerCase())), log })
  await e.init({})
  await call(e, 'app:setName', { name })
  return e
}

async function waitFor (label, fn, ms = 60000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await fn()) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('timed out: ' + label)
}

// --- the spreadsheet ---------------------------------------------------------

const MONEY = '$#,##0.00'
const BUDGET = [
  ['Item', 'Category', 'Cost', 'Paid by'],
  ['Seeds and seedlings', 'Plants', 186.4, 'Satoshi'],
  ['Fruit tree saplings', 'Plants', 240, 'Hal'],
  ['Compost (4 cubic yards)', 'Soil', 212, 'Nick'],
  ['Raised bed lumber', 'Beds', 395.75, 'Hal'],
  ['Drip irrigation kit', 'Water', 164.99, 'Satoshi'],
  ['Rain barrels (2)', 'Water', 138, 'Nick'],
  ['Hand tools', 'Tools', 96.5, 'Satoshi'],
  ['Wheelbarrow', 'Tools', 119, 'Hal'],
  ['Fence repair', 'Beds', 175, 'Nick'],
  ['Mulch', 'Soil', 88.25, 'Satoshi']
]
const CATEGORIES = ['Plants', 'Soil', 'Beds', 'Water', 'Tools']

function budgetTab () {
  const cells = []
  BUDGET.forEach((row, r) => row.forEach((v, c) => cells.push([r + 1, c + 1, String(v), r > 0 && c === 2 ? MONEY : undefined].filter((x) => x !== undefined))))
  const last = BUDGET.length
  cells.push([last + 2, 2, 'Total'], [last + 2, 3, '=SUM(C2:C' + last + ')', MONEY])
  cells.push([1, 6, 'Category'], [1, 7, 'Spent'], [1, 8, 'Share'])
  CATEGORIES.forEach((cat, i) => {
    const r = i + 2
    cells.push([r, 6, cat], [r, 7, '=SUMIF(B$2:B$' + last + ',F' + r + ',C$2:C$' + last + ')', MONEY], [r, 8, '=G' + r + '/C$' + (last + 2), '0%'])
  })
  return { name: 'Budget', cells, widths: { 1: 190, 2: 96, 3: 96, 4: 84, 5: 24, 6: 96, 7: 96, 8: 64 } }
}

const HARVEST = [
  ['Month', 'Tomatoes (kg)', 'Beans (kg)', 'Squash (kg)'],
  ['May', 0, 2.1, 0],
  ['June', 6.5, 8.4, 3.2],
  ['July', 21.8, 12.6, 14.9],
  ['August', 34.2, 9.8, 22.5],
  ['September', 18.6, 4.3, 16.1]
]

function harvestTab () {
  const cells = []
  HARVEST.forEach((row, r) => row.forEach((v, c) => cells.push([r + 1, c + 1, String(v)])))
  return { name: 'Harvest', cells, widths: { 1: 110, 2: 120, 3: 100, 4: 110 } }
}

async function makeSheet (owner) {
  const { sheetId } = await call(owner, 'sheet:import', { title: 'Garden budget 2026', tabs: [budgetTab(), harvestTab()] })
  const view = await call(owner, 'sheet:view', { sheetId })
  const [budget, harvest] = view.tabs.map((t) => t.id)
  const last = BUDGET.length
  await call(owner, 'sheet:setFormatRange', { sheetId, tabId: budget, r1: 1, c1: 1, r2: 1, c2: 8, patch: { b: true, fill: '#e7efd6' } })
  await call(owner, 'sheet:setFormatRange', { sheetId, tabId: budget, r1: last + 2, c1: 2, r2: last + 2, c2: 3, patch: { b: true } })
  await call(owner, 'sheet:setFreeze', { sheetId, tabId: budget, rows: 1, cols: 0 })
  await call(owner, 'sheet:addChart', { sheetId, tabId: budget, spec: { type: 'pie', data: 'F1:G6', seriesIn: 'columns', labels: { row: true, col: true }, legend: 'right', title: 'Spent by category', anchor: { row: last + 3, col: 1 }, size: { w: 520, h: 300 } } })
  await call(owner, 'sheet:setFormatRange', { sheetId, tabId: harvest, r1: 1, c1: 1, r2: 1, c2: 4, patch: { b: true, fill: '#e7efd6' } })
  await call(owner, 'sheet:addChart', { sheetId, tabId: harvest, spec: { type: 'column', data: 'A1:D6', seriesIn: 'columns', labels: { row: true, col: true }, title: 'Harvest by month', anchor: { row: 8, col: 1 }, size: { w: 560, h: 320 } } })
  return { sheetId, tabs: { budget, harvest } }
}

// --- the document ------------------------------------------------------------

const PLAN = `# Planting plan 2026

Our plan for the beds this year. Add your name next to anything you can take on, and tick it off when it is done.

## Before the last frost

- [x] Turn the compost and spread it on beds 1 to 4
- [x] Order seeds and seedlings
- [ ] Fix the fence along the north side
- [ ] Set up the drip lines in the herb bed

## Who looks after which bed

| Bed | Crops | Looked after by |
| --- | --- | --- |
| 1 | Tomatoes and basil | Satoshi |
| 2 | Beans and peas | Hal |
| 3 | Squash and pumpkins | Nick |
| 4 | Herbs and flowers | Everyone |

## Watering

Water early in the morning, before 9. In July and August the beds need water **every other day**, the herb bed every day. The rain barrels refill the cans; the tap is for the drip lines.

## Notes

- Keep the path between beds 2 and 3 clear for the wheelbarrow
- Pick beans often, they keep coming
- Share extra harvest at the gate on Saturdays
`

async function makeDoc (owner) {
  const files = await import(path.join(__dirname, '..', '..', 'src', 'ui', 'doc', 'docFiles.js'))
  const { json } = await files.fileToJson('Planting plan.md', new TextEncoder().encode(PLAN))
  const update = b4a.toString(files.jsonToUpdate(json), 'base64')
  const { sheetId } = await call(owner, 'doc:import', { title: 'Planting plan', update })
  return { sheetId }
}

// --- the deck ----------------------------------------------------------------

function textFrag (paragraphs) {
  return paragraphs.map((str) => {
    const p = new Y.XmlElement('paragraph')
    const t = new Y.XmlText()
    t.insert(0, str)
    p.insert(0, [t])
    return p
  })
}

function bullets (items) {
  const list = new Y.XmlElement('bulletList')
  list.insert(0, items.map((str) => {
    const li = new Y.XmlElement('listItem')
    li.insert(0, textFrag([str]))
    return li
  }))
  return [list]
}

function fill (doc, slideId, role, content) {
  const el = slidesModel.elements(doc, slideId).find((e) => e.map.get('role') === role)
  el.map.get('text').insert(0, content)
}

async function makeDeck (owner) {
  const { sheetId } = await call(owner, 'slides:create', { title: 'October meeting' })
  const st = await call(owner, 'slides:state', { sheetId })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(st.state, 'base64'))
  const before = Y.encodeStateVector(doc)
  let firstSlide = null
  let chartSlide = null
  let chartId = null
  doc.transact(() => {
    slidesModel.setTheme(doc, 'paper')
    const [first] = slidesModel.slideIds(doc)
    firstSlide = first
    fill(doc, first, 'title', textFrag(['Members meeting']))
    fill(doc, first, 'body', textFrag(['Elm Street community garden, October 2026']))
    const season = slidesModel.addSlide(doc, { after: first, layout: 'content' })
    fill(doc, season, 'title', textFrag(['This season']))
    fill(doc, season, 'body', bullets(['Four beds planted, up from two', '262 kg harvested so far', '38 kg given away at the gate', 'New rain barrels cut the water bill by a third']))
    chartSlide = slidesModel.addSlide(doc, { after: season, layout: 'titleOnly' })
    fill(doc, chartSlide, 'title', textFrag(['Harvest by month']))
    slidesModel.slide(doc, chartSlide).get('notes').insert(0, textFrag(['August was the big month: 34 kg of tomatoes from bed 1 alone.', 'Thank Hal for the bean trellis.']))
    chartId = slidesModel.addChart(doc, chartSlide, {
      chart: { type: 'column', legend: 'bottom' },
      data: { categories: HARVEST.slice(1).map((r) => r[0]), series: HARVEST[0].slice(1).map((name, i) => ({ name, values: HARVEST.slice(1).map((r) => r[i + 1]) })) }
    }, { x: 260, y: 260, w: 1400, h: 720, rot: 0 })
    const next = slidesModel.addSlide(doc, { after: chartSlide, layout: 'content' })
    fill(doc, next, 'title', textFrag(['Next spring']))
    fill(doc, next, 'body', bullets(['A fifth bed for strawberries', 'Seed swap in March', 'Workdays on the first Saturday of each month']))
  }, 'local')
  const update = b4a.toString(Y.encodeStateAsUpdate(doc, before), 'base64')
  doc.destroy()
  await call(owner, 'slides:update', { sheetId, update })
  return { sheetId, firstSlide, chartSlide, chartId }
}

// --- people ------------------------------------------------------------------

async function addPerson (owner, who, name, sheetId, kind) {
  const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'editor' })
  await call(who, 'sheet:join', { link })
  await waitFor(name + ' in ' + kind, async () => {
    const f = (await call(who, 'sheet:list')).find((x) => x.sheetId === sheetId)
    return f && !f.joining
  })
}

async function main () {
  console.log('data: ' + dataDir)
  const nick = await person('Nick')
  const satoshi = await person('Satoshi')
  const hal = await person('Hal')
  const sheet = await makeSheet(nick)
  const doc = await makeDoc(nick)
  const deck = await makeDeck(nick)
  console.log('files made')
  for (const [id, kind] of [[sheet.sheetId, 'sheet'], [doc.sheetId, 'doc'], [deck.sheetId, 'slides']]) {
    await addPerson(nick, satoshi, 'Satoshi', id, kind)
    await addPerson(nick, hal, 'Hal', id, kind)
  }
  console.log('Satoshi and Hal joined')

  // Where each person is: the budget's Cost column for Satoshi, the chart
  // slide for Hal, both with the document open. Sent again every few seconds
  // so a device that joins later sees them.
  const here = async () => {
    await call(satoshi, 'sheet:presence', { sheetId: sheet.sheetId, open: true, tab: sheet.tabs.budget, row: 4, col: 3 })
    await call(hal, 'sheet:presence', { sheetId: sheet.sheetId, open: true, tab: sheet.tabs.budget, row: 9, col: 4 })
    await call(satoshi, 'sheet:presence', { sheetId: doc.sheetId, open: true })
    await call(hal, 'sheet:presence', { sheetId: doc.sheetId, open: true })
    await call(hal, 'sheet:presence', { sheetId: deck.sheetId, open: true, slide: deck.chartSlide, sel: [deck.chartId] })
    await call(satoshi, 'sheet:presence', { sheetId: deck.sheetId, open: true, slide: deck.firstSlide })
  }
  await here()
  setInterval(() => here().catch(() => {}), 5000)

  // A device link to Nick on request, for the next device. Invites a
  // previous device made for its sharing shot are cancelled first, so each
  // shot shows only its own.
  const fresh = async () => {
    for (const id of [sheet.sheetId, doc.sheetId, deck.sheetId]) {
      for (const i of (await call(nick, 'sheet:members', { sheetId: id })).invites || []) await call(nick, 'sheet:cancelInvite', { sheetId: id, inviteId: i.inviteId })
    }
    return (await call(nick, 'link:start')).link
  }
  const server = http.createServer((req, res) => {
    if (req.url !== '/link') { res.writeHead(404); res.end(); return }
    fresh().then((link) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(link) }, (err) => { res.writeHead(500); res.end(err.message) })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  console.log('ready: http://127.0.0.1:' + port + '/link')

  const stop = async () => {
    server.close()
    for (const e of [nick, satoshi, hal]) { try { await e.close() } catch {} }
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((err) => { console.error(err); process.exit(1) })
