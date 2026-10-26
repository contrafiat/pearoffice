// Version history (proposals/2026-10-26-version-history.md): grouping edits
// into versions, rebuilding a version, edits keeping their time, and the
// first edit of a moved file marking where history starts.

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const b4a = require('b4a')
const Corestore = require('corestore')
const { createSheetEngine } = require('../src/worklet/engine')
const docModel = require('../src/doc/docModel')
const history = require('../src/doc/history')
const { yOps } = require('../src/worklet/yOps')
const { tmpDir, cleanup, call } = require('./helpers')

const MIN = 60 * 1000
const T0 = 1.8e12

// Edits as the view keeps them: one paragraph each, typed into one document.
function editsOf (items) {
  const doc = new Y.Doc()
  return items.map(([text, at, who, start], i) => {
    const before = Y.encodeStateVector(doc)
    doc.transact(() => {
      const p = new Y.XmlElement('paragraph')
      const t = new Y.XmlText()
      t.insert(0, text)
      p.insert(0, [t])
      docModel.body(doc).insert(docModel.body(doc).length, [p])
    })
    const data = b4a.toString(Y.encodeStateAsUpdate(doc, before), 'base64')
    return { key: 'y/' + who + '/' + String(i).padStart(12, '0'), data, at, identity: who, start: start || null }
  })
}
const textOf = (state) => {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  const out = docModel.plainText(doc)
  doc.destroy()
  return out
}

test('edits group into versions by pauses and by length, newest first', () => {
  const edits = editsOf([
    ['old a', null, 'a'],
    ['old b', null, 'b'],
    ['one', T0, 'a'],
    ['two', T0 + 2 * MIN, 'b'],
    ['three', T0 + 20 * MIN, 'a'],
    ...Array.from({ length: 8 }, (_, i) => ['long ' + i, T0 + 30 * MIN + i * 4 * MIN, 'a'])
  ])
  const v = history.versions(edits)
  // Newest first: the long run, three, one+two, then Earlier (untimed).
  assert.deepEqual(v.map((x) => x.edits), [8, 1, 2, 2])
  assert.equal(v[v.length - 1].from, null)
  assert.deepEqual(v[v.length - 1].people, ['a', 'b'])
  assert.deepEqual(v[v.length - 2].people, ['a', 'b'])
  assert.equal(v[v.length - 2].edits, 2)
  assert.equal(v[v.length - 3].edits, 1)
  // The 32-minute run of eight edits 4 minutes apart: one version (under an hour).
  const long = editsOf(Array.from({ length: 20 }, (_, i) => ['x' + i, T0 + i * 4 * MIN, 'a']))
  assert.deepEqual(history.versions(long).map((x) => x.edits), [4, 16])
})

test('a version rebuilds the document as it was', () => {
  const edits = editsOf([['first', T0, 'a'], ['second', T0 + 10 * MIN, 'a'], ['third', T0 + 20 * MIN, 'b']])
  const v = history.versions(edits)
  assert.equal(v.length, 3)
  assert.equal(textOf(history.stateAt(edits, v[2].end)), 'first')
  assert.equal(textOf(history.stateAt(edits, v[1].end)), 'first\nsecond')
  assert.equal(textOf(history.stateAt(edits, v[0].end)), 'first\nsecond\nthird')
  // Whatever order they arrive in.
  assert.equal(textOf(history.stateAt([...edits].reverse(), v[1].end)), 'first\nsecond')
})

test('the first edit of a moved file is a version of its own', () => {
  const edits = editsOf([['whole', T0, 'a', 'compact'], ['after', T0 + MIN, 'a']])
  const v = history.versions(edits)
  assert.deepEqual(v.map((x) => x.start), [null, 'compact'])
})

test('ops carry their time; the view keeps it, and drops nonsense', async (t) => {
  assert.equal(yOps(new Uint8Array([1, 2, 3]), 1234)[0].at, 1234)
  const engine = createSheetEngine({ corestore: new Corestore(tmpDir()) })
  t.after(async () => { await engine.close(); cleanup() })
  await engine.init({})
  const { sheetId } = await call(engine, 'doc:create', { title: 'History' })
  const s = await call(engine, 'doc:state', { sheetId })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  const add = async (text) => {
    const before = Y.encodeStateVector(doc)
    doc.transact(() => {
      const p = new Y.XmlElement('paragraph')
      const tx = new Y.XmlText()
      tx.insert(0, text)
      p.insert(0, [tx])
      docModel.body(doc).insert(docModel.body(doc).length, [p])
    })
    await call(engine, 'doc:update', { sheetId, update: b4a.toString(Y.encodeStateAsUpdate(doc, before), 'base64') })
  }
  await add('first')
  await new Promise((resolve) => setTimeout(resolve, 400))
  await add('second')
  const { versions } = await call(engine, 'file:versions', { sheetId, pauseMs: 200 })
  assert.equal(versions.length, 2)
  assert.ok(versions.every((x) => typeof x.from === 'number' && x.people.length === 1 && x.people[0] === b4a.toString(engine.identity.publicKey, 'hex')))
  const older = await call(engine, 'file:version', { sheetId, end: versions[1].end })
  assert.equal(textOf(b4a.from(older.state, 'base64')), 'first')
  // An op with a time that is not a plausible one keeps none.
  const before = Y.encodeStateVector(doc)
  doc.getMap('meta').set('note', 'x')
  await engine.append(sheetId, { type: 'y', data: b4a.toString(Y.encodeStateAsUpdate(doc, before), 'base64'), at: 'soon' })
  const base = engine.bases.get(sheetId)
  await base.update()
  const ats = []
  for await (const { value } of base.view.createReadStream({ gt: 'y/', lt: 'y/~' })) ats.push(value.at)
  assert.equal(ats.length, 4)
  assert.equal(ats.filter((x) => x === undefined).length, 1)
})

