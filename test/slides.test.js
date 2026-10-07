// Slide decks (proposals/2026-10-06-slides.md, part 1): the model's order
// keys and concurrent edits, then decks made, shared and edited between
// devices. The editor's copy sends Yjs updates (slides:update) and gets
// everyone else's (doc:updated). Only strings, numbers and booleans are
// compared.

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const s = require('../src/slides/slidesModel')
const m = require('../src/worklet/membership')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

function paragraph (str) {
  const p = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  t.insert(0, str)
  p.insert(0, [t])
  return p
}

// Change a copy and return the update.
function change (doc, fn) {
  const before = Y.encodeStateVector(doc)
  doc.transact(() => fn(doc), 'local')
  return Y.encodeStateAsUpdate(doc, before)
}

const textOf = (doc, slideId, elId) => s.plainOf(s.element(doc, slideId, elId).get('text'))
const order = (doc) => s.slideIds(doc).join(',')
const box = (doc, slideId, role) => s.elements(doc, slideId).find((e) => e.map.get('role') === role).id

// Type into an empty box, or at the start of its first paragraph.
function type (doc, slideId, elId, str) {
  const frag = s.element(doc, slideId, elId).get('text')
  if (!frag.length) frag.insert(0, [paragraph(str)])
  else frag.get(0).get(0).insert(0, str)
}

// A deck with `n` slides, and two copies of it.
function deck (n = 3) {
  const base = new Y.Doc()
  change(base, (d) => {
    s.initDeck(d, { title: 'Talk' })
    for (let i = 1; i < n; i++) s.addSlide(d, { layout: 'content' })
  })
  const state = Y.encodeStateAsUpdate(base)
  const copy = () => { const d = new Y.Doc(); Y.applyUpdate(d, state); return d }
  return { base, state, a: copy(), b: copy(), copy }
}

// Both updates applied in each order: the two results, which must agree.
function bothOrders (state, ua, ub) {
  const x = new Y.Doc()
  const y = new Y.Doc()
  Y.applyUpdate(x, state); Y.applyUpdate(x, ua); Y.applyUpdate(x, ub)
  Y.applyUpdate(y, state); Y.applyUpdate(y, ub); Y.applyUpdate(y, ua)
  return [x, y]
}

test('order keys sort between their neighbours and never collide in a gap', () => {
  const keys = [s.keyBetween(null, null)]
  for (let n = 0; n < 3000; n++) {
    const i = Math.floor(Math.random() * (keys.length + 1))
    const lo = i > 0 ? keys[i - 1] : null
    const hi = i < keys.length ? keys[i] : null
    const k = s.keyBetween(lo, hi)
    assert.equal((lo === null || lo < k) && (hi === null || k < hi), true, lo + ' < ' + k + ' < ' + hi)
    assert.equal(k.endsWith('0'), false)
    keys.splice(i, 0, k)
  }
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(Math.max(...keys.map((k) => k.length)) < 30, true)
  assert.throws(() => s.keyBetween('b', 'a'))
})

test('a new deck has one title slide with a title and a subtitle box', () => {
  const { base } = deck(1)
  assert.equal(base.getMap('meta').get('kind'), 'slides')
  assert.equal(s.version(base), 1)
  assert.equal(s.size(base).join('x'), '1920x1080')
  assert.equal(s.theme(base), 'plain')
  change(base, (d) => { s.setSize(d, [1440, 1080]); s.setSize(d, [5, 1080]) })
  assert.equal(s.size(base).join('x'), '1440x1080')
  const [first] = s.slideIds(base)
  assert.equal(s.slide(base, first).get('layout'), 'title')
  assert.equal(s.elements(base, first).map((e) => e.map.get('role')).join(), 'title,body')
})

