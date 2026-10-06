// Edits over the 1 MB limit for one op are split into parts
// (proposals/2026-10-06-documents.md, step 1). A big paste reaches the other
// devices, and so does a big file moved to fresh keys by a tidy-up.

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { yOps, PART_CHARS } = require('../src/worklet/yOps')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const big = (seed) => Array.from({ length: 300000 }, (_, i) => String.fromCharCode(97 + ((i * 7 + seed) % 26))).join('')

test('yOps splits only what is over the limit', () => {
  assert.deepEqual(yOps(Buffer.from('small')), [{ type: 'y', data: Buffer.from('small').toString('base64') }])
  const update = Buffer.alloc(PART_CHARS * 2, 1)
  const ops = yOps(update)
  assert.ok(ops.length > 2)
  assert.ok(ops.every((op) => op.data.length <= PART_CHARS && op.part.n === ops.length))
  assert.equal(Buffer.from(ops.map((op) => op.data).join(''), 'base64').compare(update), 0)
})

test('edits over 1 MB reach every device, also after a tidy-up', async (t) => {
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

  const owner = await device('Owner')
  const editor = await device('Editor')
  const { sheetId } = await call(owner, 'sheet:create', { title: 'Big' })
  const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'editor' })
  await call(editor, 'sheet:join', { link })
  await waitFor('editor in', async () => editor.bases.get(sheetId)?.writable)

  // One edit of about 1.2 MB: a paste of four long cells.
  const cells = []
  for (let r = 1; r <= 4; r++) cells.push([big(r)])
  await call(owner, 'sheet:setCells', { sheetId, row: 1, col: 1, grid: cells })
  await waitFor('editor has the big cells', async () => (await grid(editor, sheetId))['4,1'] === big(4), { timeout: 60000 })

  // A tidy-up sends the whole sheet as one update.
  for (let r = 5; r <= 8; r++) await call(owner, 'sheet:setCell', { sheetId, row: r, col: 1, input: big(r) })
  await waitFor('editor caught up', async () => (await grid(editor, sheetId))['8,1'] === big(8), { timeout: 60000 })
  await call(owner, 'sheet:compact', { sheetId })
  const to = (await owner.localDb.get('moves:' + sheetId)).value.to
  await waitFor('editor follows with everything', async () => {
    const g = editor.bases.get(to) && await grid(editor, to)
    return !!g && g['1,1'] === big(1) && g['8,1'] === big(8)
  }, { timeout: 60000 })
})
