// Taking on another identity on a device that is already in use: its files
// are removed from it first, only after the other device has answered (or
// the phrase checks out), and the files it shared stay with the others.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

test('linking or restoring on a device that already has files', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const open = []
  async function device (name, dir = tmpDir()) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm })
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
  const titles = async (e) => (await call(e, 'file:list')).filter((f) => !f.removed).map((f) => f.title).sort().join(',')

  // Ann's main device has one file. Her old laptop was set up as someone
  // else: a file only it has, and one it shares with Cy.
  const ann = await device('Ann')
  await call(ann, 'sheet:create', { title: 'Ann main' })
  const cy = await device('Cy')
  const dirL = tmpDir()
  let laptop = await device('Laptop', dirL)
  await call(laptop, 'sheet:create', { title: 'Solo' })
  const { sheetId: shared } = await call(laptop, 'sheet:create', { title: 'Shared' })
  await call(laptop, 'sheet:setCell', { sheetId: shared, row: 1, col: 1, input: 'kept for cy' })
  const { link: invite } = await call(laptop, 'sheet:invite', { sheetId: shared, role: 'editor' })
  await call(cy, 'sheet:join', { link: invite })
  await waitFor('cy in', async () => !!cy.bases.get(shared) && cy.bases.get(shared).writable)
  await waitFor('two people', async () => (await call(laptop, 'file:list')).find((f) => f.sheetId === shared).people === 2)

  await t.test('it says what would go, and which files nobody else has', async () => {
    const s = await call(laptop, 'link:filesHere')
    assert.equal(s.total, 2)
    assert.equal(s.onlyHere.join(), 'Solo')
  })

  await t.test('without replace, linking is refused and nothing is removed', async () => {
    const { link } = await call(ann, 'link:start')
    await assert.rejects(call(laptop, 'link:join', { link }), /already has files/)
    assert.equal(await titles(laptop), 'Shared,Solo')
  })

  await t.test('a link that fails removes nothing', async () => {
    const dead = 'pearoffice://link?rv=' + 'A'.repeat(43) + '&k=' + 'B'.repeat(43) + '&a=' + 'c'.repeat(64) + '&v=1'
    const pending = call(laptop, 'link:join', { link: dead, replace: true })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await call(laptop, 'link:cancel')
    await assert.rejects(pending, /cancelled/)
    assert.equal(await titles(laptop), 'Shared,Solo')
  })

  await t.test('with replace: its files go, it becomes Ann and gets her files', async () => {
    const { link } = await call(ann, 'link:start')
    assert.equal((await call(laptop, 'link:join', { link, replace: true })).restart, true)
    await laptop.close()
    laptop = await device(null, dirL)
    assert.equal(hex(laptop.identity.publicKey), hex(ann.identity.publicKey))
    await waitFor('ann main here', async () => (await titles(laptop)) === 'Ann main', { timeout: 40000 })
  })

  await t.test('the file it shared stays with Cy', async () => {
    // Values refresh a moment after a change (sheets.js), so wait for them.
    await waitFor('still there', async () => (await grid(cy, shared))['1,1'] === 'kept for cy')
    await call(cy, 'sheet:setCell', { sheetId: shared, row: 2, col: 1, input: 'still mine' })
    await waitFor('still editable', async () => (await grid(cy, shared))['2,1'] === 'still mine')
  })

  await t.test('restore with replace: a bad phrase removes nothing; a good one replaces', async () => {
    const dirM = tmpDir()
    let other = await device('Other', dirM)
    await call(other, 'sheet:create', { title: 'Other file' })
    await assert.rejects(call(other, 'app:restorePhrase', { phrase: 'not a phrase', replace: true }))
    assert.equal(await titles(other), 'Other file')
    const { phrase } = await call(cy, 'link:phrase')
    await assert.rejects(call(other, 'app:restorePhrase', { phrase }), /already has files/)
    assert.equal((await call(other, 'app:restorePhrase', { phrase, replace: true })).restart, true)
    await other.close()
    other = await device(null, dirM)
    assert.equal(hex(other.identity.publicKey), hex(cy.identity.publicKey))
    assert.equal(await titles(other), '')
  })
})
