// How does a sheet with a long edit history behave? Fills a sheet with N
// single-cell edits (a mix of numbers, text and formulas over a 2,000 x 20
// area), then times reopening it, computing it, and its on-disk size.
//   node bench/load-time.js 1000 10000 100000
const fs = require('fs')
const os = require('os')
const path = require('path')
const Corestore = require('corestore')
const { createSheetEngine } = require('../src/worklet/engine')
const model = require('../src/shared/sheetModel')
const { call } = require('../test/helpers')

const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')

const sizes = process.argv.slice(2).map(Number)
let testnet = null
const fakeSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })

function du (dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    n += e.isDirectory() ? du(p) : fs.statSync(p).size
  }
  return n
}

let seed = 42
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }

;(async () => {
  testnet = await createTestnet(3)
  for (const N of sizes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-bench-'))
    let e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: fakeSwarm })
    await e.init({})
    const { sheetId } = await call(e, 'sheet:create', { title: 'Bench' })
    await call(e, 'sheet:setCell', { sheetId, row: 2000, col: 20, input: '0' }) // grow the grid once
    let t = Date.now()
    for (let i = 0; i < N; i++) {
      const row = 1 + rnd(2000)
      const col = 1 + rnd(20)
      const k = rnd(10)
      const input = k < 6 ? String(rnd(100000) / 100) : k < 8 ? 'item ' + rnd(500) : '=SUM(A' + (1 + rnd(1990)) + ':B' + (1 + rnd(1990)) + ')'
      await call(e, 'sheet:setCell', { sheetId, row, col, input })
    }
    const writeMs = Date.now() - t
    const live = await e.sheets.load(sheetId)
    const cells = [...model.tabMap(live.guarded.doc, model.tabIds(live.guarded.doc)[0]).get('cells').keys()].length
    const stateBytes = model.encodeState(live.guarded.doc).byteLength
    await e.close()
    const diskBytes = du(dir)

    // Reopen: a new engine on the same store rebuilds the sheet from its log.
    e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: fakeSwarm })
    t = Date.now()
    await e.init({})
    const initMs = Date.now() - t
    t = Date.now()
    await e.sheets.load(sheetId)
    const loadMs = Date.now() - t
    t = Date.now()
    await call(e, 'sheet:view', { sheetId })
    const firstViewMs = Date.now() - t
    t = Date.now()
    await call(e, 'sheet:setCell', { sheetId, row: 1, col: 1, input: '1' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    await call(e, 'sheet:view', { sheetId })
    const editViewMs = Date.now() - t
    await e.close()
    fs.rmSync(dir, { recursive: true, force: true })
    console.log(JSON.stringify({ edits: N, cells, writeMs, perEditMs: +(writeMs / N).toFixed(2), reopenInitMs: initMs, rebuildDocMs: loadMs, firstViewMs, editThenViewMs: editViewMs, yjsStateKB: Math.round(stateBytes / 1024), diskMB: +(diskBytes / 1e6).toFixed(1) }))
  }
  await testnet.destroy()
})()
