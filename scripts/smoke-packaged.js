// Run the desktop smoke test against a packaged app instead of the checkout:
//   node scripts/smoke-packaged.js <path to the app executable> [--part sheets|sheet-files|docs|app] [screenshot.png]
// e.g. the AppImage, PearOffice.app/Contents/MacOS/PearOffice or PearOffice.exe.
// Each part runs in its own launch of the app (see desktop/smoke/launch.js).
const { parseArgs, runParts } = require('../desktop/smoke/launch')

const exe = process.argv[2]
if (!exe) { console.error('usage: node scripts/smoke-packaged.js <app executable> [--part name] [shot.png]'); process.exit(2) }
const opts = parseArgs(process.argv.slice(3))
const args = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []
runParts({ command: exe, args, label: 'packaged smoke', parts: opts.parts, shot: opts.shot, timeout: 120000, echo: false })
  .then((ok) => {
    if (ok) console.log('ok - packaged smoke: ' + exe)
    process.exit(ok ? 0 : 1)
  })
