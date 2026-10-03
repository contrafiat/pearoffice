const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')

const dirs = []

function tmpDir (prefix = 'pearsheet-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function tmpStore () {
  return new Corestore(tmpDir())
}

function cleanup () {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

async function waitFor (label, fn, { timeout = 30000, interval = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    let ok = false
    try { ok = await fn() } catch {}
    if (ok) return
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error('timed out waiting for: ' + label)
}

// Call an IPC method the way core's dispatch does, but return the result.
function call (engine, method, args = {}) {
  const ctx = {
    engine,
    get identity () { return engine.identity },
    get store () { return engine.store },
    get swarm () { return engine.swarm },
    get localDb () { return engine.localDb },
    append: engine.append,
    emit: engine.emit,
    bases: engine.bases,
    createGroup: engine.createGroup,
    joinGroup: engine.joinGroup
  }
  return engine.methods[method](args, ctx)
}

// Plain { "row,col": display } map of a tab, for comparing devices.
async function grid (engine, sheetId, tabId) {
  const v = await call(engine, 'sheet:view', { sheetId, tabId })
  const out = {}
  for (const c of v.cells) out[c.row + ',' + c.col] = c.input === c.display ? c.display : c.input + ' -> ' + c.display
  return out
}

module.exports = { tmpDir, tmpStore, cleanup, waitFor, call, grid }
