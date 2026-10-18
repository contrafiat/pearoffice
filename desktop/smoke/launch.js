// Runs the smoke test parts one after another, each in its own app launch
// with a throwaway data folder and its own time limit. Used by ../smoke.js
// (the checkout) and scripts/smoke-packaged.js (an installed app).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { PARTS, EXTRA_PARTS } = require('../smoke-run')

// Splits [--part name] and one optional screenshot path out of argv.
function parseArgs (argv) {
  const out = { parts: PARTS, shot: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--part') out.parts = argv[++i].split(',')
    else if (argv[i].startsWith('--part=')) out.parts = argv[i].slice(7).split(',')
    else out.shot = path.resolve(argv[i])
  }
  const bad = out.parts.filter((p) => !PARTS.includes(p) && !EXTRA_PARTS.includes(p))
  if (bad.length) { console.error('unknown part ' + bad.join(', ') + ' (parts: ' + PARTS.join(', ') + ')'); process.exit(2) }
  return out
}

function runPart ({ command, args, part, shot, timeout, echo }) {
  return new Promise((resolve) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-smoke-' + part + '-'))
    const started = Date.now()
    const child = spawn(command, args, {
      env: { ...process.env, PEAROFFICE_SMOKE: '1', PEAROFFICE_SMOKE_PART: part, PEAROFFICE_DATA: dataDir, PEAROFFICE_SMOKE_SHOT: shot, PEAROFFICE_NO_ONBOARDING: part.startsWith('onboarding') ? '' : '1' },
      stdio: ['ignore', 'pipe', echo ? 'inherit' : 'pipe']
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d; if (echo) process.stdout.write(d) })
    if (!echo) child.stderr.on('data', (d) => { out += d })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeout)
    child.on('exit', () => {
      clearTimeout(timer)
      fs.rmSync(dataDir, { recursive: true, force: true })
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      const line = out.split('\n').find((l) => l.includes('SMOKE_RESULT '))
      const result = line
        ? JSON.parse(line.slice(line.indexOf('SMOKE_RESULT ') + 13))
        : { ok: false, error: timedOut ? 'timed out after ' + timeout / 1000 + ' s' : 'no result line', tail: out.slice(-1500) }
      resolve({ part, seconds, result })
    })
  })
}

// Runs each part and prints one ok or not ok line per part and a summary.
// A failed part runs again up to `retries` times (the packaged smoke gives
// one, so a slow machine's one-off failure does not drop a release build).
// Resolves to true when every part passed.
async function runParts ({ command, args, label, parts, shot, timeout, echo, retries = 0 }) {
  const failed = []
  for (const part of parts) {
    let run = await runPart({ command, args, part, shot, timeout, echo })
    let tries = 1
    while (!run.result.ok && tries <= retries) {
      console.error('# ' + label + ' ' + part + ' failed (' + run.seconds + ' s), trying again: ' + JSON.stringify(run.result).slice(0, 600))
      run = await runPart({ command, args, part, shot, timeout, echo })
      tries++
    }
    const { seconds, result } = run
    // Timings a part records (result.timings, in ms) go on its line.
    const timings = result.timings ? ' [' + Object.entries(result.timings).map(([k, v]) => k + ' ' + v + ' ms').join(', ') + ']' : ''
    const again = tries > 1 ? ' [passed on try ' + tries + ']' : ''
    if (result.ok) console.log('ok - ' + label + ' ' + part + ' (' + seconds + ' s): ' + result.steps.filter((s) => typeof s === 'string').slice(2).join(', ') + timings + again)
    else {
      failed.push(part)
      console.error('not ok - ' + label + ' ' + part + ' (' + seconds + ' s) ' + JSON.stringify(result))
    }
  }
  if (failed.length) console.error('not ok - ' + label + ': ' + failed.length + ' of ' + parts.length + ' parts failed (' + failed.join(', ') + ')')
  else console.log('ok - ' + label + ': ' + parts.length + ' of ' + parts.length + ' parts passed')
  return failed.length === 0
}

module.exports = { parseArgs, runParts }