test('add, move, duplicate, delete and restore slides', () => {
  const { a } = deck(3)
  const [s1, s2, s3] = s.slideIds(a)
  change(a, (d) => type(d, s1, box(d, s1, 'title'), 'Hello'))
  let s4
  change(a, (d) => { s4 = s.addSlide(d, { after: s1, layout: 'twoColumns' }) })
  assert.equal(order(a), [s1, s4, s2, s3].join())
  assert.equal(s.elements(a, s4).map((e) => e.map.get('role')).join(), 'title,body,body2')
  change(a, (d) => s.moveSlide(d, s1, 3))
  assert.equal(order(a), [s4, s2, s3, s1].join())
  change(a, (d) => s.moveSlide(d, s3, 0))
  assert.equal(order(a), [s3, s4, s2, s1].join())
  let dup
  change(a, (d) => { dup = s.duplicateSlide(d, s1) })
  assert.equal(order(a), [s3, s4, s2, s1, dup].join())
  assert.equal(textOf(a, dup, box(a, dup, 'title')), 'Hello')
  assert.equal(s.elements(a, dup).some((e) => s.element(a, s1, e.id)), false, 'new element ids')
  change(a, (d) => type(d, dup, box(d, dup, 'title'), 'Copy: '))
  assert.equal(textOf(a, s1, box(a, s1, 'title')), 'Hello', 'the copy is separate')
  change(a, (d) => s.deleteSlide(d, s2, 'ab'.repeat(32)))
  assert.equal(order(a), [s3, s4, s1, dup].join())
  assert.equal(s.deletedBy(a, s2), 'ab'.repeat(32))
  assert.equal(s.slideIds(a, { gone: true }).length, 5)
  change(a, (d) => s.restoreSlide(d, s2))
  assert.equal(order(a), [s3, s4, s2, s1, dup].join())
  assert.equal(s.deletedBy(a, s2), null)
})

test('changing the layout moves the boxes and keeps their text', () => {
  const { a } = deck(2)
  const sl = s.slideIds(a)[1]
  const body = box(a, sl, 'body')
  change(a, (d) => { type(d, sl, box(d, sl, 'title'), 'Plan'); type(d, sl, body, 'Point one') })
  change(a, (d) => s.setLayout(d, sl, 'twoColumns'))
  assert.equal(s.elements(a, sl).map((e) => e.map.get('role')).join(), 'title,body,body2')
  assert.equal(s.frame(s.element(a, sl, body)).w, 810)
  assert.equal(textOf(a, sl, body), 'Point one')
  // Title only: the empty second column goes, the body keeps its text and place.
  change(a, (d) => s.setLayout(d, sl, 'titleOnly'))
  assert.equal(s.elements(a, sl).map((e) => e.map.get('role') || 'none').join(), 'title,none')
  assert.equal(textOf(a, sl, body), 'Point one')
  assert.equal(s.slide(a, sl).get('layout'), 'titleOnly')
})

test('stacking order: forward, back, front and back', () => {
  const { a } = deck(1)
  const sl = s.slideIds(a)[0]
  let t1, t2
  change(a, (d) => { t1 = s.addText(d, sl); t2 = s.addText(d, sl) })
  const ids = () => s.elements(a, sl).map((e) => e.id)
  const [title, body] = ids()
  assert.equal(ids().join(), [title, body, t1, t2].join())
  change(a, (d) => s.restack(d, sl, t2, -1))
  assert.equal(ids().join(), [title, body, t2, t1].join())
  change(a, (d) => s.restack(d, sl, title, 'front'))
  assert.equal(ids().join(), [body, t2, t1, title].join())
  change(a, (d) => s.restack(d, sl, title, 'back'))
  assert.equal(ids().join(), [title, body, t2, t1].join())
})

test('shapes and pictures: added, styled, duplicated and listed', () => {
  const { a } = deck(1)
  const sl = s.slideIds(a)[0]
  let rect, line, pic, bad
  change(a, (d) => {
    rect = s.addShape(d, sl, 'roundRect')
    line = s.addShape(d, sl, 'line')
    bad = s.addShape(d, sl, 'hexagram')
    pic = s.addPicture(d, sl, { ref: 'aa:bb', hash: 'cc', mime: 'image/png', w: 4000, h: 1000, alt: 'Wide' })
  })
  assert.equal(bad, null)
  const st = (id, on = sl) => { const x = s.style(s.element(a, on, id)); return [x.shape, x.fill, x.line, x.lineW].join() }
  assert.equal(st(rect), 'roundRect,accent1,none,0')
  assert.equal(st(line), 'line,none,text,6')
  change(a, (d) => s.setStyle(d, sl, rect, { fill: '#ff0000', line: 'javascript:x', lineW: 500 }))
  assert.equal(st(rect), 'roundRect,#ff0000,none,100')
  const f = s.frame(s.element(a, sl, pic))
  assert.equal([f.x, f.y, f.w, f.h].join(), '480,420,960,240')
  assert.equal(s.elements(a, sl).map((e) => e.map.get('type')).join(), 'text,text,shape,shape,picture')
  change(a, (d) => { s.setAlt(d, sl, pic, 'A wide picture'); s.setAlt(d, sl, rect, 'not a picture') })
  assert.equal(s.element(a, sl, pic).get('alt') + '|' + String(s.element(a, sl, rect).get('alt')), 'A wide picture|undefined')
  let dup
  change(a, (d) => { dup = s.duplicateSlide(d, sl) })
  assert.equal(s.pictureRefs(a).map((p) => p.ref).join(), 'aa:bb,aa:bb', 'a copy keeps the reference')
  assert.equal(st(s.elements(a, dup).find((e) => e.map.get('type') === 'shape').id, dup), 'roundRect,#ff0000,none,100')
  change(a, (d) => s.deleteSlide(d, dup))
  assert.equal(s.pictureRefs(a).length, 2, 'a deleted slide keeps its pictures for Restore')
})

