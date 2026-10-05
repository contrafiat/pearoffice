// Tidying up a sheet (proposals/2026-10-05-shared-compaction.md): a move to
// fresh keys that keeps everyone. The history becomes one update, everyone
// follows, edits made offline are carried across, an unused invite link
// blocks it, and the frozen copy stays until everyone has followed.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const countY = async (e, sheetId) => { let n = 0; for await (const _ of e.bases.get(sheetId).view.createReadStream({ gt: 'y/', lt: 'y/~' })) n++; return n }

test('tidying up a sheet', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name, dir = tmpDir(), opts = {}) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm, ...opts })
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

  const owner = await device('Owner', tmpDir(), { compactAt: 30 })
  const editor = await device('Editor')
  const viewer = await device('Viewer')
  const awayDir = tmpDir()
  let away = await device('Away', awayDir)

  const { sheetId: oldId } = await call(owner, 'sheet:create', { title: 'Budget' })
  for (const [who, role] of [[editor, 'editor'], [viewer, 'viewer'], [away, 'editor']]) {
    const { link } = await call(owner, 'sheet:invite', { sheetId: oldId, role })
    await call(who, 'sheet:join', { link })
    await waitFor(role + ' joined', async () => (await call(who, 'sheet:view', { sheetId: oldId })).myRole === role)
  }
  await waitFor('away writable', async () => away.bases.get(oldId).writable)
  // A long history: one cell overwritten many times.
  for (let i = 1; i <= 25; i++) await call(owner, 'sheet:setCell', { sheetId: oldId, row: 1, col: 1, input: String(i) })
  await waitFor('away has it', async () => (await grid(away, oldId))['1,1'] === '25')

  // Away goes offline, then edits: these edits exist only on that device.
  await away.swarm.destroy()
  await call(away, 'sheet:setCell', { sheetId: oldId, row: 2, col: 1, input: 'typed offline' })
  await away.close()

  await t.test('an unused invite link blocks it', async () => {
    const { inviteId } = await call(owner, 'sheet:invite', { sheetId: oldId, role: 'viewer' })
    assert.equal((await call(owner, 'sheet:history', { sheetId: oldId })).openInvites, 1)
    await assert.rejects(call(owner, 'sheet:compact', { sheetId: oldId }), /invite link/)
    await owner.autoCompact(oldId)
    assert.equal(await owner.bases.get(oldId).view.get('moved'), null, 'the automatic run waits too')
    await call(owner, 'sheet:cancelInvite', { sheetId: oldId, inviteId })
    await waitFor('invite cancelled', async () => (await call(owner, 'sheet:history', { sheetId: oldId })).openInvites === 0)
  })

  let newId
  await t.test('the owner tidies up by itself past the threshold', async () => {
    const before = (await call(owner, 'sheet:history', { sheetId: oldId })).updates
    assert.ok(before >= 30, 'history of ' + before)
    await owner.autoCompact(oldId)
    const rec = (await owner.localDb.get('moves:' + oldId)).value
    assert.equal(rec.reason, 'compact')
    newId = rec.to
    assert.equal((await owner.bases.get(oldId).view.get('moved')).value.reason, 'compact')
    assert.equal((await grid(owner, newId))['1,1'], '25')
    assert.equal(await countY(owner, newId), 1, 'the new history is one update')
    const { members } = await call(owner, 'sheet:members', { sheetId: newId })
    assert.deepEqual(members.map((x) => x.name + '/' + x.role).sort(), ['Away/editor', 'Editor/editor', 'Owner/owner', 'Viewer/viewer'])
  })

  await t.test('an editor and a viewer follow', async () => {
    await waitFor('editor follows', async () => editor.bases.get(newId)?.writable && (await call(editor, 'sheet:view', { sheetId: newId })).myRole === 'editor')
    const v = await call(editor, 'sheet:view', { sheetId: oldId })
    assert.ok(v.frozen && v.frozen.tidied, 'the old copy says it was tidied, not that someone was removed')
    await call(editor, 'sheet:setCell', { sheetId: newId, row: 3, col: 1, input: 'after' })
    await waitFor('viewer sees it', async () => (await grid(viewer, newId).catch(() => ({})))['3,1'] === 'after')
  })

  await t.test('the frozen copy stays while someone has not followed', async () => {
    await owner.checkTidied(oldId)
    const rec = (await owner.localDb.get('moves:' + oldId)).value
    assert.ok(!rec.followedAt && !rec.dropAsked)
    assert.ok(owner.bases.get(oldId))
  })

  await t.test('edits made offline are carried into the new sheet', async () => {
    away = await device('Away', awayDir)
    await waitFor('away follows', async () => away.bases.get(newId)?.writable, { timeout: 40000 })
    await waitFor('owner has the offline edit', async () => (await grid(owner, newId))['2,1'] === 'typed offline', { timeout: 30000 })
    assert.equal((await grid(owner, newId))['1,1'], '25')
  })

  await t.test('once everyone has followed, the old copy is let go', async () => {
    await waitFor('everyone followed', async () => {
      await owner.checkTidied(oldId)
      const rec = (await owner.localDb.get('moves:' + oldId)).value
      return rec.followedAt && rec.dropAsked
    })
  })
})
