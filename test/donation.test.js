// The donation nudge: once, two weeks after first use (as in the other
// PeerLoom apps).

const test = require('node:test')
const assert = require('node:assert/strict')
const { createFileMethods } = require('../src/worklet/fileMethods')

function fakeDb () {
  const rows = new Map()
  return {
    rows,
    async get (key) { return rows.has(key) ? { key, value: rows.get(key) } : null },
    async put (key, value) { rows.set(key, value) }
  }
}

test('the donation nudge is due once, two weeks after first use', async () => {
  const methods = createFileMethods(null, {})
  const ctx = { localDb: fakeDb() }
  assert.equal((await methods['donation:status']({}, ctx)).due, false, 'not on the first day')
  const first = ctx.localDb.rows.get('donateReminder').firstUseAt
  assert.ok(Math.abs(first - Date.now()) < 1000)

  ctx.localDb.rows.set('donateReminder', { firstUseAt: Date.now() - 13 * 24 * 3600 * 1000, shown: false })
  assert.equal((await methods['donation:status']({}, ctx)).due, false, 'not after 13 days')
  ctx.localDb.rows.set('donateReminder', { firstUseAt: Date.now() - 14 * 24 * 3600 * 1000 - 1, shown: false })
  assert.equal((await methods['donation:status']({}, ctx)).due, true, 'due after 14 days')

  await methods['donation:dismiss']({}, ctx)
  assert.equal((await methods['donation:status']({}, ctx)).due, false, 'never again once shown')
})
