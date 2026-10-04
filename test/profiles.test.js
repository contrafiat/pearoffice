// Profiles with avatars (proposals/2026-10-04-profiles-with-avatars.md):
// the `avatar` op and its checks, viewers changing their name and picture
// through a writer, forged and stale changes skipped, and linked devices
// keeping one profile.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const m = require('../src/worklet/membership')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

// Not a real picture, but it starts like a JPEG, which is all apply checks.
function fakeJpeg (fill, size = 600) {
  const bytes = b4a.alloc(size, fill)
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; bytes[3] = 0xe0
  return { data: b4a.toString(bytes, 'base64'), mime: 'image/jpeg', hash: m.avatarHash(bytes) }
}

async function memberOf (engine, sheetId, identity) {
  const { members } = await call(engine, 'sheet:members', { sheetId })
  return members.find((x) => x.identity === identity)
}

test('profiles with avatars', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name, dir = tmpDir()) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm })
    engines.push(e)
    await e.init({})
    if (name) await call(e, 'app:setName', { name })
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
  const O = hex(owner.identity.publicKey)
  const V = hex(viewer.identity.publicKey)
  const { sheetId } = await call(owner, 'sheet:create', { title: 'Trip' })
  for (const [e, role] of [[editor, 'editor'], [viewer, 'viewer']]) {
    const { link } = await call(owner, 'sheet:invite', { sheetId, role })
    await call(e, 'sheet:join', { link })
    await waitFor(role + ' joined', async () => e.bases.get(sheetId) && (await call(e, 'sheet:view', { sheetId })).myRole === role)
  }
  await waitFor('editor writable', async () => editor.bases.get(sheetId).writable)

  const olivePic = fakeJpeg(1)
  await t.test('a picture set by the owner reaches the others', async () => {
    await call(owner, 'app:setAvatar', { data: olivePic.data, mime: olivePic.mime })
    assert.equal((await call(owner, 'app:me')).avatar.hash, olivePic.hash)
    await waitFor('editor sees it', async () => (await memberOf(editor, sheetId, O)).avatarHash === olivePic.hash)
    const pic = await call(viewer, 'sheet:avatar', { sheetId, identity: O })
    assert.equal(pic.data, olivePic.data)
  })

  await t.test('a viewer changes their name and picture through a writer', async () => {
    const viPic = fakeJpeg(2)
    await call(viewer, 'app:setName', { name: 'Violet' })
    await call(viewer, 'app:setAvatar', { data: viPic.data, mime: viPic.mime })
    await waitFor('owner sees the new name and picture', async () => {
      const x = await memberOf(owner, sheetId, V)
      return x.name === 'Violet' && x.avatarHash === viPic.hash
    })
    await waitFor('the viewer sees it too', async () => (await memberOf(viewer, sheetId, V)).name === 'Violet')
    assert.equal((await call(owner, 'sheet:avatar', { sheetId, identity: V })).data, viPic.data)
  })

  await t.test('removing a picture', async () => {
    await call(viewer, 'app:setAvatar', { data: '' })
    await waitFor('gone on the owner', async () => (await memberOf(owner, sheetId, V)).avatarHash === null)
    assert.equal(await call(owner, 'sheet:avatar', { sheetId, identity: V }), null)
  })

  await t.test('forged, stale, oversized and mismatched pictures are skipped', async () => {
    const rec = (await owner.bases.get(sheetId).view.get('member/' + O)).value
    const n = rec.avatarN + 1
    const bad = fakeJpeg(3)
    const big = fakeJpeg(4, m.AVATAR_MAX_BYTES + 1)
    // The editor signs a picture change claiming to be the owner.
    const forged = m.avatarOp({ sheetId, identity: editor.identity, ...bad, n, at: Date.now() })
    forged.avatar.identity = O
    await editor.append(sheetId, forged)
    await editor.append(sheetId, m.avatarOp({ sheetId, identity: owner.identity, ...bad, n: n - 1, at: Date.now() }))
    await editor.append(sheetId, m.avatarOp({ sheetId, identity: owner.identity, ...big, n, at: Date.now() }))
    await editor.append(sheetId, m.avatarOp({ sheetId, identity: owner.identity, ...bad, hash: olivePic.hash, n, at: Date.now() }))
    await editor.append(sheetId, m.avatarOp({ sheetId, identity: owner.identity, ...bad, mime: 'image/png', n, at: Date.now() }))
    // A marker edit after them: once it arrives, so have they.
    await call(editor, 'sheet:setCell', { sheetId, row: 9, col: 9, input: 'marker' })
    await waitFor('owner has the marker', async () => (await call(owner, 'sheet:view', { sheetId })).cells.some((c) => c.input === 'marker'))
    const after = await memberOf(owner, sheetId, O)
    assert.equal(after.avatarHash, olivePic.hash)
    await assert.rejects(call(owner, 'app:setAvatar', { data: big.data, mime: big.mime }), /could not be used/)
  })

  await t.test('a linked device gets the picture, and a rename on it reaches the first', async () => {
    const dirB = tmpDir()
    let B = await device(null, dirB)
    const { link } = await call(owner, 'link:start')
    await call(B, 'link:join', { link })
    await B.close()
    B = await device(null, dirB)
    const me = await call(B, 'app:me')
    assert.equal(me.name, 'Olive')
    assert.equal(me.avatar.hash, olivePic.hash)
    await waitFor('B has the sheet', async () => B.bases.get(sheetId) && B.bases.get(sheetId).writable, { timeout: 30000 })
    await call(B, 'app:setName', { name: 'Olive B' })
    await waitFor('the first device takes the new name', async () => (await call(owner, 'app:me')).name === 'Olive B', { timeout: 20000 })
    assert.equal((await memberOf(viewer, sheetId, O)).name, 'Olive B')
  })
})
