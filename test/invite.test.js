// Invites, roles and membership over a local DHT testnet (proposal sections 4
// and 5): single-use invites, expiry, viewers cannot write, role changes,
// forged ops are skipped, and the link never carries the encryption key.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { signValue } = require('@peerloom/core/records')
const { createSheetEngine } = require('../src/worklet/engine')
const m = require('../src/worklet/membership')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

test('invites, roles and membership', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name) {
    const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: mkSwarm })
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

  const owner = await device('Olive')
  const editor = await device('Ed')
  const viewer = await device('Vi')
  const late = await device('Late')

  const { sheetId } = await call(owner, 'sheet:create', { title: 'Family budget' })
  await call(owner, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'secret-rent' })
  assert.equal((await call(owner, 'sheet:view', { sheetId })).myRole, 'owner')

  await t.test('the link does not contain the encryption key', async () => {
    const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'editor' })
    const mine = (await owner.localDb.get('groups:joined:' + sheetId)).value
    assert.ok(!link.includes(mine.encryptionKey))
    assert.ok(!link.includes(b4a.toString(b4a.from(mine.encryptionKey, 'hex'), 'base64').slice(0, 20)))
    await call(owner, 'sheet:cancelInvite', { sheetId, inviteId: m.parseInviteLink(link).inviteId })
  })

  let editorLink
  await t.test('an editor joins with a single-use invite and can edit', async () => {
    editorLink = (await call(owner, 'sheet:invite', { sheetId, role: 'editor' })).link
    await call(editor, 'sheet:join', { link: editorLink })
    await waitFor('editor is a member', async () => editor.bases.get(sheetId) && (await call(editor, 'sheet:view', { sheetId })).myRole === 'editor')
    assert.equal((await grid(editor, sheetId))['1,1'], 'secret-rent')
    await waitFor('editor writable', async () => editor.bases.get(sheetId).writable)
    await call(editor, 'sheet:setCell', { sheetId, row: 2, col: 1, input: 'from-editor' })
    await waitFor('owner sees the edit', async () => (await grid(owner, sheetId))['2,1'] === 'from-editor')
    const { members } = await call(owner, 'sheet:members', { sheetId })
    assert.deepEqual(members.map((x) => [x.name, x.role]), [['Olive', 'owner'], ['Ed', 'editor']])
  })

  await t.test('a used invite gets nobody in', async () => {
    await call(late, 'sheet:join', { link: editorLink })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    assert.equal(late.bases.get(sheetId), undefined, 'never received the keys')
    const g = await late.localDb.get('groups:joined:' + sheetId)
    assert.equal(g, null)
  })

  await t.test('an expired invite is refused', async () => {
    const { op, inviteId, seed } = m.inviteOp({ sheetId, owner: owner.identity, role: 'viewer', expiresAt: Date.now() - 1000 })
    await owner.append(sheetId, op)
    const mine = (await owner.localDb.get('groups:joined:' + sheetId)).value
    const link = m.inviteLink({ sheetId, groupKey: mine.groupKey, inviteId, seed, owner: hex(owner.identity.publicKey), role: 'viewer' })
    const fresh = await device('Expired')
    await call(fresh, 'sheet:join', { link })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    assert.equal(fresh.bases.get(sheetId), undefined)
  })

  await t.test('a viewer sees live changes but cannot write', async () => {
    const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'viewer' })
    await call(viewer, 'sheet:join', { link })
    await waitFor('viewer is a member', async () => viewer.bases.get(sheetId) && (await call(viewer, 'sheet:view', { sheetId })).myRole === 'viewer')
    await waitFor('viewer has content', async () => (await grid(viewer, sheetId))['2,1'] === 'from-editor')
    await assert.rejects(call(viewer, 'sheet:setCell', { sheetId, row: 3, col: 1, input: 'nope' }), /view this sheet but not edit/)
    assert.equal(viewer.bases.get(sheetId).writable, false)
    await call(owner, 'sheet:setCell', { sheetId, row: 4, col: 1, input: 'live' })
    await waitFor('viewer sees a new edit', async () => (await grid(viewer, sheetId))['4,1'] === 'live')
  })

  await t.test('only the owner can invite: a forged invite op is skipped', async () => {
    const forged = signValue({ purpose: m.P.invite, sheetId, inviteId: 'f'.repeat(32), role: 'editor', invitePub: 'a'.repeat(64), expiresAt: Date.now() + 1e6, by: hex(editor.identity.publicKey) }, editor.identity.secretKey)
    await editor.append(sheetId, { type: 'invite', invite: forged })
    await assert.rejects(call(editor, 'sheet:invite', { sheetId, role: 'editor' }), /Only the owner/)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const { invites } = await call(owner, 'sheet:members', { sheetId })
    assert.ok(!invites.some((i) => i.inviteId === 'f'.repeat(32)))
  })

  await t.test('renaming yourself updates the member list; a replayed rename is skipped', async () => {
    await call(editor, 'app:setName', { name: 'Edward' })
    await waitFor('owner sees the new name', async () => (await call(owner, 'sheet:members', { sheetId })).members.some((x) => x.name === 'Edward'))
    await call(editor, 'app:setName', { name: 'Eddie' })
    await waitFor('second rename', async () => (await call(owner, 'sheet:members', { sheetId })).members.some((x) => x.name === 'Eddie'))
    await editor.append(sheetId, m.nameOp({ sheetId, identity: editor.identity, name: 'Edward', n: 1 }))
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.ok((await call(owner, 'sheet:members', { sheetId })).members.some((x) => x.name === 'Eddie'))
    // A rename signed by the editor but appended by the owner's device is
    // skipped: only your own devices can rename you.
    await owner.append(sheetId, m.nameOp({ sheetId, identity: editor.identity, name: 'Hijacked', n: 3 }))
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.ok(!(await call(owner, 'sheet:members', { sheetId })).members.some((x) => x.name === 'Hijacked'))
  })

  await t.test('demoting an editor stops their edits', async () => {
    await call(owner, 'sheet:setRole', { sheetId, identity: hex(editor.identity.publicKey), role: 'viewer' })
    await waitFor('editor sees the demotion', async () => (await call(editor, 'sheet:view', { sheetId })).myRole === 'viewer')
    await assert.rejects(call(editor, 'sheet:setCell', { sheetId, row: 5, col: 1, input: 'x' }), /not edit/)
    // A replayed old role op cannot undo a newer change.
    await call(owner, 'sheet:setRole', { sheetId, identity: hex(editor.identity.publicKey), role: 'editor' })
    await waitFor('promoted again', async () => (await call(editor, 'sheet:view', { sheetId })).myRole === 'editor')
    const stale = m.roleOp({ sheetId, owner: owner.identity, identity: hex(editor.identity.publicKey), role: 'viewer', v: 2 })
    await owner.append(sheetId, stale)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.equal((await call(owner, 'sheet:members', { sheetId })).members.find((x) => x.name === 'Eddie').role, 'editor')
  })
})