test('what changed between two versions, word by word', async () => {
  const { Window } = require('happy-dom')
  globalThis.window = globalThis.window || new Window()
  globalThis.document = globalThis.document || window.document
  const d = await import(require('node:path').join(__dirname, '..', 'src', 'ui', 'doc', 'versionDiff.js'))
  const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
  const before = { type: 'doc', content: [p('Hello world'), p('Keep me'), p('Gone')] }
  const after = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] }, p('Hello brave world'), p('Keep me')] }
  const rows = d.diffVersions(before, after)
  const show = (r) => r.op + ':' + r.kind + ':' + r.parts.map((x) => (x.op === 'same' ? x.text : x.op === 'add' ? '+' + x.text : '-' + x.text)).join('')
  assert.deepEqual(rows.map(show), ['add:h1:+Title', 'changed:p:Hello +brave world', 'same:p:Keep me', 'del:p:-Gone'])
  const words = d.diffWords('a b c', 'a x c')
  assert.deepEqual(words, [{ text: 'a ', op: 'same' }, { text: 'b', op: 'del' }, { text: 'x', op: 'add' }, { text: ' c', op: 'same' }])
  // The first version: everything added.
  assert.deepEqual(d.diffVersions(null, { type: 'doc', content: [p('One')] }).map(show), ['add:p:+One'])
})

test('a sheet: an old version with its values and changes, and Restore', async (t) => {
  const engine = createSheetEngine({ corestore: new Corestore(tmpDir()) })
  t.after(async () => { await engine.close(); cleanup() })
  await engine.init({})
  const { sheetId } = await call(engine, 'sheet:create', { title: 'Budget' })
  await call(engine, 'sheet:setCell', { sheetId, row: 1, col: 1, input: '1' })
  await new Promise((resolve) => setTimeout(resolve, 400))
  await call(engine, 'sheet:setCell', { sheetId, row: 1, col: 1, input: '2' })
  await call(engine, 'sheet:setCell', { sheetId, row: 1, col: 2, input: '=A1*10' })
  const { versions } = await call(engine, 'file:versions', { sheetId, pauseMs: 200 })
  assert.equal(versions.length, 2)
  const cells = async (i) => {
    const r = await call(engine, 'sheet:versionCells', { sheetId, end: versions[i].end, prevEnd: versions[i + 1] ? versions[i + 1].end : null })
    return Object.fromEntries(r.cells.map((c) => [c.row + ',' + c.col, c.display + (c.before === undefined ? '' : ' was ' + JSON.stringify(c.before))]))
  }
  assert.deepEqual(await cells(1), { '1,1': '1 was ""' }) // the first version: all of it added
  assert.deepEqual(await cells(0), { '1,1': '2 was "1"', '1,2': '20 was ""' })
  await call(engine, 'file:setTitle', { sheetId, title: 'Budget 2027' })
  await call(engine, 'file:restore', { sheetId, end: versions[1].end })
  const view = await call(engine, 'sheet:view', { sheetId })
  assert.deepEqual(view.cells.map((c) => c.row + ',' + c.col + '=' + c.display), ['1,1=1'])
  assert.equal(view.title, 'Budget 2027') // the title is not part of a version
})

test('restoreInto makes a deck match an older one, keeping its title', () => {
  const S = require('../src/slides/slidesModel')
  const older = new Y.Doc()
  S.initDeck(older, { title: 'Deck' })
  const live = new Y.Doc()
  Y.applyUpdate(live, Y.encodeStateAsUpdate(older))
  const first = S.slideIds(live)[0]
  S.addSlide(live, { after: first, layout: 'blank' })
  S.addShape(live, first, 'rect', { x: 10, y: 10, w: 100, h: 100, rot: 0 })
  live.getMap('meta').set('title', 'Deck, renamed')
  assert.equal(S.slideIds(live).length, 2)
  const old = new Y.Doc()
  Y.applyUpdate(old, Y.encodeStateAsUpdate(older))
  const other = new Y.Doc() // someone else's copy, to see the restore merge in
  Y.applyUpdate(other, Y.encodeStateAsUpdate(live))
  const before = Y.encodeStateVector(live)
  history.restoreInto(live, old)
  Y.applyUpdate(other, Y.encodeStateAsUpdate(live, before))
  for (const d of [live, other]) {
    assert.equal(S.slideIds(d).length, 1)
    assert.equal(S.elements(d, first).filter((e) => e.map.get('type') === 'shape').length, 0)
    assert.equal(d.getMap('meta').get('title'), 'Deck, renamed')
  }
})
