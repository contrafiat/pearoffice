// Links to PearCal events and days
// (/home/tim/peerloomllc/proposals/2026-10-26-pearcal-pearoffice-links.md):
// the exact patterns, the model and okLink taking them, and app:openUrl's
// list on desktop.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { Window } = require('happy-dom')
const { pearcalLink, isPearcalLink, pearcalLabel, dayLink } = require('../src/shared/pearcal')
const { okLink } = require('../src/shared/links')
const { urlKind, openUrl } = require('../desktop/open-url')
const model = require('../src/sheet/sheetModel')

// PearCal's own formats (pearcal-native PR #388): a calendar id of up to 64
// of A-Z a-z 0-9 _ -, an event id of up to 256 of A-Z a-z 0-9 . _ ~ % -
// (encodeURIComponent of the id, which for an .ics import can hold @ or a
// dot), a real day, no query string and no trailing slash.
const ICS_ID = '040000008200E00074C5B7101A82E008@outlook.example.com'
const GOOD = [
  'pearcal://event/g4k2x9a/e1730000000000_r2',
  'pearcal://event/g4k2x9a/e1730000000000',
  'pearcal://event/g4k2x9a/e1730000000000_v2',
  'pearcal://event/g4k2x9a/e1730000000000_v2_r17',
  'pearcal://event/g4k2x9a/e1730000000000-k3x9q',
  'pearcal://event/g4k2x9a/' + encodeURIComponent(ICS_ID),
  'pearcal://event/g4k2x9a/' + encodeURIComponent('abc.def~x_y-z'),
  'pearcal://event/Some_Cal-1/x',
  'pearcal://event/' + 'a'.repeat(64) + '/' + 'b'.repeat(256),
  'pearcal://day/2026-10-27',
  'pearcal://day/2028-02-29'
]
const BAD = [
  'pearcal://event/g4k2x9a',
  'pearcal://event/g4k2x9a/',
  'pearcal://event//e1730000000000',
  'pearcal://event/' + 'a'.repeat(65) + '/e1', // calendar id too long
  'pearcal://event/g4k2x9a/' + 'b'.repeat(257), // event id too long
  'pearcal://event/g4k.2x9a/e1730000000000', // a dot in the calendar id
  'pearcal://event/g4k2x9a/' + ICS_ID, // @ not encoded
  'pearcal://event/g4k2x9a/a+b',
  'pearcal://event/g4k2x9a/a b',
  'pearcal://event/g4k2x9a/e1730000000000/',
  'pearcal://event/g4k2x9a/e1730000000000/extra',
  'pearcal://event/g4k2x9a/e1730000000000?x=1',
  'pearcal://event/g4k2x9a/e1730000000000#x',
  'pearcal://event/g4k2x9a/e1730000000000 ',
  ' pearcal://day/2026-10-27',
  'PEARCAL://day/2026-10-27',
  'pearcal:day/2026-10-27',
  'pearcal://day/2026-1-27',
  'pearcal://day/2026-13-01',
  'pearcal://day/2026-10-32',
  'pearcal://day/2026-02-30', // fits the pattern, not a day
  'pearcal://day/2027-02-29',
  'pearcal://day/26-10-27',
  'pearcal://day/2026-10-27/',
  'pearcal://day/2026-10-27?x=1',
  'pearcal://day/2026-10-27T10:00',
  'pearcal://join?invite=abc',
  'pearcal://pair?x=1',
  'pearcal://week/2026-10-27',
  'pearcal://event/g4k2x9a/e1730000000000\n'
]

test('the PearCal patterns take events and days and nothing near them', () => {
  for (const g of GOOD) assert.equal(isPearcalLink(g), true, g)
  for (const b of BAD) assert.equal(isPearcalLink(b), false, b)
  assert.equal(isPearcalLink(null), false)
  assert.deepEqual(pearcalLink('pearcal://event/g4k2x9a/e1730000000000_r2'), { calendar: 'g4k2x9a', event: 'e1730000000000_r2' })
  // An .ics event's own id, encoded as PearCal's Copy link does.
  const ics = pearcalLink('pearcal://event/g4k2x9a/' + encodeURIComponent(ICS_ID))
  assert.equal(decodeURIComponent(ics.event), ICS_ID)
  assert.deepEqual(pearcalLink('pearcal://day/2026-10-27'), { day: '2026-10-27' })
  assert.equal(dayLink('2026-10-27'), 'pearcal://day/2026-10-27')
})

