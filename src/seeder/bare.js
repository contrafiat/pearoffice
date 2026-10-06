// PearOffice seeder, run with the Bare runtime:
//
//   bare seeder.bundle --data <folder>          interactive: prints the key and a
//                                               pairing link with a QR code; type
//                                               `pair` for a new one, `status`,
//                                               `devices` or `forget <device key>`
//   bare seeder.bundle --data <folder> --forget <device key>
//                                               forget that device on start, then
//                                               run as usual
//   bare seeder.bundle --data <folder> --ipc    for the desktop app: newline JSON
//                                               { id, method: status|pair|devices|forget }
//                                               over stdio
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
const forgetIndex = argv.indexOf('--forget')
const forgetOnStart = forgetIndex !== -1 ? argv[forgetIndex + 1] : null
if (!dataDir || (forgetIndex !== -1 && !/^[0-9a-f]{64}$/.test(forgetOnStart || ''))) {
  console.error('usage: bare seeder.bundle --data <folder> [--forget <device key>] [--ipc]')
  Bare.exit(2)
}

const fs = require('bare-fs')
const send = (obj) => fs.writeSync(1, JSON.stringify(obj) + '\n')
const say = ipc ? (line) => send({ event: 'log', data: line }) : (line) => console.log('[pearoffice-seeder] ' + line)

async function main () {
  const seeder = await createSeeder({ dataDir, log: say })
  if (forgetOnStart) {
    const r = await seeder.forgetDevice(forgetOnStart)
    say(r.forgotten ? 'forgot that device; ' + r.dropping + ' sheet(s) will be deleted in 7 days' : 'that device was not paired')
  }
  // Forget a device by its full key or a unique start of it.
  async function forget (prefix) {
    const p = String(prefix || '').trim().toLowerCase()
    const matches = p.length >= 6 ? (await seeder.devices()).filter((d) => d.deviceKey.startsWith(p)) : []
    if (matches.length !== 1) throw new Error(matches.length ? 'More than one device starts with that' : 'No paired device starts with that')
    return seeder.forgetDevice(matches[0].deviceKey)
  }
  const stdin = require('bare-process').stdin
  let buf = ''

  if (ipc) {
    const methods = {
      status: () => seeder.status(),
      pair: () => seeder.openPairing(),
      devices: () => seeder.devices(),
      forget: ({ deviceKey }) => forget(deviceKey)
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
      say('pair a device within 5 minutes: scan this, or paste the link in PearOffice > Seeder')
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
        else if (cmd === 'devices') {
          const list = await seeder.devices()
          if (!list.length) say('no paired devices')
          for (const d of list) say(d.deviceKey + '  paired ' + new Date(d.pairedAt || 0).toISOString().slice(0, 10) + '  ' + d.sheets + ' sheet(s)')
        } else if (cmd.startsWith('forget ')) {
          try {
            const r = await forget(cmd.slice(7))
            say('forgot that device; ' + r.dropping + ' sheet(s) will be deleted in 7 days')
          } catch (err) { say(err.message) }
        } else if (cmd) say('commands: pair, status, devices, forget <device key>')
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
  console.error('[pearoffice-seeder] failed:', err && err.message)
  Bare.exit(1)
})
