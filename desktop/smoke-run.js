// In-app part of the desktop smoke test (see smoke.js). Runs in the main
// process with an offscreen window: creates a sheet through the UI, types
// with real key events, reads the grid back from the DOM and saves a
// screenshot. Prints one JSON line and quits.

const fs = require('node:fs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run ({ app, win, ready, log }) {
  const wc = win.webContents
  const result = { ok: false, steps: [] }
  const js = (code) => wc.executeJavaScript(code, true)
  const step = (name, data) => { result.steps.push(data === undefined ? name : { [name]: data }); log('smoke:', name) }

  async function waitFor (label, code, timeout = 20000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await js(code).catch(() => false)) return
      await sleep(100)
    }
    throw new Error('timed out waiting for ' + label)
  }

  async function type (text) {
    for (const ch of text) {
      const modifiers = /[A-Z]/.test(ch) ? ['shift'] : []
      wc.sendInputEvent({ type: 'keyDown', keyCode: ch, modifiers })
      wc.sendInputEvent({ type: 'char', keyCode: ch, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode: ch, modifiers })
      await sleep(40)
    }
  }

  async function key (keyCode) {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
    await sleep(80)
  }

  const cellText = (row, col) => js(`(() => {
    const el = [...document.querySelectorAll('.cell')].find((c) => c.style.top === '${(row - 1) * 24}px' && c.style.left === document.querySelectorAll('.col-head')[${col - 1}].style.left)
    return el ? el.textContent : null
  })()`)

  try {
    await ready
    step('worklet ready')
    await new Promise((resolve) => wc.isLoading() ? wc.once('did-finish-load', resolve) : resolve())
    // Generous: a first launch on macOS includes the system's check of the new app.
    await waitFor('sheet list', "!!document.querySelector('.new-sheet') && !document.querySelector('.sheet-list .muted')?.textContent.includes('Starting')", 60000)
    step('ui loaded')

    await js("document.querySelector('.new-sheet').click()")
    await waitFor('grid', "!!document.querySelector('.grid .body')")
    await js("document.querySelector('.grid .body').focus()")
    step('sheet created')

    await type('Rent'); await key('Tab')
    await type('1200'); await key('Enter')
    await js("document.querySelector('.grid .body').focus()")
    await key('Left')
    await type('Food'); await key('Tab')
    await type('450.5'); await key('Enter')
    await key('Left')
    await type('Total'); await key('Tab')
    await type('=SUM(B1:B2)'); await key('Enter')
    await waitFor('formula result', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === '1650.5')")
    step('typed and computed')

    result.grid = {
      A1: await cellText(1, 1),
      B1: await cellText(1, 2),
      A3: await cellText(3, 1),
      B3: await cellText(3, 2)
    }
    // Back up to B3: the formula bar shows the formula in A1 form.
    await key('Up')
    result.formulaBar = await js("document.querySelector('.formula-bar input').value")

    // Bold B3 with Ctrl+B and check the class.
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: ['control'] })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'B', modifiers: ['control'] })
    await waitFor('bold applied', "[...document.querySelectorAll('.cell.b')].some((c) => c.textContent === '1650.5')")
    step('bold')

    // Undo the bold.
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] })
    await waitFor('bold undone', "!document.querySelector('.cell.b')")
    result.afterUndo = await cellText(3, 2)
    step('undo')

    // Rename the sheet.
    await js(`(() => {
      const el = document.querySelector('.title')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      el.focus(); set.call(el, 'Household budget'); el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })()`)
    await waitFor('title in list', "[...document.querySelectorAll('.sheet-link')].some((b) => b.textContent === 'Household budget')")
    step('renamed')

    // Share: the owner gets a single-use invite link.
    await js("document.querySelector('.toolbar .share').click()")
    await waitFor('share panel', "!!document.querySelector('.panel .invite-actions')")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent === 'Invite to edit').click()")
    await waitFor('invite link', "(document.querySelector('.invite-link input') || {}).value?.startsWith('pearsheet://join?')")
    result.inviteLink = (await js("document.querySelector('.invite-link input').value")).slice(0, 24)
    step('invite link')

    await sleep(300)
    const shot = process.env.PEARSHEET_SMOKE_SHOT
    if (shot) {
      const image = await wc.capturePage()
      fs.writeFileSync(shot, image.toPNG())
      step('screenshot', shot)
    }
    result.ok = result.inviteLink === 'pearsheet://join?s=' + result.inviteLink.slice(19) && result.afterUndo === '1650.5' && result.grid.B3 === '1650.5' && result.grid.A1 === 'Rent' && result.formulaBar === '=SUM(B1:B2)'
  } catch (err) {
    result.error = err.message
    // What the page showed, to tell a UI failure from a load failure.
    result.page = await js("(document.body && document.body.innerText || '').slice(0, 300) + ' | url=' + location.href").catch((e) => 'unreadable: ' + e.message)
  }
  console.log('SMOKE_RESULT ' + JSON.stringify(result))
  app.quit()
}

module.exports = { run }
