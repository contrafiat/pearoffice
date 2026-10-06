// Runs under Node, drives the real Bare binary:
//   1. the formula, function and spill corpora must match their golden files bit for bit;
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
  assert.deepEqual(got.corpus, golden)
  console.log('ok - formula corpus under Bare matches the golden file')
  const functionGolden = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'function-golden.json'), 'utf8'))
  assert.deepEqual(got.functions, functionGolden)
  console.log('ok - function corpus under Bare matches the golden file')
  const spillGolden = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'spill-golden.json'), 'utf8'))
  assert.deepEqual(got.spills, spillGolden)
  console.log('ok - spill corpus under Bare matches the golden file')
  assert.deepEqual(got.lifts, JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'lift-golden.json'), 'utf8')))
  console.log('ok - lift corpus under Bare matches the golden file')

  require('./build-worklet')
  const bundle = path.join(root, 'dist', 'worklet', 'worklet.bundle')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-bare-'))
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-seeder-'))
  const proc = spawn(bare, [path.join(root, 'dist', 'seeder', 'seeder.bundle'), '--data', dataDir], { stdio: ['pipe', 'pipe', 'inherit'] })
  let out = ''
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('seeder did not print a pairing link')), 30000)
      proc.stdout.on('data', (d) => {
        out += d
        if (/pearoffice:\/\/seeder\?rv=/.test(out) && !out.includes('status-asked')) {
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

// The Umbrel image's dashboard (seeder-dist/umbrel/server.js) over HTTP, run
// from the folder the image copies (scripts/stage-umbrel.js), with a password.
async function dashboardCheck () {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  execFileSync(process.execPath, [path.join(root, 'scripts', 'stage-umbrel.js'), arch], { stdio: 'inherit' })
  const app = path.join(root, 'dist', 'umbrel', arch)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-dashboard-'))
  const env = { ...process.env, SEEDER_DATA: dataDir, SEEDER_PORT: '0', SEEDER_PASSWORD: 'test-pass', SEEDER_BARE: path.join(app, 'bare'), SEEDER_BUNDLE: path.join(app, 'seeder', 'seeder.bundle') }
  const proc = spawn(process.execPath, [path.join(app, 'seeder-dist', 'umbrel', 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] })
  try {
    const base = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('dashboard did not start')), 30000)
      let out = ''
      proc.stdout.on('data', (d) => {
        out += d
        const m = out.match(/dashboard on (http:\/\/[\d.]+:\d+)/)
        if (m) { clearTimeout(t); resolve(m[1]) }
      })
      proc.on('exit', (code) => reject(new Error('dashboard exited with ' + code)))
    })
    let cookie = ''
    const get = async (url, opts = {}) => {
      const r = await fetch(base + url, { ...opts, headers: { ...opts.headers, cookie } })
      return { status: r.status, text: await r.text(), setCookie: r.headers.get('set-cookie') }
    }
    const post = (url, body) => get(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
    const check = (ok, what) => { if (!ok) throw new Error('dashboard: ' + what) }
    check((await get('/')).text.includes('PearOffice Seeder'), 'page')
    check((await get('/fonts.css')).text.includes('Manrope'), 'font')
    check((await get('/api/status')).status === 401, 'status needs the password')
    check((await post('/api/pair')).status === 401, 'pairing needs the password')
    check((await post('/api/login', { password: 'wrong' })).status === 401, 'wrong password refused')
    const login = await post('/api/login', { password: 'test-pass' })
    check(login.status === 200 && login.setCookie, 'right password accepted')
    cookie = login.setCookie.split(';')[0]
    check(JSON.parse((await get('/api/status')).text).pairedDevices === 0, 'status')
    const pair = JSON.parse((await post('/api/pair')).text)
    check(/^pearoffice:\/\/seeder\?rv=/.test(pair.link) && pair.svg.startsWith('<svg') && pair.expiresAt > pair.now, 'pairing')
    check(JSON.parse((await get('/api/status')).text).pairing.link === pair.link, 'pairing in status')
    check((await get('/api/devices')).text === '[]', 'devices')
    const forget = await post('/api/forget', { deviceKey: 'abcdef0123' })
    check(forget.status === 400 && forget.text.includes('No paired device'), 'forget refuses an unknown device')
    const exited = new Promise((resolve) => proc.once('exit', resolve))
    proc.kill('SIGTERM')
    check(await exited === 0, 'stops cleanly on SIGTERM')
    console.log('ok - Umbrel dashboard: login, page, status, pairing QR, devices, forget, clean stop')
  } finally {
    proc.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

main().then(() => seederCheck(barePath())).then(() => dashboardCheck()).catch((err) => {
  console.error('not ok -', err.message)
  process.exit(1)
})