test('follow-up fields: opacity, anchor, wrap, crop, arrowheads and custom shapes', () => {
  const { a } = deck(1)
  const sl = s.slideIds(a)[0]
  const title = box(a, sl, 'title')
  const body = box(a, sl, 'body')
  let tri, bad, line, pic
  change(a, (d) => {
    tri = s.addShape(d, sl, 'custom', undefined, { path: 'M0 0 L1000 0 L500 1000 Z' })
    bad = s.addShape(d, sl, 'custom', undefined, { path: 'M0 0 <script>' })
    line = s.addShape(d, sl, 'line')
    pic = s.addPicture(d, sl, { ref: 'aa:bb', hash: 'cc', w: 100, h: 100 })
  })
  assert.equal(bad, null, 'a bad path is refused')
  const look = (id) => { const x = s.style(s.element(a, sl, id)); return [x.shape, x.fillOpacity, x.lineOpacity, x.head, x.tail].join() }
  assert.equal(look(tri), 'custom,1,1,none,none')
  assert.equal(s.style(s.element(a, sl, tri)).path, 'M0 0 L1000 0 L500 1000 Z')
  assert.equal([s.textLayout(s.element(a, sl, title)).anchor, s.textLayout(s.element(a, sl, body)).anchor, s.textLayout(s.element(a, sl, tri)).anchor].join(), 'middle,top,middle')
  change(a, (d) => {
    s.setOpacity(d, sl, tri, { fill: 0.25, line: 9 })
    s.setArrows(d, sl, line, { head: 'oval', tail: 'bomb' })
    assert.equal(s.setArrows(d, sl, tri, { head: 'arrow' }), false, 'only lines have arrowheads')
    s.setAnchor(d, sl, body, 'bottom')
    assert.equal(s.setAnchor(d, sl, body, 'sideways'), false)
    s.setWrap(d, sl, body, false)
    s.setCrop(d, sl, pic, { l: 0.1, t: 0.5, b: 0.6, r: -3 })
  })
  assert.equal(look(tri), 'custom,0.25,1,none,none')
  assert.equal(look(line), 'line,1,1,oval,none')
  assert.equal(JSON.stringify(s.textLayout(s.element(a, sl, body))), '{"anchor":"bottom","wrap":false}')
  assert.equal(JSON.stringify(s.crop(s.element(a, sl, pic))), '{"l":0.1,"t":0,"r":0,"b":0}', 'top and bottom over 0.95 dropped')
  change(a, (d) => { s.setWrap(d, sl, body, true); s.setCrop(d, sl, pic, { l: 0 }) })
  assert.equal(s.element(a, sl, body).has('wrap') + '|' + s.element(a, sl, pic).has('crop'), 'false|false')
  // Stored nonsense draws safely: a custom shape with a bad path is a box.
  change(a, (d) => { s.element(d, sl, tri).set('path', 'javascript:1'); s.element(d, sl, line).set('fillOpacity', 'x') })
  assert.equal(s.style(s.element(a, sl, tri)).shape + '|' + s.style(s.element(a, sl, line)).fillOpacity, 'rect|1')
})

