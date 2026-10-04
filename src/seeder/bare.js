// PearSheet seeder, run with the Bare runtime:
//
//   bare seeder.bundle --data <folder>          interactive: prints the key and a
//                                               pairing link with a QR code; type
//                                               `pair` for a new one, `status`
//   bare seeder.bundle --data <folder> --ipc    for the desktop app: newline JSON
//                                               { id, method: status|pair } over stdio
//
// Stores encrypted sheet data only. It never receives a sheet's key.

const Hypercore = require('hypercore')
const b4a = require('b4a')
const { applyEncryptionReloadFix } = require('../worklet/hypercoreEncryptionPatch')
applyEncryptionReloadFix(Hypercore, b4a)

const { createSeeder } = require('./seeder')
const { toTerminal } = require('../shared/qr')

const argv = Bare.argv.slice(2)
const dataIndex = argv.indexOf('--data')
const dataDir = dataIndex !== -1 ? argv[dataIndex + 1] : null
const ipc = argv.includes('--ipc')
if (!dataDir) {
  console.error('usage: bare seeder.bundle --data <folder> [--ipc]')
  Bare.exit(2)
}

const fs = require('bare-fs')
const send = (obj) => fs.writeSync(1, JSON.stringify(obj) + '\n')
const say = ipc ? (line) => send({ event: 'log', data: line }) : (line) => console.log('[pearsheet-seeder] ' + line)

async function main () {
  const seeder = await createSeeder({ dataDir, log: say })
  const stdin = require('bare-process').stdin
  let buf = ''

  if (ipc) {
    const methods = {
      status: () => seeder.status(),
      pair: () => seeder.openPairing()
    }
    stdin.on('data', async (chunk) => {
      buf += chunk.toString()
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        const fn = methods[msg.method]
        if (!fn) { send({ id: msg.id, error: 'unknown method' }); continue }
        try { send({ id: msg.id, result: await fn(msg.args || {}) }) } catch (err) { send({ id: msg.id, error: err.message }) }
      }
    })
    stdin.on('end', stop) // the desktop app went away
    send({ event: 'ready', data: { seederKey: b4a.toString(seeder.seederKey, 'hex') } })
  } else {
    say('seeder key ' + b4a.toString(seeder.seederKey, 'hex'))
    const show = () => {
      const { link, expiresAt } = seeder.openPairing()
      say('pair a device within 5 minutes: scan this, or paste the link in PearSheet > Seeder')
      console.log(toTerminal(link))
      console.log(link)
      say('window closes at ' + new Date(expiresAt).toISOString())
    }
    show()
    stdin.on('data', async (chunk) => {
      buf += chunk.toString()
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const cmd = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (cmd === 'pair') show()
        else if (cmd === 'status') say(JSON.stringify(await seeder.status()))
        else if (cmd) say('commands: pair, status')
      }
    })
  }

  async function stop () {
    say('stopping')
    try { await seeder.close() } catch {}
    Bare.exit(0)
  }
  try {
    const signals = require('bare-signals')
    for (const name of ['SIGINT', 'SIGTERM']) { const s = new signals.Signal(name); s.on('signal', stop); s.start(); s.unref() }
  } catch {}
}

main().catch((err) => {
  console.error('[pearsheet-seeder] failed:', err && err.message)
  Bare.exit(1)
})
