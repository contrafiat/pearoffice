// End-to-end check of "Update now" (proposals/2026-10-05-update-checker.md)
// on a Linux AppImage or a macOS PearSheet.app. Runs a copy of the built app
// against a fake newer release served locally, presses Update now through
// the window's own bridge (over the DevTools protocol), and checks the app
// was replaced and came back on the new version.
//
//   node scripts/check-update.js <old.AppImage | old PearSheet.app> <release folder> <new version>
//
// The release folder holds the new build and its .sha256: on Linux
// pearsheet-<new>-linux-x86_64.AppImage, built with
//   (cd desktop && npx electron-builder --linux AppImage --x64 -c.extraMetadata.version=<new> -c.directories.output=<dir>)
// on a Mac PearSheet-<new>-mac-<arch>.dmg, built signed with
//   BUILD_VERSION=<new> SIGN=1 scripts/build-desktop-mac.sh <arch>
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')
const { serveRelease } = require('./serve-local-release')

const [oldImage, releaseDir, next] = process.argv.slice(2)
if (!oldImage || !releaseDir || !next) { console.error('usage: node scripts/check-update.js <old.AppImage> <release folder> <new version>'); process.exit(1) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

async function page (port) {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json()
      const p = list.find((x) => x.type === 'page' && /index\.html/.test(x.url))
      if (p) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('no PearSheet window on port ' + port)
}

// Run window.pearsheet.call(method) in the app's window.
async function bridge (port, method) {
  const ws = new WebSocket(await page(port))
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  const reply = new Promise((resolve) => { ws.onmessage = (m) => resolve(JSON.parse(m.data)) })
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'window.pearsheet.call(' + JSON.stringify(method) + ').then(JSON.stringify)', awaitPromise: true } }))
  const r = await reply
  ws.close()
  if (!r.result || r.result.exceptionDetails) throw new Error(method + ' failed: ' + JSON.stringify(r.result && r.result.exceptionDetails))
  return JSON.parse(r.result.result.value)
}

async function until (what, fn, ms = 60000) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await Promise.race([fn(), sleep(5000).then(() => null)])
      if (v) return v
    } catch {}
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what)
    await sleep(1000)
  }
}

async function main () {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-update-check-'))
  const mac = /\.app\/?$/.test(oldImage)
  const image = path.join(scratch, mac ? 'PearSheet.app' : 'PearSheet.AppImage')
  if (mac) execFileSync('ditto', [oldImage, image])
  else { fs.copyFileSync(oldImage, image); fs.chmodSync(image, 0o755) }
  const exe = mac ? path.join(image, 'Contents', 'MacOS', 'PearSheet') : image
  const args = mac ? [] : ['--no-sandbox', '--disable-gpu']
  const server = await serveRelease({ version: next, dir: path.resolve(releaseDir) })
  const port = 9300 + Math.floor(Math.random() * 500)
  const env = {
    ...process.env,
    PEARSHEET_UPDATE_LATEST_URL: 'http://127.0.0.1:' + server.address().port + '/latest',
    PEARSHEET_UPDATE_DELAY_MS: '500',
    PEARSHEET_DATA: path.join(scratch, 'data'),
    PEARSHEET_DEBUG: '1'
  }
  delete env.PEARSHEET_NO_UPDATE_CHECK
  const proc = spawn(exe, [...args, '--remote-debugging-port=' + port], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let out = ''
  proc.stdout.on('data', (d) => { out += d })
  proc.stderr.on('data', (d) => { out += d })
  try {
    const before = await until('the update to show', async () => { const s = await bridge(port, 'app:update'); return s.update && s.update.available && s })
    if (before.update.latest !== next) throw new Error('offered ' + before.update.latest)
    console.log('ok - ' + before.update.current + ' sees ' + next + ' is out')
    const started = await bridge(port, 'app:updateApply')
    if (started.status !== 'running') throw new Error('apply did not start: ' + JSON.stringify(started))
    await until('the old copy to exit', () => proc.exitCode !== null || proc.signalCode !== null, 120000)
    if (mac) {
      const plist = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(image, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim()
      if (plist !== next) throw new Error('the app on disk is still ' + plist)
      execFileSync('codesign', ['--verify', '--deep', '--strict', image])
      console.log('ok - PearSheet.app was swapped for the signed ' + next)
    } else {
      const sums = fs.readdirSync(releaseDir).filter((f) => f.endsWith('.AppImage.sha256')).map((f) => fs.readFileSync(path.join(releaseDir, f), 'utf8').slice(0, 64))
      if (!sums.includes(sha(image))) throw new Error('the AppImage was not replaced')
      if (!(fs.statSync(image).mode & 0o100)) throw new Error('the new AppImage is not executable')
      console.log('ok - the AppImage file was replaced with the verified ' + next)
    }
    const after = await until('the new copy to come back', async () => { const s = await bridge(port, 'app:update'); return s.update && s.update.current === next && s })
    if (after.update.available) throw new Error('the new copy still offers an update')
    console.log('ok - PearSheet restarted on ' + next + ' and offers nothing newer')
  } catch (err) {
    console.error(out.split('\n').filter((l) => /update|pearsheet\]/.test(l)).slice(-15).join('\n'))
    throw err
  } finally {
    try { execFileSync('pkill', ['-f', scratch]) } catch {}
    server.close()
    await sleep(1000)
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

main().catch((err) => { console.error('not ok - ' + err.message); process.exit(1) })
