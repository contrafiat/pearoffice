// In-app part of the desktop smoke test (see smoke.js). Runs in the main
// process with an offscreen window and drives the UI with real key and mouse
// events. PEAROFFICE_SMOKE_PART picks one part (smoke/<part>.js); each runs
// in its own launch against its own data folder. Prints one JSON line and
// quits.

const { helpers } = require('./smoke/common')

const PARTS = ['sheets', 'sheet-files', 'docs', 'slides', 'slides-present', 'slides-objects', 'slides-export', 'slides-import', 'app']

async function run ({ app, win, ready, log, dataDir, getTray }) {
  const part = process.env.PEAROFFICE_SMOKE_PART
  const result = { ok: false, part, steps: [] }
  const t = { ...helpers({ win, dataDir, result, log }), getTray }
  const { js, step, waitFor, wc } = t

  try {
    if (!PARTS.includes(part)) throw new Error('PEAROFFICE_SMOKE_PART must be one of ' + PARTS.join(', '))
    await ready
    step('worklet ready')
    await new Promise((resolve) => wc.isLoading() ? wc.once('did-finish-load', resolve) : resolve())
    // Generous: a first launch on macOS includes the system's check of the new app.
    await waitFor('sheet list', "!!document.querySelector('.new-sheet') && !document.querySelector('.sheet-list .muted')?.textContent.includes('Starting')", 60000)
    step('ui loaded')
    result.ok = !!(await require('./smoke/' + part)(t))
  } catch (err) {
    result.error = err.message
    // What the page showed, to tell a UI failure from a load failure.
    result.page = await js("(document.body && document.body.innerText || '').slice(0, 600) + ' | url=' + location.href").catch((e) => 'unreadable: ' + e.message)
    result.cells = await js("[...document.querySelectorAll('.cell')].filter((c) => c.textContent).map((c) => c.style.top + '/' + c.style.left + '=' + c.textContent)").catch(() => null)
  }
  console.log('SMOKE_RESULT ' + JSON.stringify(result))
  app.quit()
}

module.exports = { run, PARTS }
