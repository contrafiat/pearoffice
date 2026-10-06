// Each file records its kind (proposals/2026-10-06-rename-to-pearoffice.md,
// step 2): new files are sheets, older ones count as sheets, and an invite
// for a kind this build does not know asks for a newer version.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const model = require('../src/shared/sheetModel')
const m = require('../src/worklet/membership')

test('new files are sheets, and files without a kind count as sheets', () => {
  const doc = model.createDoc()
  assert.equal(model.kind(doc), 'sheet', 'before any kind is set')
  model.initSheet(doc, { title: 'Plans' })
  assert.equal(doc.getMap('meta').get('kind'), 'sheet')
  assert.equal(model.kind(doc), 'sheet')
})

test('invite links carry the kind', () => {
  const args = { sheetId: 'ab'.repeat(16), groupKey: 'cd'.repeat(32), inviteId: 'ef'.repeat(16), seed: b4a.alloc(32, 7), owner: '12'.repeat(32), role: 'editor' }
  const link = m.inviteLink(args)
  assert.match(link, /[?&]f=sheet(&|$)/)
  assert.equal(m.parseInviteLink(link).kind, 'sheet')
  assert.equal(m.parseInviteLink(link.replace('&f=sheet', '')).kind, 'sheet', 'a link without a kind is a sheet')
  assert.throws(() => m.parseInviteLink(link.replace('f=sheet', 'f=doc')), /newer version/)
})
