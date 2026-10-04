// Blind seeder (proposal section 8): QR/link pairing, every member backs up
// to the seeder, a member syncs from the seeder alone, the seeder holds no
// readable data, and strangers cannot store cores on it.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const BlindPeering = require('blind-peering')
const Wakeup = require('protomux-wakeup')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { createSeeder } = require('../src/seeder/seeder')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const SECRET = 'secret-salary-9137'

async function seederHas (seeder, key, length) {
  const core = seeder.peer.store.get({ key })
  await core.ready()
  const ok = core.contiguousLength >= length
  await core.close()
  return ok
}

test('blind seeder', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const open = []
  const mk = async (dir, log) => {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm, log })
    open.push(e)
    await e.init({})
    return e
  }
  const seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: testnet.bootstrap })
  t.after(async () => {
    for (const e of open) { try { await e.close() } catch {} }
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
  })

  const dirB = tmpDir()
  const A = await mk(tmpDir())
  let B = await mk(dirB)
  const { sheetId } = await call(A, 'sheet:create', { title: 'Payroll' })
  await call(A, 'sheet:setCell', { sheetId, row: 1, col: 1, input: SECRET })
  const { link: invite } = await call(A, 'sheet:invite', { sheetId, role: 'editor' })
  await call(B, 'sheet:join', { link: invite })
  await waitFor('B is an editor', async () => (await call(B, 'sheet:view', { sheetId })).myRole === 'editor' && B.bases.get(sheetId).writable)
  await call(B, 'sheet:setCell', { sheetId, row: 2, col: 1, input: 'from-B' })

  await t.test('pairing with the link lists the seeder in the sheet for every member', async () => {
    const { link } = seeder.openPairing()
    assert.match(link, /^pearsheet:\/\/seeder\?/)
    const r = await call(A, 'seeder:pair', { link })
    assert.equal(r.seederKey, hex(seeder.seederKey))
    assert.ok(seeder.isPaired(A.swarm.keyPair.publicKey))
    await waitFor('seeder listed on B', async () => !!(await B.bases.get(sheetId).view.get('seeder/' + hex(seeder.seederKey))))
    await waitFor('seeder allows the sheet', async () => seeder.allowedSheets().includes(hex(A.bases.get(sheetId).key)))
  })

  await t.test('the seeder stores every writer core', async () => {
    const a = A.bases.get(sheetId)
    await waitFor('seeder has both writers', async () => {
      await a.update()
      for (const w of a.activeWriters) if (!(await seederHas(seeder, w.core.key, w.core.length))) return false
      return a.activeWriters.size >= 2
    }, { timeout: 30000 })
  })

  await t.test('a member syncs from the seeder alone', async () => {
    await B.close()
    // A picture comes from the seeder too (proposals/2026-10-04-profiles-with-avatars.md).
    const pic = b4a.alloc(300, 7)
    pic[0] = 0xff; pic[1] = 0xd8; pic[2] = 0xff
    await call(A, 'app:setAvatar', { data: b4a.toString(pic, 'base64'), mime: 'image/jpeg' })
    await call(A, 'sheet:setCell', { sheetId, row: 3, col: 1, input: 'while-B-away' })
    const a = A.bases.get(sheetId)
    await waitFor('seeder has the new edit', async () => seederHas(seeder, a.local.key, a.local.length))
    await A.close()
    B = await mk(dirB)
    await waitFor('B gets the edit with only the seeder online', async () => (await grid(B, sheetId))['3,1'] === 'while-B-away', { timeout: 30000 })
    const pa = await call(B, 'sheet:avatar', { sheetId, identity: hex(A.identity.publicKey) })
    assert.equal(pa.data, b4a.toString(pic, 'base64'))
  })

  await t.test('the seeder holds no readable sheet data', async () => {
    let scanned = 0
    let hits = 0
    const b = B.bases.get(sheetId)
    const cores = [...b.activeWriters].map((w) => w.core.key)
    for (const v of b.views()) cores.push(v.key)
    for (const key of cores) {
      const core = seeder.peer.store.get({ key })
      await core.ready()
      for (let i = 0; i < core.contiguousLength; i++) {
        const raw = await core.get(i, { raw: true, wait: false })
        if (!raw) continue
        scanned++
        if (b4a.indexOf(raw, b4a.from(SECRET)) !== -1 || b4a.indexOf(raw, b4a.from(b4a.from(SECRET).toString('base64').slice(0, 12))) !== -1) hits++
      }
      await core.close()
    }
    assert.ok(scanned > 5, 'scanned ' + scanned + ' blocks')
    assert.equal(hits, 0)
  })

  await t.test('a stranger cannot store cores on the seeder', async () => {
    const store = new Corestore(tmpDir())
    const swarm = new Hyperswarm({ bootstrap: testnet.bootstrap })
    t.after(async () => { await swarm.destroy(); await store.close() })
    const core = store.get({ name: 'junk' })
    await core.append(b4a.from('junk data'))
    const peering = new BlindPeering(swarm.dht, store, { wakeup: new Wakeup(), keys: [seeder.seederKey] })
    const before = seeder.peer.stats.coresAdded
    peering.addCoreBackground(core, { target: core.key, referrer: core.key })
    await new Promise((resolve) => setTimeout(resolve, 3000))
    assert.equal(seeder.peer.stats.coresAdded, before)
    assert.ok(!seeder.allowedSheets().includes(hex(core.key)))
    await peering.close()
  })
})
