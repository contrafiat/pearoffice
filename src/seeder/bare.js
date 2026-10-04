// PearSheet seeder, run with the Bare runtime:
//
//   bare seeder.bundle --data <folder>
//
// Prints the seeder's key and a pairing link valid for 5 minutes. Type
// `pair` and Enter to open a new pairing window, `status` for counts.
// Stores encrypted sheet data only. It never receives a sheet's key.

const Hypercore = require('hypercore')
const b4a = require('b4a')
const { applyEncryptionReloadFix } = require('../worklet/hypercoreEncryptionPatch')
applyEncryptionReloadFix(Hypercore, b4a)

const { createSeeder } = require('./seeder')

const argv = Bare.argv.slice(2)
const dataIndex = argv.indexOf('--data')
const dataDir = dataIndex !== -1 ? argv[dataIndex + 1] : null
if (!dataDir) {
  console.error('usage: bare seeder.bundle --data <folder>')
  Bare.exit(2)
}

const say = (line) => console.log('[pearsheet-seeder] ' + line)

async function main () {
  const seeder = await createSeeder({ dataDir, log: say })
  say('seeder key ' + b4a.toString(seeder.seederKey, 'hex'))
  const show = () => {
    const { link, expiresAt } = seeder.openPairing()
    say('pair a device within 5 minutes (PearSheet > Seeder > paste this link):')
    console.log(link)
    say('window closes at ' + new Date(expiresAt).toISOString())
  }
  show()

  const stdin = require('bare-process').stdin
  let buf = ''
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

  const stop = async () => {
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