test('charts: added, cleaned, changed and duplicated', () => {
  const { a } = deck(1)
  const sl = s.slideIds(a)[0]
  let c
  change(a, (d) => {
    c = s.addChart(d, sl, {
      chart: { type: 'pie', title: 'Sales', legend: 'sideways', dataLabels: 'yes' },
      data: { categories: ['Q1', 2, {}], series: [{ name: 'A', values: [1, 'x', 3, Infinity], color: '#ff0000' }, { values: [2], color: 'red' }, ...Array(20).fill({ name: 'z', values: [] })] }
    })
  })
  const got = () => s.chartOf(s.element(a, sl, c))
  assert.equal(JSON.stringify(got().chart), '{"type":"pie","title":"Sales"}')
  assert.equal(got().data.categories.join('|'), 'Q1|2|')
  assert.equal(got().data.series.length, 10)
  assert.equal(JSON.stringify(got().data.series.slice(0, 2)), '[{"name":"A","values":[1,null,3,null],"color":"#ff0000"},{"name":"Series 2","values":[2]}]')
  change(a, (d) => s.setChart(d, sl, c, { chart: { type: 'line', stacked: true } }))
  assert.equal(JSON.stringify(got().chart), '{"type":"line","title":"Sales","stacked":true}')
  change(a, (d) => s.setChart(d, sl, c, { chart: { type: 'gantt' } }))
  assert.equal(got().chart.type, 'column', 'unknown types draw as columns')
  let dup
  change(a, (d) => { dup = s.duplicateSlide(d, sl) })
  const copy = s.elements(a, dup).find((e) => e.map.get('type') === 'chart')
  assert.equal(s.chartOf(copy.map).data.series[0].name, 'A')
})

test('concurrent: different fields of one shape both survive', () => {
  const { state, a, b } = deck(1)
  const sl = s.slideIds(a)[0]
  let el
  const u0 = change(a, (d) => { el = s.addShape(d, sl, 'rect') })
  Y.applyUpdate(b, u0)
  const start = Y.encodeStateAsUpdate(a)
  const ua = change(a, (d) => s.setOpacity(d, sl, el, { fill: 0.5 }))
  const ub = change(b, (d) => { s.setAnchor(d, sl, el, 'bottom'); s.setStyle(d, sl, el, { fill: '#00ff00' }) })
  const [x, y] = bothOrders(start, ua, ub)
  for (const d of [x, y]) {
    const st = s.style(s.element(d, sl, el))
    assert.equal([st.fillOpacity, st.fill, s.textLayout(s.element(d, sl, el)).anchor].join(), '0.5,#00ff00,bottom')
  }
  assert.equal(state.byteLength > 0, true)
})

test('bad values from another member are clamped or skipped', () => {
  const { a } = deck(1)
  const sl = s.slideIds(a)[0]
  const els = s.slide(a, sl).get('els')
  change(a, (d) => {
    const odd = new Y.Map()
    odd.set('type', 'hologram')
    odd.set('z', 'z')
    els.set('odd', odd)
    s.element(d, sl, box(d, sl, 'title')).set('frame', { x: 1e9, y: 'x', w: -5, h: 50, rot: 725 })
  })
  assert.equal(s.elements(a, sl).length, 2, 'unknown type skipped')
  const f = s.frame(s.element(a, sl, box(a, sl, 'title')))
  assert.equal([f.x, f.y, f.w, f.h, f.rot].join(), '30000,0,1,50,5')
})

test('concurrent: both people move the same slide; one copy, same order everywhere', () => {
  const { state, a, b } = deck(4)
  const [s1, s2, s3, s4] = s.slideIds(a)
  const ua = change(a, (d) => s.moveSlide(d, s1, 3)) // to the end
  const ub = change(b, (d) => s.moveSlide(d, s1, 1)) // after s2
  const [x, y] = bothOrders(state, ua, ub)
  assert.equal(order(x), order(y))
  assert.equal(s.slideIds(x).filter((id) => id === s1).length, 1)
  assert.equal(s.slideIds(x).length, 4)
  const want = [[s2, s3, s4, s1].join(), [s2, s1, s3, s4].join()]
  assert.equal(want.includes(order(x)), true, order(x))
})

test('concurrent: two slides moved into the same gap both stay', () => {
  const { state, a, b } = deck(4)
  const [s1, s2, s3, s4] = s.slideIds(a)
  // Both into the gap between s2 and s3.
  const ua = change(a, (d) => s.moveSlide(d, s1, 1))
  const ub = change(b, (d) => s.moveSlide(d, s4, 2))
  const [x, y] = bothOrders(state, ua, ub)
  assert.equal(order(x), order(y))
  const got = s.slideIds(x)
  assert.equal(got.length, 4)
  assert.equal(got[0], s2)
  assert.equal(got[3], s3)
  assert.equal([got[1], got[2]].sort().join(), [s1, s4].sort().join())
})

