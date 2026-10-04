// How long does a new device take to join a sheet with N edits?
//   node bench/join-time.js 10000
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, call } = require('../test/helpers')

;(async () => {
  const N = Number(process.argv[2] || 10000)
  const testnet = await createTestnet(3)
  const mk = () => createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  const A = mk()
  await A.init({})
  const { sheetId } = await call(A, 'sheet:create', { title: 'Big' })
  for (let i = 0; i < N; i++) await call(A, 'sheet:setCell', { sheetId, row: 1 + (i % 500), col: 1 + (i % 10), input: String(i) })
  await call(A, 'sheet:setCell', { sheetId, row: 600, col: 1, input: 'last' })
  const { link } = await call(A, 'sheet:invite', { sheetId, role: 'editor' })
  const B = mk()
  await B.init({})
  const t = Date.now()
  await call(B, 'sheet:join', { link })
  for (;;) {
    try { const v = await call(B, 'sheet:view', { sheetId }); if (v.cells.some((c) => c.display === 'last')) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  console.log(JSON.stringify({ edits: N, joinToContentMs: Date.now() - t }))
  await A.close(); await B.close(); await testnet.destroy(); cleanup()
})()
