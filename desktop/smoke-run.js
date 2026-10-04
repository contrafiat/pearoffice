// In-app part of the desktop smoke test (see smoke.js). Runs in the main
// process with an offscreen window: creates a sheet through the UI, types
// with real key events, reads the grid back from the DOM and saves a
// screenshot. Prints one JSON line and quits.

const fs = require('node:fs')
const path = require('node:path')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run ({ app, win, ready, log, dataDir, getTray }) {
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
    await waitFor('grid', "!!document.querySelector('.grid .body') && !!document.querySelector('.selection')")
    // Let the new sheet settle, then make sure the grid has focus.
    await sleep(500)
    await js("document.querySelector('.grid .body').focus()")
    await waitFor('grid focus', "document.activeElement === document.querySelector('.grid .body')")
    step('sheet created')

    const hasCell = (text) => `[...document.querySelectorAll('.cell')].some((c) => c.textContent === ${JSON.stringify(text)})`
    async function enter (text, then, shows = text) {
      await type(text)
      await key(then)
      await waitFor('cell ' + text, hasCell(shows))
      await waitFor('grid focus', "document.activeElement === document.querySelector('.grid .body')")
    }
    await enter('Rent', 'Tab')
    await enter('1200', 'Enter')
    await key('Left')
    await enter('Food', 'Tab')
    await enter('450.5', 'Enter')
    await key('Left')
    await enter('Total', 'Tab')
    await enter('=SUM(B1:B2)', 'Enter', '1650.5')
    step('typed and computed')

    // Formula suggestions: =su lists SUM; Down, Down, Tab inserts it; inside
    // the brackets the argument help shows; Escape leaves the cell as it was.
    await type('=su')
    await waitFor('suggestions', "!!document.querySelector('.formula-help') && document.querySelector('.formula-help').textContent.includes('SUM(')")
    if (process.env.PEARSHEET_SMOKE_HELP_SHOT) fs.writeFileSync(process.env.PEARSHEET_SMOKE_HELP_SHOT, (await wc.capturePage()).toPNG())
    result.suggested = await js("[...document.querySelectorAll('.formula-help .fname')].map((e) => e.textContent).slice(0, 3).join(',')")
    await key('Down'); await key('Down'); await key('Tab')
    await waitFor('function inserted', "(document.querySelector('.grid .editor') || {}).value === '=SUM('")
    await type('B1')
    await waitFor('argument help', "!!document.querySelector('.formula-help .sig b')")
    result.argHelp = await js("document.querySelector('.formula-help .sig b').textContent")
    await key('Escape')
    await waitFor('edit cancelled', "!document.querySelector('.grid .editor') && !document.querySelector('.formula-help')")
    await js("document.querySelector('.grid .body').focus()")
    step('formula suggestions')

    // Spilling: =SEQUENCE(3) in H1 fills H1:H3 and outlines the block; a
    // value typed in H3 blocks it (#SPILL!) with a note saying why.
    for (let i = 0; i < 6; i++) await key('Right')
    for (let i = 0; i < 3; i++) await key('Up')
    await enter('=SEQUENCE(3)', 'Enter', '1')
    const cellAt = (a1) => "[...document.querySelectorAll('.cell')].find((c) => c.dataset.r === '" + a1[1] + "' && c.dataset.c === '8')"
    await waitFor('spilled', cellAt('H3') + ".textContent === '3' && " + cellAt('H2') + ".textContent === '2'")
    await waitFor('spill outline', "!!document.querySelector('.spill-outline') && document.querySelector('.formula-bar input').value === '=SEQUENCE(3)' && document.querySelector('.formula-bar input').classList.contains('spilled')")
    // H1# is the whole spill from H1.
    await key('Up'); await key('Right')
    await enter('=SUM(H1#)', 'Enter', '6')
    await key('Left')
    await key('Down')
    await enter('x', 'Enter')
    for (let i = 0; i < 3; i++) await key('Up')
    await waitFor('spill blocked', cellAt('H1') + ".textContent === '#SPILL!' && !!document.querySelector('.spill-note') && document.querySelector('.spill-note').textContent.includes('H3')")
    await key('Down'); await key('Down')
    await key('Delete')
    await waitFor('spill back', cellAt('H3') + ".textContent === '3'")
    await key('Up'); await key('Up')
    await key('Delete')
    await waitFor('spill cleared', cellAt('H1') + ".textContent === '' && !document.querySelector('.spill-outline')")
    await key('Right'); await key('Delete'); await key('Left')
    for (let i = 0; i < 6; i++) await key('Left')
    for (let i = 0; i < 3; i++) await key('Down')
    result.spill = true
    step('spilling formula')

    // Quick wins: totals of the selection, Ctrl+Home and Ctrl+Down, more
    // decimals, and "Paste values only" from the cell menu.
    const cellNode = (r, c) => "[...document.querySelectorAll('.cell')].find((x) => x.dataset.r === '" + r + "' && x.dataset.c === '" + c + "')"
    const sendMod = async (keyCode, modifiers) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await sleep(60) }
    await sendMod('Home', ['control'])
    await waitFor('at A1', "document.querySelector('.formula-bar .address').textContent === 'A1'")
    await sendMod('Down', ['control'])
    await waitFor('Ctrl+Down to A3', "document.querySelector('.formula-bar .address').textContent === 'A3'")
    await key('Right'); await key('Up'); await key('Up')
    await sendMod('Down', ['shift']); await sendMod('Down', ['shift'])
    await waitFor('totals', "!!document.querySelector('.totals') && document.querySelector('.totals').textContent.includes('Sum 3301') && document.querySelector('.totals').textContent.includes('Count 3')")
    await key('Up'); await key('Down')
    await js("document.querySelector('.tools [aria-label=\"More decimal places\"]').click()")
    await waitFor('more decimals', cellNode(2, 2) + ".textContent === '450.50'")
    await key('Down')
    await js(`(() => { const el = ${cellNode(3, 2)}; el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 })) })()`)
    await waitFor('cell menu', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Copy')")
    await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Copy').click()")
    await key('Right'); await key('Right')
    await js(`(() => { const el = ${cellNode(3, 4)}; el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 200 })) })()`)
    await waitFor('cell menu again', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Paste values only')")
    await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Paste values only').click()")
    await waitFor('pasted value', cellNode(3, 4) + ".textContent === '1650.5' && document.querySelector('.formula-bar input').value === '1650.5'")
    await key('Delete')
    await waitFor('cleared', cellNode(3, 4) + ".textContent === ''")
    await key('Left'); await key('Left'); await key('Down')
    result.quickWins = true
    step('totals, shortcuts, decimals, paste values')

    // Ranges, copy and paste: select B1:B3, copy, paste into C1. The formula
    // moves with it, as in Excel.
    for (let i = 0; i < 3; i++) await key('Up')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['shift'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down', modifiers: ['shift'] }); await sleep(80)
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['shift'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down', modifiers: ['shift'] }); await sleep(150)
    await waitFor('range shown', "!!document.querySelector('.range')")
    wc.copy()
    await sleep(200)
    await key('Right')
    wc.paste()
    await waitFor('pasted', "[...document.querySelectorAll('.cell')].filter((c) => c.textContent === '1650.5').length === 2")
    // Go to C3 to read its formula, then reselect C1:C3 from there.
    await key('Down')
    await key('Down')
    result.pastedFormula = await js("document.querySelector('.formula-bar input').value")
    for (let i = 0; i < 2; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Up', modifiers: ['shift'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Up', modifiers: ['shift'] }); await sleep(100) }
    step('copy and paste')

    // Fill colour on the pasted range, then clear it.
    await js("document.querySelectorAll('.swatch-button')[1].click()")
    await waitFor('palette', "!!document.querySelector('.palette')")
    await js("document.querySelector('.palette .swatch').click()")
    await waitFor('fill applied', "[...document.querySelectorAll('.cell')].filter((c) => c.style.background).length >= 3")
    step('fill colour')
    await js("document.querySelector('.grid .body').focus()")
    await key('Delete')
    await waitFor('range cleared', "[...document.querySelectorAll('.cell')].filter((c) => c.textContent === '1650.5').length === 1")
    step('clear range')
    // Back to B4, where the rest of the test expects to be (active cell is C3).
    await key('Left')
    await key('Down')

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
    await waitFor('title in list', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent.trim() === 'Household budget')")
    step('renamed')

    // Type with no gap between keys: keys that arrive before the cell editor
    // is drawn must still land in it, in order.
    await js("document.querySelector('.grid .body').focus()")
    for (let i = 0; i < 4; i++) await key('Down')
    await type('Typed fast 123', 0)
    await key('Enter')
    await waitFor('fast typing kept', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Typed fast 123')", 10000)
    step('fast typing')

    // Export to .xlsx, then import that file back through the file picker.
    const downloads = require('node:path').join(dataDir, 'downloads')
    await js("document.querySelector('.toolbar .export').click()")
    const file = require('node:path').join(downloads, 'Household budget.xlsx')
    const start = Date.now()
    while (!(fs.existsSync(file) && fs.statSync(file).size > 1000) && Date.now() - start < 20000) await sleep(200)
    await sleep(500)
    result.exportedBytes = fs.existsSync(file) ? fs.statSync(file).size : 0
    step('export')
    const b64 = fs.readFileSync(file).toString('base64')
    await js(`(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'Imported budget.xlsx'))
      const input = document.querySelector('.import input[type=file]')
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await waitFor('imported sheet open', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent.trim() === 'Imported budget') && document.querySelector('.title').value === 'Imported budget'")
    await waitFor('imported values', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === '1650.5') && [...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Rent')")
    await js("document.querySelector('.grid .body').focus()")
    for (let i = 0; i < 2; i++) await key('Down')
    await key('Right')
    result.importedFormula = await js("document.querySelector('.formula-bar input').value")
    step('import')

    // The Seeder and Devices panels reach the engine (seeder: and link: calls).
    await openSettings()
    await js("document.querySelector('.panel .settings-seeder').click()")
    await waitFor('seeder panel lists seeders', "!!document.querySelector('.panel') && document.querySelector('.panel').textContent.includes('None yet')")
    await js("document.querySelector('.panel .close').click()")
    await openSettings()
    await js("document.querySelector('.panel .settings-devices').click()")
    await waitFor('devices panel', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Link a new device')")
    // Back returns to Settings.
    await js("document.querySelector('.panel .back').click()")
    await waitFor('back in settings', "!!document.querySelector('.panel.settings')")
    await js("document.querySelector('.panel .settings-devices').click()")
    await waitFor('devices panel again', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Link a new device')")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Link a new device').click()")
    await waitFor('device link', "(document.querySelector('.panel input') || {}).value?.startsWith('pearsheet://link?')")
    await js("document.querySelector('.panel .close').click()")
    await openSettings()
    await js("document.querySelector('.panel .settings-devices').click()")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Show my phrase').click()")
    await waitFor('recovery phrase', "document.querySelectorAll('.phrase li').length === 24")
    await js("document.querySelector('.panel .close').click()")
    step('seeder and devices panels')

    // Run a seeder on this computer, pair this device with it, show its QR.
    await openSettings()
    await js("document.querySelector('.panel .settings-seeder').click()")
    await waitFor('local seeder switch', "[...document.querySelectorAll('.panel label')].some((l) => l.textContent.includes('Run a seeder'))")
    await js("[...document.querySelectorAll('.panel label')].find((l) => l.textContent.includes('Run a seeder')).querySelector('input').click()")
    await waitFor('local seeder running', "document.querySelector('.panel').textContent.includes('Holding')", 60000)
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Pair this device with it').click()")
    await waitFor('paired with the local seeder', "document.querySelector('.panel').textContent.includes('Paired. Your sheets are backing up.')", 60000)
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Show pairing code').click()")
    await waitFor('pairing QR', "!!document.querySelector('.pairing .qr svg')")
    await waitFor('seeder holds the sheets', "/Holding [1-9]/.test(document.querySelector('.panel').textContent)", 30000)
    await js("document.querySelector('.panel .close').click()")
    step('local seeder: running, paired, QR, holding sheets')

    // Keep sheets online: closing the window hides it, the app keeps running.
    await openSettings()
    await js("document.querySelector('.panel .keep-online input').click()")
    await waitFor('setting on', "document.querySelector('.keep-online input').checked")
    await waitFor('start at login shown', "!!document.querySelector('.start-at-login input')")
    await js("document.querySelector('.start-at-login input').click()")
    await waitFor('start at login on', "document.querySelector('.start-at-login input').checked")
    await js("document.querySelector('.panel .close').click()")
    if (process.platform === 'linux') {
      const entry = fs.readFileSync(path.join(dataDir, 'autostart', 'pearsheet.desktop'), 'utf8')
      result.autostart = /^Exec=.* "--hidden"$/m.test(entry)
    } else if (process.platform === 'darwin') {
      const agent = fs.readFileSync(path.join(dataDir, 'autostart', 'com.peerloom.pearsheet.login.plist'), 'utf8')
      result.autostart = agent.includes('<string>--hidden</string>')
    } else result.autostart = true
    win.close()
    await sleep(500)
    result.keepOnline = !win.isDestroyed() && !!getTray()
    step('keep online: window hidden, tray up')

    // Profile picture: a picked image is shrunk, saved and shown, here and
    // in the share panel.
    await openSettings()
    await js(`(async () => {
      const c = document.createElement('canvas')
      c.width = 300; c.height = 200
      const g = c.getContext('2d')
      g.fillStyle = '#5b8c3a'; g.fillRect(0, 0, 300, 200)
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'me.png', { type: 'image/png' }))
      const input = document.querySelector('.panel .me input[type=file]')
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await waitFor('own picture shown', "!!document.querySelector('.panel .me-picture img.avatar') && !!document.querySelector('.me-row img.avatar')")
    result.avatar = await js("document.querySelector('.me-row img.avatar').src.startsWith('data:image/jpeg;base64,')")
    // About: version and the open-source list.
    await js("document.querySelector('.panel .about-link').click()")
    await waitFor('about', "document.querySelector('.panel').textContent.includes('Open-source software') && /Version \\d/.test(document.querySelector('.panel').textContent)")
    await js("document.querySelector('.panel .close').click()")
    await waitFor('owner picture in the sheet list', "!!document.querySelector('.sheet-link .sheet-owner img.avatar')")
    step('profile picture')

    // Share: the owner gets a single-use invite link.
    await js("document.querySelector('.toolbar .share').click()")
    await waitFor('share panel', "!!document.querySelector('.panel .invite-actions')")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Invite to edit').click()")
    await waitFor('invite link', "(document.querySelector('.invite-link input') || {}).value?.startsWith('pearsheet://join?')")
    await waitFor('invite QR', "!!document.querySelector('.invite-link .qr svg')")
    result.inviteLink = (await js("document.querySelector('.invite-link input').value")).slice(0, 24)
    await waitFor('picture in the share panel', "!!document.querySelector('.people img.avatar')")
    step('invite link')

    // Stop backing up this sheet to the local seeder, then add it back.
    await waitFor('backups listed', "[...document.querySelectorAll('.backups button')].some((b) => b.textContent.trim() === 'Stop')", 30000)
    await js("[...document.querySelectorAll('.backups button')].find((b) => b.textContent.trim() === 'Stop').click()")
    await waitFor('seeder stopped', "[...document.querySelectorAll('.backups button')].some((b) => b.textContent.trim() === 'Back up here')", 30000)
    await js("[...document.querySelectorAll('.backups button')].find((b) => b.textContent.trim() === 'Back up here').click()")
    await waitFor('seeder back', "[...document.querySelectorAll('.backups button')].some((b) => b.textContent.trim() === 'Stop')", 30000)
    result.backups = true
    step('stop and restart a backup')

    // Remove the open sheet from this device: it leaves the list.
    await js("document.querySelector('.panel .close').click()")
    result.sheetsBefore = await js("document.querySelectorAll('.sheet-link').length")
    await js("document.querySelector('.toolbar .more-button').click()")
    await waitFor('more menu', "[...document.querySelectorAll('.more-menu li')].some((l) => l.textContent.trim() === 'Delete for everyone')")
    await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent.trim() === 'Remove from this device').click()")
    await waitFor('confirm', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Remove from this device')")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Remove from this device').click()")
    await waitFor('sheet removed', "!document.querySelector('.panel') && document.querySelectorAll('.sheet-link').length === " + (result.sheetsBefore - 1), 30000)
    result.sheetsAfter = await js("document.querySelectorAll('.sheet-link').length")
    step('removed from this device')

    await sleep(300)
    const shot = process.env.PEARSHEET_SMOKE_SHOT
    if (shot) {
      const image = await wc.capturePage()
      fs.writeFileSync(shot, image.toPNG())
      step('screenshot', shot)
    }
    result.ok = result.keepOnline && result.avatar && result.spill && result.quickWins && result.suggested === 'SUBSTITUTE,SUBTOTAL,SUM' && result.argHelp === 'number1' && result.autostart && result.backups && result.sheetsAfter === result.sheetsBefore - 1 && result.importedFormula === '=SUM(B1:B2)' && result.exportedBytes > 1000 && result.pastedFormula === '=SUM(C1:C2)' && result.inviteLink === 'pearsheet://join?s=' + result.inviteLink.slice(19) && result.afterUndo === '1650.5' && result.grid.B3 === '1650.5' && result.grid.A1 === 'Rent' && result.formulaBar === '=SUM(B1:B2)'
  } catch (err) {
    result.error = err.message
    // What the page showed, to tell a UI failure from a load failure.
    result.page = await js("(document.body && document.body.innerText || '').slice(0, 600) + ' | url=' + location.href").catch((e) => 'unreadable: ' + e.message)
    result.cells = await js("[...document.querySelectorAll('.cell')].filter((c) => c.textContent).map((c) => c.style.top + '/' + c.style.left + '=' + c.textContent)").catch(() => null)
  }
  console.log('SMOKE_RESULT ' + JSON.stringify(result))
  app.quit()
}

module.exports = { run }