test('concurrent: both reorder the whole deck at once', () => {
  const { state, a, b } = deck(6)
  const ids = s.slideIds(a)
  const ua = change(a, (d) => { s.moveSlide(d, ids[0], 5); s.moveSlide(d, ids[3], 0); s.moveSlide(d, ids[2], 4) })
  const ub = change(b, (d) => { s.moveSlide(d, ids[5], 0); s.moveSlide(d, ids[0], 2); s.moveSlide(d, ids[4], 1) })
  const [x, y] = bothOrders(state, ua, ub)
  assert.equal(order(x), order(y))
  assert.equal(s.slideIds(x).slice().sort().join(), ids.slice().sort().join(), 'each slide once')
})

test('concurrent: both add a slide in the same place', () => {
  const { state, a, b } = deck(2)
  const [s1, s2] = s.slideIds(a)
  let na, nb
  const ua = change(a, (d) => { na = s.addSlide(d, { after: s1 }) })
  const ub = change(b, (d) => { nb = s.addSlide(d, { after: s1 }) })
  const [x, y] = bothOrders(state, ua, ub)
  assert.equal(order(x), order(y))
  const got = s.slideIds(x)
  assert.equal(got.length, 4)
  assert.equal(got[0] + got[3], s1 + s2)
  assert.equal([got[1], got[2]].sort().join(), [na, nb].sort().join())
})

test('concurrent: a slide deleted while someone types on it keeps their text', () => {
  const { state, a, b } = deck(3)
  const sl = s.slideIds(a)[1]
  const ua = change(a, (d) => s.deleteSlide(d, sl))
  const ub = change(b, (d) => type(d, sl, box(d, sl, 'title'), 'Still typing'))
  const [x, y] = bothOrders(state, ua, ub)
  for (const d of [x, y]) {
    assert.equal(s.slideIds(d).includes(sl), false)
    assert.equal(textOf(d, sl, box(d, sl, 'title')), 'Still typing')
  }
  change(x, (d) => s.restoreSlide(d, sl))
  assert.equal(s.slideIds(x).includes(sl), true)
  assert.equal(textOf(x, sl, box(x, sl, 'title')), 'Still typing')
})

test('concurrent: two people move the same box; it lands where one of them put it', () => {
  const { state, a, b } = deck(1)
  const sl = s.slideIds(a)[0]
  const el = box(a, sl, 'title')
  const ua = change(a, (d) => s.setFrame(d, sl, el, { x: 100, y: 200, w: 800, h: 100, rot: 0 }))
  const ub = change(b, (d) => s.setFrame(d, sl, el, { x: 900, y: 50, w: 400, h: 300, rot: 30 }))
  const [x, y] = bothOrders(state, ua, ub)
  const fx = JSON.stringify(s.frame(s.element(x, sl, el)))
  assert.equal(fx, JSON.stringify(s.frame(s.element(y, sl, el))))
  const options = [{ x: 100, y: 200, w: 800, h: 100, rot: 0 }, { x: 900, y: 50, w: 400, h: 300, rot: 30 }].map((f) => JSON.stringify(f))
  assert.equal(options.includes(fx), true, 'one person\'s whole frame, not a mix: ' + fx)
})

test('concurrent: moving a box while someone types in it keeps both', () => {
  const { state, a, b } = deck(1)
  const sl = s.slideIds(a)[0]
  const el = box(a, sl, 'title')
  const ua = change(a, (d) => s.setFrame(d, sl, el, { x: 10, y: 20, w: 300, h: 400, rot: 90 }))
  const ub = change(b, (d) => type(d, sl, el, 'Typed'))
  const [x, y] = bothOrders(state, ua, ub)
  for (const d of [x, y]) {
    assert.equal(s.frame(s.element(d, sl, el)).rot, 90)
    assert.equal(textOf(d, sl, el), 'Typed')
  }
})

test('concurrent: typing in the same box from both sides', () => {
  const { state, a, b } = deck(1)
  const sl = s.slideIds(a)[0]
  const el = box(a, sl, 'title')
  const u0 = change(a, (d) => type(d, sl, el, 'hello'))
  Y.applyUpdate(b, u0)
  const start = Y.encodeStateAsUpdate(a)
  const ua = change(a, (d) => s.element(d, sl, el).get('text').get(0).get(0).insert(0, 'A '))
  const ub = change(b, (d) => s.element(d, sl, el).get('text').get(0).get(0).insert(5, ' B'))
  const [x, y] = bothOrders(start, ua, ub)
  assert.equal(textOf(x, sl, el), 'A hello B')
  assert.equal(textOf(y, sl, el), 'A hello B')
})

