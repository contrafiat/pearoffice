// The first-run welcome and tour: shown once per device, and never on a
// device that was already in use (it has a file or a name).

const test = require('node:test')
const assert = require('node:assert/strict')
const { createFileMethods } = require('../src/worklet/fileMethods')

function fakeDb () {
  const rows = new Map()
  return {
    rows,
    async get (key) { return rows.has(key) ? { key, value: rows.get(key) } : null },
    async put (key, value) { rows.set(key, value) },
    async del (key) { rows.delete(key) },
    async * createReadStream ({ gt, lt, limit = Infinity }) {
      const keys = [...rows.keys()].filter((k) => k > gt && k < lt).sort().slice(0, limit)
      for (const key of keys) yield { key, value: rows.get(key) }
    }
  }
}

function setup ({ name = '' } = {}) {
  const profile = { name, avatar: null }
  const methods = createFileMethods(null, { getProfiles: () => ({ local: async () => profile }) })
  return { methods, profile, ctx: { localDb: fakeDb() } }
}

test('a fresh device sees the tour until it is marked done', async () => {
  const { methods, ctx } = setup()
  assert.equal((await methods['app:onboarding']({}, ctx)).done, false)
  assert.equal((await methods['app:onboarding']({}, ctx)).done, false, 'asking does not mark it done')
  assert.equal((await methods['app:onboarded']({}, ctx)).ok, true)
  assert.equal((await methods['app:onboarding']({}, ctx)).done, true)
  assert.equal(ctx.localDb.rows.has('onboarded'), true)
})

test('a device with a file counts as done', async () => {
  const { methods, ctx } = setup()
  ctx.localDb.rows.set('groups:joined:abc', { groupId: 'abc' })
  assert.equal((await methods['app:onboarding']({}, ctx)).done, true)
  assert.equal(ctx.localDb.rows.has('onboarded'), false, 'nothing written')
})

test('a device with a name counts as done', async () => {
  const { methods, ctx, profile } = setup({ name: 'Ada' })
  assert.equal((await methods['app:onboarding']({}, ctx)).done, true)
  profile.name = ''
  assert.equal((await methods['app:onboarding']({}, ctx)).done, false)
})

test('other local rows do not count as a file', async () => {
  const { methods, ctx } = setup()
  ctx.localDb.rows.set('groups:joinedX', 1)
  ctx.localDb.rows.set('phraseNudged', { at: 1 })
  ctx.localDb.rows.set('removed:abc', { reason: 'removed' })
  assert.equal((await methods['app:onboarding']({}, ctx)).done, false)
})

test('a name set during onboarding does not skip the rest of it', async () => {
  const { methods, ctx, profile } = setup()
  assert.equal((await methods['app:onboarding']({}, ctx)).done, false)
  profile.name = 'Ada' // set on the name step, then the app was closed
  ctx.localDb.rows.set('groups:joined:abc', { groupId: 'abc' })
  assert.equal((await methods['app:onboarding']({}, ctx)).done, false, 'the tour comes back')
  await methods['app:onboarded']({}, ctx)
  assert.equal((await methods['app:onboarding']({}, ctx)).done, true)
})

test('the welcome back note shows after a restore until it is dismissed', async () => {
  const { methods, ctx } = setup()
  assert.equal((await methods['app:welcomeBack']({}, ctx)).show, false)
  assert.equal((await methods['app:setWelcomeBack']({ show: true }, ctx)).show, true)
  assert.equal((await methods['app:welcomeBack']({}, ctx)).show, true)
  assert.equal((await methods['app:welcomeBack']({}, ctx)).show, true, 'asking does not clear it')
  assert.equal((await methods['app:setWelcomeBack']({ show: false }, ctx)).show, false)
  assert.equal((await methods['app:welcomeBack']({}, ctx)).show, false)
  assert.equal(ctx.localDb.rows.has('welcomeBack'), false)
})