test('a link card names an event and shows a day as a date', () => {
  assert.equal(pearcalLabel('pearcal://event/g4k2x9a/' + encodeURIComponent(ICS_ID)), 'PearCal event')
  const day = pearcalLabel('pearcal://day/2026-10-27')
  assert.match(day, /2026/)
  assert.match(day, /27/)
  assert.equal(pearcalLabel('https://example.com'), null)
})

test('the desktop copy of the patterns agrees with the shared one', () => {
  for (const u of [...GOOD, ...BAD]) assert.equal(urlKind(u) === 'pearcal', isPearcalLink(u), u)
})

test('okLink keeps PearCal links on pictures and shapes and drops near misses', () => {
  for (const g of GOOD) assert.equal(okLink(g), g, g)
  for (const b of BAD.filter((x) => x.trim() === x)) assert.equal(okLink(b), null, b)
})

test('a cell can link to a PearCal event or day, and near misses are refused', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  for (const g of GOOD) {
    model.setLink(doc, tab, 1, 1, 1, 1, g)
    assert.equal(model.getFormat(doc, tab, 1, 1).link, g)
    model.setFormat(doc, tab, 2, 1, { link: g })
    assert.equal(model.getFormat(doc, tab, 2, 1).link, g)
  }
  for (const b of BAD.filter((x) => x.trim() === x)) {
    assert.throws(() => model.setLink(doc, tab, 3, 1, 3, 1, b), /Links can go/, b)
    assert.throws(() => model.setFormat(doc, tab, 3, 1, { link: b }), /bad value/, b)
  }
})

test('the document editor keeps PearCal links only in their exact form', async () => {
  globalThis.window = new Window()
  globalThis.document = window.document
  window.pearoffice = { call: async () => ({}), on: () => () => {} }
  const { linkAllowed } = await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'extensions.js'))
  const ctx = { defaultValidate: (u) => /^(https?:|mailto:|pearoffice:)/.test(u) }
  for (const g of GOOD) assert.equal(linkAllowed(g, ctx), true, g)
  for (const b of BAD.filter((x) => /^pearcal:/.test(x))) assert.equal(linkAllowed(b, ctx), false, b)
  assert.equal(linkAllowed('https://example.com', ctx), true)
  assert.equal(linkAllowed('javascript:alert(1)', ctx), false)
})

test('desktop app:openUrl opens web and PearCal links and says when PearCal is missing', async () => {
  const opened = []
  const open = async (u) => { opened.push(u) }
  assert.deepEqual(await openUrl('https://peerloomllc.com/pearcal', { open }), { ok: true })
  assert.deepEqual(await openUrl('pearcal://day/2026-10-27', { open }), { ok: true })
  assert.deepEqual(await openUrl('pearcal://event/g4k2x9a/e1730000000000_r2', { open }), { ok: true })
  // Not on the list: nothing opens.
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'pearcal://join?x=1', 'pearcal://day/2026-02-30', 'pearoffice://file/x']) {
    assert.deepEqual(await openUrl(u, { open }), { ok: true }, u)
  }
  assert.deepEqual(opened, ['https://peerloomllc.com/pearcal', 'pearcal://day/2026-10-27', 'pearcal://event/g4k2x9a/e1730000000000_r2'])
  // PearCal not installed: the system cannot open it, or says no app takes it.
  const fails = async () => { throw new Error('Failed to open') }
  assert.deepEqual(await openUrl('pearcal://day/2026-10-27', { open: fails }), { ok: false, notInstalled: true })
  assert.deepEqual(await openUrl('pearcal://day/2026-10-27', { open, hasApp: () => false }), { ok: false, notInstalled: true })
  assert.equal(opened.length, 3)
  // A web link that fails still fails as before.
  await assert.rejects(openUrl('https://x.y', { open: fails }), /Failed to open/)
})
