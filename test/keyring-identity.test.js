// Taking on another identity (a restore from the phrase, a device link)
// forgets the last keyring this device wrote: it belongs to the old identity
// (src/worklet/linking.js replaceIdentity, keyringSync.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, call } = require('./helpers')

test('taking on another identity forgets the old identity\'s keyring', async (t) => {
  const testnet = await createTestnet(3)
  const dir = tmpDir()
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const mk = async () => { const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm }); await e.init({}); return e }
  const other = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: mkSwarm })
  await other.init({})
  let e = await mk()
  t.after(async () => { try { await e.close() } catch {} try { await other.close() } catch {} await testnet.destroy(); cleanup() })
  await e.localDb.put('keyring:local', { seq: 3, keyring: { v: 1, files: {}, seeders: {} }, fingerprint: 'x', held: [] })
  const { phrase } = await call(other, 'link:phrase')
  assert.equal((await call(e, 'app:restorePhrase', { phrase })).restart, true)
  assert.equal(await e.localDb.get('keyring:local'), null)
  await e.close()
  e = await mk()
  assert.equal(await e.localDb.get('keyring:local'), null, 'still gone after the restart')
})
