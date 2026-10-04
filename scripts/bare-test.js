// Runs under Node, drives the real Bare binary:
//   1. the formula corpus must match the golden file bit for bit;
//   2. the worklet bundle must create, edit and read a sheet over stdin/stdout,
//      the same IPC path Electron uses.
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert/strict')
const { execFileSync, spawn } = require('child_process')
const { root, barePath, pack } = require('./bare')

async function main () {
  const bare = barePath()

  const corpus = pack(path.join(root, 'test', 'fixtures', 'formula-bare-entry.js'), path.join(root, 'dist', 'test-corpus', 'corpus.bundle'))
  const got = JSON.parse(execFileSync(bare, [corpus]).toString())
  const golden = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'formula-golden.json'), 'utf8'))
  assert.deepEqual(got, golden)
  console.log('ok - formula corpus under Bare matches the golden file')

  require('./build-worklet')
  const bundle = path.join(root, 'dist', 'worklet', 'worklet.bundle')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-bare-'))
  const proc = spawn(bare, [bundle], { stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = ''
  let nextId = 1
  const pending = new Map()
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result)
      }
    }
  })
  const call = (method, args) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    proc.stdin.write(JSON.stringify({ id, method, args }) + '\n')
  })

  try {
    await call('init', { dataDir })
    const { sheetId } = await call('sheet:create', { title: 'Bare check' })
    await call('sheet:setCell', { sheetId, row: 1, col: 1, input: '40' })
    await call('sheet:setCell', { sheetId, row: 2, col: 1, input: '=A1+2' })
    const view = await call('sheet:view', { sheetId })
    const cell = view.cells.find((c) => c.row === 2 && c.col === 1)
    assert.equal(cell.display, '42')
    assert.equal(cell.input, '=A1+2')
    const list = await call('sheet:list', {})
    assert.equal(list[0].title, 'Bare check')
    console.log('ok - worklet bundle under Bare: create, edit, formula, list')
  } finally {
    proc.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

async function seederCheck (bare) {
  require('./build-seeder')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-seeder-'))
  const proc = spawn(bare, [path.join(root, 'dist', 'seeder', 'seeder.bundle'), '--data', dataDir], { stdio: ['pipe', 'pipe', 'inherit'] })
  let out = ''
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('seeder did not print a pairing link')), 30000)
      proc.stdout.on('data', (d) => {
        out += d
        if (/pearsheet:\/\/seeder\?rv=/.test(out) && !out.includes('status-asked')) {
          out += 'status-asked'
          proc.stdin.write('status\n')
        }
        if (/"pairedDevices":0/.test(out)) { clearTimeout(t); resolve() }
      })
      proc.on('exit', (code) => reject(new Error('seeder exited with ' + code)))
    })
    console.log('ok - seeder bundle under Bare: starts, prints a pairing link, answers status')
  } finally {
    proc.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

main().then(() => seederCheck(barePath())).catch((err) => {
  console.error('not ok -', err.message)
  process.exit(1)
})
