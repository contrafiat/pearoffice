// What does tidying up save (proposals/2026-10-05-shared-compaction.md)? A
// sheet gets N single-cell edits; a new device joins it and we note the time
// to its content and its disk. Then the owner tidies up and another new
// device joins the tidied copy.
//   node bench/compaction.js 10000
const fs = require('fs')
const path = require('path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, call } = require('../test/helpers')

function du (dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    n += e.isDirectory() ? du(p) : fs.statSync(p).size
  }
  return n
}

;(async () => {
  const N = Number(process.argv[2] || 10000)
  const testnet = await createTestnet(3)
  const mk = async () => {
    const dir = tmpDir()
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
    await e.init({})
    return { e, dir }
  }
  async function join (sheetId, link) {
    const d = await mk()
    const t = Date.now()
    await call(d.e, 'sheet:join', { link })
    for (;;) {
      try { const v = await call(d.e, 'sheet:view', { sheetId }); if (v.cells.some((c) => c.display === 'last')) break } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const ms = Date.now() - t
    await d.e.close()
    return { joinMs: ms, diskMB: +(du(d.dir) / 1e6).toFixed(1) }
  }

  const A = await mk()
  const { sheetId } = await call(A.e, 'sheet:create', { title: 'Big' })
  for (let i = 0; i < N; i++) await call(A.e, 'sheet:setCell', { sheetId, row: 1 + (i % 500), col: 1 + (i % 10), input: String(i) })
  await call(A.e, 'sheet:setCell', { sheetId, row: 600, col: 1, input: 'last' })
  const before = await join(sheetId, (await call(A.e, 'sheet:invite', { sheetId, role: 'viewer' })).link)

  const t = Date.now()
  const { sheetId: newId } = await call(A.e, 'sheet:compact', { sheetId })
  const tidyMs = Date.now() - t
  const after = await join(newId, (await call(A.e, 'sheet:invite', { sheetId: newId, role: 'viewer' })).link)

  console.log(JSON.stringify({ edits: N, tidyMs, before, after }))
  await A.e.close(); await testnet.destroy(); cleanup()
})()
