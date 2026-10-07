// Linking a person's devices (proposals/2026-10-03-device-linking.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

test('linking a new device and the recovery phrase', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const open = []
  async function device (name, dir = tmpDir()) {
    const tag = name || 'new'
    const log = process.env.DEBUG_LINK ? (m) => console.log(Date.now() % 100000, tag, m) : undefined
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm, log })
    open.push(e)
    await e.init({})
    if (name) await call(e, 'app:setName', { name })
    return e
  }
  t.after(async () => {
    for (const e of open) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })

  const A = await device('Alex')
  const C = await device('Cam')
  const { sheetId: own } = await call(A, 'sheet:create', { title: 'Mine' })
  await call(A, 'sheet:setCell', { sheetId: own, row: 1, col: 1, input: 'alex owns this' })
  const { sheetId: edits } = await call(C, 'sheet:create', { title: 'Cam edits' })
  const { sheetId: views } = await call(C, 'sheet:create', { title: 'Cam views' })
  for (const [sheetId, role] of [[edits, 'editor'], [views, 'viewer']]) {
    const { link } = await call(C, 'sheet:invite', { sheetId, role })
    await call(A, 'sheet:join', { link })
    await waitFor('A joined ' + role, async () => (await call(A, 'sheet:view', { sheetId })).myRole === role)
  }

  const dirB = tmpDir()
  let B = await device(null, dirB)

  await t.test('a new device takes on the identity and every sheet', async () => {
    const { link } = await call(A, 'link:start')
    assert.match(link, /^pearoffice:\/\/link\?/)
    const r = await call(B, 'link:join', { link })
    assert.deepEqual(r, { restart: true, sheets: 3 })
    // The shell restarts the worklet; here, a new engine on the same store.
    await B.close()
    B = await device(null, dirB)
    assert.equal(hex(B.identity.publicKey), hex(A.identity.publicKey))
    assert.equal((await call(B, 'app:me')).name, 'Alex')
    await waitFor('B has all three sheets', async () => [own, edits, views].every((s) => B.bases.get(s)), { timeout: 20000 })
    await waitFor('B can write where Alex can', async () =>
      B.bases.get(own).writable && B.bases.get(edits).writable && (await call(B, 'sheet:view', { sheetId: views })).myRole === 'viewer', { timeout: 30000 })
    assert.equal(B.bases.get(views).writable, false)
    assert.equal((await grid(B, own))['1,1'], 'alex owns this')
  })

  await t.test('the linked device has the same rights: owner, editor, viewer', async () => {
    const { link } = await call(B, 'sheet:invite', { sheetId: own, role: 'viewer' })
    assert.match(link, /^pearoffice:\/\/join\?/)
    await call(B, 'sheet:setCell', { sheetId: edits, row: 2, col: 1, input: 'from the second device' })
    await waitFor('Cam sees it', async () => (await grid(C, edits))['2,1'] === 'from the second device')
    await assert.rejects(call(B, 'sheet:setCell', { sheetId: views, row: 1, col: 1, input: 'x' }), /not edit/)
    // Still one member per person: Alex appears once in Cam's sheet.
    const { members } = await call(C, 'sheet:members', { sheetId: edits })
    assert.deepEqual(members.map((m) => m.name).sort(), ['Alex', 'Cam'])
  })

  await t.test('a used link, a tampered link and a device with sheets are refused', async () => {
    const { link } = await call(A, 'link:start')
    const tampered = link.replace(/k=[^&]+/, 'k=' + 'A'.repeat(43))
    const D = await device(null)
    await assert.rejects(call(D, 'link:join', { link: tampered }), /does not check out/)
    const E = await device(null)
    await call(E, 'link:join', { link })
    await assert.rejects(call(D, 'link:join', { link }), /already been used|closed/)
    const { link: fresh } = await call(A, 'link:start')
    await assert.rejects(call(C, 'link:join', { link: fresh }), /already has files/)
  })

  await t.test('a join still looking for the other device can be cancelled', async () => {
    const G = await device(null)
    const { link } = await call(A, 'link:start')
    // A link to a device that is not there: the join waits until cancelled.
    const nowhere = link.replace(/a=[0-9a-f]{64}/, 'a=' + 'ab'.repeat(32))
    const started = Date.now()
    const joining = call(G, 'link:join', { link: nowhere }).then(() => 'joined', (err) => err.message)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal((await call(G, 'link:cancel')).ok, true)
    assert.equal(await joining, 'Linking was cancelled')
    assert.ok(Date.now() - started < 10000, 'stopped well before the 2 minute limit')
    assert.equal((await call(G, 'link:cancel')).ok, true, 'cancelling with nothing waiting is fine')
  })

  await t.test('the recovery phrase restores the identity on a fresh install', async () => {
    const { phrase } = await call(A, 'link:phrase')
    assert.equal(phrase.split(' ').length, 24)
    const dirF = tmpDir()
    let F = await device(null, dirF)
    assert.deepEqual(await call(F, 'app:restorePhrase', { phrase }), { restart: true })
    await F.close()
    F = await device(null, dirF)
    assert.equal(hex(F.identity.publicKey), hex(A.identity.publicKey))
    await assert.rejects(call(C, 'app:restorePhrase', { phrase }), /already has files/)
  })
})
