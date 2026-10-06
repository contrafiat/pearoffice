// The PearOffice seeder with a web dashboard, for Umbrel and other Docker
// hosts. Starts the blind seeder as its own Bare process (src/seeder/bare.js
// --ipc, through desktop/seeder-process.js, as the desktop app does) and
// serves one page to see what it holds, pair a device and forget one.
// See proposals/2026-10-05-umbrel-seeder.md.
//
// The image runs with host networking (devices dial in to pair, and Docker's
// bridge NAT stops that), so Umbrel's app proxy cannot sit in front of it and
// the page has its own login: @peerloom/host's dashboard-auth, as PearTune's.
// Umbrel passes its app password as SEEDER_PASSWORD; elsewhere one is made on
// first start and saved in the data folder. On 127.0.0.1 there is no login.
//
//   SEEDER_DATA    data folder (default /data)
//   SEEDER_HOST    address to listen on (default 127.0.0.1)
//   SEEDER_PORT    port (default 8761)
//   SEEDER_PASSWORD  dashboard password
//   SEEDER_BARE    the bare binary (default: bare next to this repo layout)
//   SEEDER_BUNDLE  the seeder bundle
//
// Runs from the folder scripts/stage-umbrel.js makes (it supplies
// @peerloom/host's dashboard-auth), not from the checkout.

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { SeederProcess } = require('../../desktop/seeder-process')
const { toSvg } = require('../../src/shared/qr')
const { createDashboardAuth, requireSafeBind, resolveDashboardPassword, PASSWORD_FILE } = require('@peerloom/host/dashboard-auth')

const root = path.join(__dirname, '..', '..')
const env = process.env
const dataDir = env.SEEDER_DATA || '/data'
const host = env.SEEDER_HOST || '127.0.0.1'
const port = Number(env.SEEDER_PORT || 8761)
const barePath = env.SEEDER_BARE || path.join(root, 'bare')
const bundlePath = env.SEEDER_BUNDLE || path.join(root, 'seeder.bundle')
const page = fs.readFileSync(path.join(__dirname, 'index.html'))

const log = (line) => console.log('[pearoffice-seeder] ' + line)

async function main () {
  fs.mkdirSync(dataDir, { recursive: true })
  const { password, source } = resolveDashboardPassword({ password: env.SEEDER_PASSWORD, bind: host, dataDir })
  requireSafeBind(host, password, { envVar: 'SEEDER_PASSWORD' })
  const auth = createDashboardAuth({ app: 'pearoffice_seeder', password, envVar: 'SEEDER_PASSWORD' })
  if (source === 'generated') log('dashboard password ' + password + ' (saved in ' + path.join(dataDir, PASSWORD_FILE) + ')')
  const { FONT_CSS } = await import(pathToFileURL(path.join(root, 'src', 'ui', 'fonts.js')).href)
  const seeder = new SeederProcess({ barePath, bundlePath, dataDir, onLog: (_, line) => log(line) })
  // Docker restarts the container if the seeder dies.
  seeder.on('exit', (code) => { log('seeder exited (' + code + ')'); process.exit(1) })
  const { seederKey } = await seeder.start()
  log('seeder key ' + seederKey)

  const routes = {
    'GET /api/status': () => seeder.call('status'),
    'GET /api/devices': () => seeder.call('devices'),
    'POST /api/pair': async () => {
      const p = await seeder.call('pair')
      return { ...p, svg: toSvg(p.link, 240), now: Date.now() }
    },
    'POST /api/forget': (body) => seeder.call('forget', { deviceKey: String(body.deviceKey || '') })
  }

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://localhost')
    const url = parsed.pathname
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(body)
    }
    if (req.method === 'GET' && url === '/fonts.css') return send(200, 'text/css', FONT_CSS)
    // Answers /api/login and /api/logout, and 401 for anything else without a
    // session. The page itself always loads and shows the login form on a 401.
    if (auth.handle(req, res, parsed)) return
    if (req.method === 'GET' && url === '/') return send(200, 'text/html; charset=utf-8', page)
    const route = routes[req.method + ' ' + url]
    if (!route) return send(404, 'application/json', JSON.stringify({ error: 'not found' }))
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy() })
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {}
        send(200, 'application/json', JSON.stringify(await route(body)))
      } catch (err) {
        send(400, 'application/json', JSON.stringify({ error: err.message }))
      }
    })
  })
  server.listen(port, host, () => log('dashboard on http://' + host + ':' + server.address().port))

  const stop = async () => {
    log('stopping')
    server.close()
    seeder.removeAllListeners('exit')
    await seeder.stop()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch((err) => {
  console.error('[pearoffice-seeder] failed:', err && err.message)
  process.exit(1)
})