test('concurrent: a box removed while someone moves it stays removed', () => {
  const { state, a, b } = deck(1)
  const sl = s.slideIds(a)[0]
  const el = box(a, sl, 'body')
  const ua = change(a, (d) => s.removeElement(d, sl, el))
  const ub = change(b, (d) => s.setFrame(d, sl, el, { x: 1, y: 2, w: 3, h: 4, rot: 0 }))
  const [x, y] = bothOrders(state, ua, ub)
  for (const d of [x, y]) assert.equal(s.elements(d, sl).length, 1)
})

test('slide decks between devices', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name) {
    const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: mkSwarm, onEvent: () => {} })
    engines.push(e)
    await e.init({})
    await call(e, 'app:setName', { name })
    return e
  }
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })

  // A device's deck as the editor's copy would load it.
  async function replica (engine, sheetId) {
    const st = await call(engine, 'slides:state', { sheetId })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, b4a.from(st.state, 'base64'))
    return doc
  }
  async function edit (engine, sheetId, fn) {
    const doc = await replica(engine, sheetId)
    const update = change(doc, fn)
    doc.destroy()
    return call(engine, 'slides:update', { sheetId, update: b4a.toString(update, 'base64') })
  }
  async function read (engine, sheetId, fn) {
    const doc = await replica(engine, sheetId)
    try { return fn(doc) } finally { doc.destroy() }
  }
  const summary = (engine, sheetId) => read(engine, sheetId, (d) => order(d) + '|' + s.plainText(d))

  const owner = await device('Owner')
  const editor = await device('Editor')
  const viewer = await device('Viewer')
  const { sheetId } = await call(owner, 'slides:create', { title: 'Talk' })

  await t.test('a new deck is listed as slides', async () => {
    const f = (await call(owner, 'file:list')).find((x) => x.sheetId === sheetId)
    assert.equal(f && f.kind, 'slides')
    assert.equal(f && f.title, 'Talk')
    const st = await call(owner, 'slides:state', { sheetId })
    assert.equal([st.myRole, st.loading, st.newer].join(), 'owner,false,false')
    assert.equal(await read(owner, sheetId, (d) => s.slideIds(d).length), 1)
  })

  await t.test('the owner adds slides and types', async () => {
    await edit(owner, sheetId, (d) => {
      const [first] = s.slideIds(d)
      type(d, first, box(d, first, 'title'), 'Welcome')
      for (const name of ['One', 'Two', 'Three']) {
        const id = s.addSlide(d, { layout: 'content' })
        type(d, id, box(d, id, 'title'), name)
      }
    })
    assert.equal(await read(owner, sheetId, (d) => s.plainText(d)), 'Welcome\n\n---\nOne\n\n---\nTwo\n\n---\nThree\n')
  })

  await t.test('a document update cannot go into a deck', async () => {
    await assert.rejects(call(owner, 'doc:update', { sheetId, update: 'AAA=' }), /Not a document/)
  })

  let link
  await t.test('a deck invite link says it is slides', async () => {
    link = (await call(owner, 'file:invite', { sheetId, role: 'editor' })).link
    assert.match(link, /[?&]f=slides(&|$)/)
    assert.equal(m.parseInviteLink(link).kind, 'slides')
  })

  await t.test('an editor joins and sees the deck', async () => {
    await call(editor, 'file:join', { link })
    await waitFor('editor joined', async () => (await call(editor, 'slides:state', { sheetId })).myRole === 'editor')
    const want = await summary(owner, sheetId)
    await waitFor('editor has the deck', async () => (await summary(editor, sheetId)) === want)
    await waitFor('editor writable', async () => editor.bases.get(sheetId).writable)
    assert.equal((await call(editor, 'file:list')).find((x) => x.sheetId === sheetId)?.kind, 'slides')
  })

  await t.test('both move the same slide at once: one copy, same order on both', async () => {
    const ids = await read(owner, sheetId, (d) => s.slideIds(d))
    await Promise.all([
      edit(owner, sheetId, (d) => s.moveSlide(d, ids[1], 3)),
      edit(editor, sheetId, (d) => s.moveSlide(d, ids[1], 0))
    ])
    await waitFor('same order', async () => (await summary(owner, sheetId)) === (await summary(editor, sheetId)))
    const got = await read(owner, sheetId, (d) => s.slideIds(d))
    assert.equal(got.length, 4)
    assert.equal(got.filter((id) => id === ids[1]).length, 1)
  })

  await t.test('a slide deleted while the other types on it keeps the text', async () => {
    const victim = await read(owner, sheetId, (d) => s.slideIds(d).find((id) => textOf(d, id, box(d, id, 'title')) === 'Two'))
    await Promise.all([
      edit(owner, sheetId, (d) => s.deleteSlide(d, victim)),
      edit(editor, sheetId, (d) => type(d, victim, box(d, victim, 'title'), 'Late '))
    ])
    const check = (d) => s.slideIds(d).includes(victim) + '|' + textOf(d, victim, box(d, victim, 'title'))
    await waitFor('owner', async () => (await read(owner, sheetId, check)) === 'false|Late Two')
    await waitFor('editor', async () => (await read(editor, sheetId, check)) === 'false|Late Two')
  })

  await t.test('both move the same box: whole frame from one of them', async () => {
    const [first] = await read(owner, sheetId, (d) => s.slideIds(d))
    const el = await read(owner, sheetId, (d) => box(d, first, 'title'))
    const fa = { x: 11, y: 22, w: 333, h: 44, rot: 0 }
    const fb = { x: 555, y: 66, w: 77, h: 888, rot: 45 }
    await Promise.all([
      edit(owner, sheetId, (d) => s.setFrame(d, first, el, fa)),
      edit(editor, sheetId, (d) => s.setFrame(d, first, el, fb))
    ])
    const frameOf = (d) => JSON.stringify(s.frame(s.element(d, first, el)))
    await waitFor('same frame', async () => (await read(owner, sheetId, frameOf)) === (await read(editor, sheetId, frameOf)))
    assert.equal([JSON.stringify(fa), JSON.stringify(fb)].includes(await read(owner, sheetId, frameOf)), true)
  })

  await t.test('a viewer cannot edit', async () => {
    const { link } = await call(owner, 'file:invite', { sheetId, role: 'viewer' })
    await call(viewer, 'file:join', { link })
    await waitFor('viewer joined', async () => (await call(viewer, 'slides:state', { sheetId })).myRole === 'viewer')
    await assert.rejects(edit(viewer, sheetId, (d) => s.addSlide(d)), /view this file but not edit/)
  })

  await t.test('a deck made from a file', async () => {
    const scratch = new Y.Doc()
    const update = change(scratch, (d) => {
      const first = s.initDeck(d, { title: 'From pptx' })
      type(d, first, box(d, first, 'title'), 'Imported title')
      s.addShape(d, first, 'ellipse')
    })
    scratch.destroy()
    const { sheetId: id } = await call(owner, 'slides:import', { title: 'From pptx', update: b4a.toString(update, 'base64') })
    assert.equal((await call(owner, 'file:list')).find((x) => x.sheetId === id)?.kind, 'slides')
    assert.equal(await read(owner, id, (d) => s.plainText(d) + '|' + s.elements(d, s.slideIds(d)[0]).length), 'Imported title\n\n|3')
    const sheetDoc = new Y.Doc()
    sheetDoc.getMap('meta').set('kind', 'sheet')
    await assert.rejects(call(owner, 'slides:import', { update: b4a.toString(Y.encodeStateAsUpdate(sheetDoc), 'base64') }), /could not be read/)
    await assert.rejects(call(owner, 'slides:import', { update: 'not base64 yjs' }), /could not be read/)
  })

  await t.test('tidying up a deck keeps its slides', async () => {
    const before = await summary(owner, sheetId)
    const { sheetId: newId } = await call(owner, 'file:compact', { sheetId })
    assert.notEqual(newId, sheetId)
    assert.equal(await summary(owner, newId), before)
    assert.equal((await call(owner, 'file:list')).find((x) => x.sheetId === newId)?.kind, 'slides')
    await waitFor('editor has the new copy', async () => {
      const to = (await editor.localDb.get('moves:' + sheetId))?.value?.to
      return to === newId && (await summary(editor, newId)) === before
    }, { timeout: 60000 })
  })
})
