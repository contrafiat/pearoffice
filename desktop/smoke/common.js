// Helpers shared by the smoke test parts (see ../smoke-run.js).

const fs = require('node:fs')
const path = require('node:path')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function helpers ({ win, dataDir, result, log }) {
  const wc = win.webContents
  const js = (code) => wc.executeJavaScript(code, true)
  const step = (name, data) => { result.steps.push(data === undefined ? name : { [name]: data }); log('smoke:', name) }
  const downloads = path.join(dataDir, 'downloads')

  async function waitFor (label, code, timeout = 20000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await js(code).catch(() => false)) return
      await sleep(100)
    }
    throw new Error('timed out waiting for ' + label)
  }

  async function openSettings () {
    await js("document.querySelector('.me-row').click()")
    await waitFor('settings open', "!!document.querySelector('.panel.settings')")
  }

  async function type (text, gap = 40) {
    for (const ch of text) {
      const modifiers = /[A-Z]/.test(ch) ? ['shift'] : []
      wc.sendInputEvent({ type: 'keyDown', keyCode: ch, modifiers })
      wc.sendInputEvent({ type: 'char', keyCode: ch, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode: ch, modifiers })
      if (gap) await sleep(gap)
    }
  }

  async function key (keyCode) {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
    await sleep(80)
  }

  // Ctrl shortcuts are Cmd on a Mac, where the editors (TipTap's Mod-) want
  // Cmd; the grid takes either.
  const sendMod = async (keyCode, modifiers = []) => {
    if (process.platform === 'darwin') modifiers = modifiers.map((m) => (m === 'control' ? 'meta' : m))
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await sleep(60)
  }

  const more = async (label) => {
    await js("document.querySelector('.toolbar .more-button').click()")
    await waitFor('more menu: ' + label, "[...document.querySelectorAll('.more-menu li')].some((l) => l.textContent === " + JSON.stringify(label) + ')')
    await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === " + JSON.stringify(label) + ').click()')
  }

  const waitFile = async (file, timeout = 15000) => {
    for (const t0 = Date.now(); !(fs.existsSync(file) && fs.statSync(file).size > 0) && Date.now() - t0 < timeout;) await sleep(200)
    await sleep(300)
    return fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0)
  }

  // A new spreadsheet from the sidebar's New, with the grid focused. With a
  // sheet already open its grid is on screen before the new one opens, so
  // the side list's links are marked first and the new file's link (not
  // marked) must be the open one. On a slow machine (the Intel Mac build
  // under Rosetta) the grid could otherwise be swapped out mid-focus.
  async function newSheet () {
    await js("document.querySelectorAll('.sheet-link').forEach((l) => { l.dataset.smokeOld = '1' })")
    await js("document.querySelector('.sidebar .new-sheet').click()")
    await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-sheet')")
    await js("document.querySelector('.kind-choice.kind-sheet').click()")
    await waitFor('new sheet open', "!!document.querySelector('.sheet-link.active:not([data-smoke-old])') && !!document.querySelector('.grid .body') && !!document.querySelector('.selection')")
    // Let the new sheet settle, then make sure the grid has focus.
    await sleep(500)
    await waitFor('grid focus', "(() => { const b = document.querySelector('.grid .body'); if (b && document.activeElement !== b) b.focus(); return !!b && document.activeElement === b })()")
  }

  // Saves a screenshot to the file an env var names, if it is set.
  async function shot (envName, settle = 0) {
    const file = process.env[envName]
    if (!file) return
    if (settle) await sleep(settle)
    fs.writeFileSync(file, (await wc.capturePage()).toPNG())
  }

  return { wc, js, step, waitFor, openSettings, type, key, sendMod, more, waitFile, newSheet, shot, downloads, dataDir, result, win, sleep }
}

module.exports = { helpers, sleep }
