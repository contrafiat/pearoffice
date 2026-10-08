// Smoke test part "app": the shell around the editors. The New picker,
// theme, Seeder and Devices panels, the local seeder, keep online and start
// at login, profile picture, About, sharing, backups, removing a file and
// the file list.

const fs = require('node:fs')
const path = require('node:path')

module.exports = async function app (t) {
  const { js, step, waitFor, openSettings, win, getTray, dataDir, result, sleep } = t

  // The About button sits level with the Settings gear.
  result.aboutLevel = await js("(() => { const c = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }; return Math.round((c(document.querySelector('.me-bar .about-button svg')) - c(document.querySelector('.me-row .gear'))) * 10) / 10 })()")
  // The empty screen's start buttons (PEAROFFICE_SMOKE_EMPTY_SHOT=<file>).
  await t.shot('PEAROFFICE_SMOKE_EMPTY_SHOT')
  result.startButtonSizes = await js("[...document.querySelectorAll('.empty-actions > *')].map((b) => { const r = b.getBoundingClientRect(); return b.tagName + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) }).join(', ')")
  result.startButtonsEqual = await js("(() => { const w = [...document.querySelectorAll('.empty-actions > *')].map((b) => Math.round(b.getBoundingClientRect().width)); const h = [...document.querySelectorAll('.empty-actions > *')].map((b) => Math.round(b.getBoundingClientRect().height)); return w.length === 3 && Math.max(...w) - Math.min(...w) <= 1 && Math.max(...h) - Math.min(...h) <= 1 })()")
  // New asks the kind: spreadsheet, document or slides.
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "document.querySelectorAll('.kind-choice').length === 3")
  await t.shot('PEAROFFICE_SMOKE_NEW_SHOT')
  result.kinds = await js("[...document.querySelectorAll('.kind-choice')].map((b) => b.querySelector('.kind-label').textContent + (b.disabled ? ' (soon)' : '')).join(', ')")
  await js("document.querySelector('.panel .close').click()")
  await waitFor('new picker closed', "!document.querySelector('.kind-choice')")
  // Two sheets: removing one later leaves the other in the file list.
  await t.newSheet()
  await t.newSheet()
  step('two sheets created')

  // With a file worth recovering, a dot on Settings (and on Devices inside
  // it) asks for the phrase to be written down, until it is shown below.
  // PEAROFFICE_SMOKE_NUDGE_SHOT=<file> saves the side menu and Settings.
  await waitFor('reminder dot', "!!document.querySelector('.me-row .nudge-dot')")
  await js("document.documentElement.dataset.theme = 'light'")
  await t.shot('PEAROFFICE_SMOKE_NUDGE_SHOT', 300)
  await openSettings()
  await waitFor('reminder in settings', "!!document.querySelector('.panel .settings-devices .nudge-dot')")
  if (process.env.PEAROFFICE_SMOKE_NUDGE_SHOT) {
    process.env.PEAROFFICE_SMOKE_NUDGE_SETTINGS_SHOT = process.env.PEAROFFICE_SMOKE_NUDGE_SHOT.replace(/(\.png)?$/, '-settings.png')
    await t.shot('PEAROFFICE_SMOKE_NUDGE_SETTINGS_SHOT', 300)
  }
  await js("delete document.documentElement.dataset.theme")
  await js("document.querySelector('.panel .close').click()")
  result.nudgeShown = true
  step('phrase reminder dot')

  // The theme setting.
  await openSettings()
  await js("[...document.querySelectorAll('.theme-choice button')].find((b) => b.textContent.trim() === 'Dark').click()")
  await waitFor('dark theme', "document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() === '#171a17'")
  await js("[...document.querySelectorAll('.theme-choice button')].find((b) => b.textContent.trim() === 'System').click()")
  await waitFor('system theme', '!document.documentElement.dataset.theme')
  await js("document.querySelector('.panel .close').click()")
  result.theme = true
  step('theme')

  // Connect anywhere (the relay fallback): on by default, off kept after
  // reopening Settings, then on again.
  await openSettings()
  await waitFor('relay switch on', "!!document.querySelector('.panel .connect-anywhere input:checked')")
  await js("document.querySelector('.panel .connect-anywhere input').click()")
  await waitFor('relay off saved', "(async () => (await window.pearoffice.call('app:relay')).useRelay === false)()")
  await js("document.querySelector('.panel .close').click()")
  await openSettings()
  await waitFor('relay switch still off', "!!document.querySelector('.panel .connect-anywhere input:not(:checked)')")
  await js("document.querySelector('.panel .connect-anywhere input').click()")
  await waitFor('relay on again', "(async () => (await window.pearoffice.call('app:relay')).useRelay === true)()")
  await js("document.querySelector('.panel .close').click()")
  result.relaySwitch = true
  step('connect anywhere')

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
  await waitFor('device link', "(document.querySelector('.panel input') || {}).value?.startsWith('pearoffice://link?')")
  await js("document.querySelector('.panel .close').click()")
  await openSettings()
  await js("document.querySelector('.panel .settings-devices').click()")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Show phrase').click()")
  await waitFor('recovery phrase', "document.querySelectorAll('.phrase li').length === 12")
  await js("document.querySelector('.panel .close').click()")
  await waitFor('reminder dot gone', "!document.querySelector('.me-row .nudge-dot')")
  result.nudgeGone = true
  // Linking on a device that has files: it says what would be removed and
  // which files only it has, and Back goes back (nothing is removed).
  await openSettings()
  await js("document.querySelector('.panel .settings-devices').click()")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'This is the new device').click()")
  await waitFor('link field', "!!document.querySelector('.panel input[aria-label=\"Device link\"]')")
  await js("(() => { const i = document.querySelector('.panel input[aria-label=\"Device link\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'pearoffice://link?rv=' + 'A'.repeat(43) + '&k=' + 'B'.repeat(43) + '&a=' + 'c'.repeat(64) + '&v=1'); i.dispatchEvent(new Event('input', { bubbles: true })) })()")
  await js("document.querySelector('.panel form button[type=submit]').click()")
  await waitFor('replace screen', "!!document.querySelector('.replace-files')")
  await t.shot('PEAROFFICE_SMOKE_REPLACE_SHOT')
  result.replaceScreen = await js("(() => { const r = document.querySelector('.replace-files'); return r.textContent.includes('already has files') && r.querySelectorAll('.warn li').length === 2 && !!r.querySelector('button.danger') })()")
  await js("[...document.querySelectorAll('.replace-files button')].find((b) => b.textContent.trim() === 'Back').click()")
  await waitFor('back at the link field', "!!document.querySelector('.panel input[aria-label=\"Device link\"]')")
  await js("document.querySelector('.panel .close').click()")
  // Linked devices (proposals/2026-10-07-device-names.md): this device, named
  // from its platform, renamed in place; Esc cancels, Enter saves.
  await openSettings()
  await js("document.querySelector('.panel .settings-devices').click()")
  const defaultName = { linux: 'Linux computer', win32: 'Windows computer', darwin: 'Mac' }[process.platform] || 'Computer'
  const rowText = "[...document.querySelectorAll('.linked-devices .device-row')].map((r) => r.querySelector('.device-name')?.textContent + '|' + (r.querySelector('.device-status')?.textContent || '')).join(',')"
  await waitFor('this device listed', rowText + " === '" + defaultName + "|This device' && document.querySelector('.linked-devices').textContent.includes('Link another device to see it here.')")
  await js("document.querySelector('.device-row .icon-button').click()")
  await waitFor('rename field', "document.activeElement === document.querySelector('.device-row input')")
  await t.type('Nope', 10)
  await t.key('Escape')
  await waitFor('Esc cancels', rowText + " === '" + defaultName + "|This device'")
  await js("document.querySelector('.device-row .icon-button').click()")
  await waitFor('rename field again', "document.activeElement === document.querySelector('.device-row input') && document.querySelector('.device-row input').placeholder === 'e.g. Work laptop'")
  await t.type('Work laptop', 10)
  await t.shot('PEAROFFICE_SMOKE_DEVICE_RENAME_SHOT')
  await t.key('Enter')
  await waitFor('renamed', rowText + " === 'Work laptop|This device'")
  await js("document.querySelector('.panel .close').click()")
  await openSettings()
  await js("document.querySelector('.panel .settings-devices').click()")
  await waitFor('name kept after reopening', rowText + " === 'Work laptop|This device'")
  await js("document.querySelector('.panel .close').click()")
  // And after the window reloads (the name comes from the worklet).
  win.webContents.reload()
  await waitFor('reloaded', "!!document.querySelector('.me-row .gear')", 20000)
  await openSettings()
  await js("document.querySelector('.panel .settings-devices').click()")
  await waitFor('name kept after a reload', rowText + " === 'Work laptop|This device'")
  result.linkedDevices = await js(rowText)
  await devicesShot(t)
  // The reload closed the open sheet: open one again for the steps below.
  await js("document.querySelector('.panel .close').click()")
  await waitFor('file list back', "!!document.querySelector('.sheet-link:not(.all-files)')")
  await js("document.querySelector('.sheet-link:not(.all-files)').click()")
  await waitFor('sheet open again', "!!document.querySelector('.grid .body') && !!document.querySelector('.toolbar .share')")
  step('seeder and devices panels')

  // Run a seeder on this computer, pair this device with it, show its QR.
  await openSettings()
  await js("document.querySelector('.panel .settings-seeder').click()")
  await waitFor('local seeder switch', "[...document.querySelectorAll('.panel label')].some((l) => l.textContent.includes('Run this computer as a seeder'))")
  // How long each stage takes, in ms (first connections were slow on Windows).
  const seederMs = {}
  let t0 = Date.now()
  await js("[...document.querySelectorAll('.panel label')].find((l) => l.textContent.includes('Run this computer as a seeder')).querySelector('input').click()")
  await waitFor('local seeder running', "document.querySelector('.panel').textContent.includes('Holding')", 60000)
  seederMs.start = Date.now() - t0
  t0 = Date.now()
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Pair this device with it').click()")
  await waitFor('paired with the local seeder', "document.querySelector('.panel').textContent.includes('Paired. Your files are backing up.')", 60000)
  seederMs.pair = Date.now() - t0
  await t.shot('PEAROFFICE_SMOKE_SEEDER_SHOT', 300)
  t0 = Date.now()
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Show pairing code').click()")
  await waitFor('pairing QR', "!!document.querySelector('.pairing .qr svg')")
  await waitFor('seeder holds the sheets', "/Holding [1-9]/.test(document.querySelector('.panel').textContent)", 30000)
  seederMs.hold = Date.now() - t0
  await js("document.querySelector('.panel .close').click()")
  step('local seeder: running, paired, QR, holding sheets')
  result.timings = { 'seeder start': seederMs.start, 'seeder pair': seederMs.pair, 'seeder hold': seederMs.hold }

  // Keep sheets online: closing the window hides it, the app keeps running.
  await openSettings()
  await js("document.querySelector('.panel .keep-online input').click()")
  await waitFor('setting on', "document.querySelector('.keep-online input').checked")
  await waitFor('start at login shown', "!!document.querySelector('.start-at-login input')")
  await js("document.querySelector('.start-at-login input').click()")
  await waitFor('start at login on', "document.querySelector('.start-at-login input').checked")
  await js("document.querySelector('.panel .close').click()")
  if (process.platform === 'linux') {
    const entry = fs.readFileSync(path.join(dataDir, 'autostart', 'pearoffice.desktop'), 'utf8')
    result.autostart = /^Exec=.* "--hidden"$/m.test(entry)
  } else if (process.platform === 'darwin') {
    const agent = fs.readFileSync(path.join(dataDir, 'autostart', 'com.peerloom.pearoffice.login.plist'), 'utf8')
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
  await js("document.querySelector('.sidebar .about-button').click()")
  await waitFor('about', "document.querySelector('.panel').textContent.includes('Open-source software') && /Version \\d/.test(document.querySelector('.panel').textContent)")
  // Support development opens the Bitcoin sheet; back returns to About.
  await js("[...document.querySelectorAll('.about-toggle')].find((b) => b.textContent.trim() === 'Support development').click()")
  await waitFor('support', "!!document.querySelector('.donate-btc')")
  await t.shot('PEAROFFICE_SMOKE_ABOUT_SHOT', 300)
  await js("document.querySelector('.donate-btc').click()")
  await waitFor('bitcoin sheet', "document.querySelector('.panel h2').textContent === 'Bitcoin Lightning' && document.querySelector('.copy-field code').textContent === 'peerloomllc@strike.me' && document.querySelectorAll('.wallet').length === 4")
  await t.shot('PEAROFFICE_SMOKE_BTC_SHOT')
  await js("document.querySelector('.panel .back').click()")
  await waitFor('back to about', "document.querySelector('.panel h2').textContent === 'About PearOffice'")
  result.about = true
  // The donation reminder's check reaches the worklet (it once did not).
  result.donation = await js("window.pearoffice.call('donation:status').then((r) => r && r.due === false)")
  await js("document.querySelector('.panel .close').click()")
  await waitFor('owner picture in the sheet list', "!!document.querySelector('.sheet-link .sheet-owner img.avatar')")
  step('profile picture')

  // Share: the owner gets a single-use invite link.
  await js("document.querySelector('.toolbar .share').click()")
  await waitFor('share panel', "!!document.querySelector('.panel .invite-actions')")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Invite to edit').click()")
  await waitFor('invite link', "(document.querySelector('.invite-link input') || {}).value?.startsWith('pearoffice://join?')")
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
  result.sheetsBefore = await js("document.querySelectorAll('.sheet-link:not(.all-files)').length")
  await js("document.querySelector('.toolbar .more-button').click()")
  await waitFor('more menu', "[...document.querySelectorAll('.more-menu li')].some((l) => l.textContent.trim() === 'Delete for everyone')")
  await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent.trim() === 'Remove from this device').click()")
  await waitFor('confirm', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Remove')")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Remove').click()")
  await waitFor('sheet removed', "!document.querySelector('.panel') && document.querySelectorAll('.sheet-link:not(.all-files)').length === " + (result.sheetsBefore - 1), 30000)
  result.sheetsAfter = await js("document.querySelectorAll('.sheet-link:not(.all-files)').length")
  step('removed from this device')

  // With nothing open, the start screen lists every file with its kind.
  await waitFor('file list', "!!document.querySelector('.files-home') && document.querySelectorAll('.file-card').length === " + result.sheetsAfter)
  await t.shot('PEAROFFICE_SMOKE_HOME_SHOT', 300)
  result.fileIcons = await js("document.querySelectorAll('.file-card .kind-icon.kind-sheet').length")
  await js("document.querySelector('.file-card').click()")
  await waitFor('opened from the list', "!!document.querySelector('.grid .body')")
  step('file list')

  return Math.abs(result.aboutLevel) <= 0.5 && result.startButtonsEqual && result.nudgeShown && result.nudgeGone && result.relaySwitch && result.replaceScreen && result.about && result.donation && result.kinds === 'Spreadsheet, Document, Slides' && result.fileIcons === result.sheetsAfter && result.keepOnline && result.avatar && result.autostart && result.backups && result.sheetsAfter === result.sheetsBefore - 1 && result.inviteLink.startsWith('pearoffice://join?s=')
}

// Screenshots of the Linked devices list with a second device, light and dark
// (PEAROFFICE_SMOKE_DEVICES_SHOT=<file>, -dark added for the second). Only
// for pictures: a made-up phone is added to what app:devices returns.
async function devicesShot (t) {
  const file = process.env.PEAROFFICE_SMOKE_DEVICES_SHOT
  if (!file) return
  const { ipcMain } = require('electron')
  const handlers = ipcMain._invokeHandlers
  const real = handlers && handlers.get('worklet:call')
  if (!real) return
  handlers.set('worklet:call', async (e, method, args) => {
    const out = await real(e, method, args)
    if (method !== 'app:devices') return out
    return [...out, { deviceKey: 'f'.repeat(64), name: 'Pixel 9', kind: 'phone', thisDevice: false, online: false, lastSeen: Date.now() - 3 * 3600 * 1000, files: 2 }]
  })
  try {
    await t.js("document.querySelector('.panel .close').click()")
    await t.openSettings()
    await t.js("document.querySelector('.panel .settings-devices').click()")
    await t.waitFor('two devices', "document.querySelectorAll('.linked-devices .device-row').length === 2")
    await t.js("document.documentElement.dataset.theme = 'light'")
    await t.shot('PEAROFFICE_SMOKE_DEVICES_SHOT', 300)
    await t.js("document.documentElement.dataset.theme = 'dark'")
    process.env.PEAROFFICE_SMOKE_DEVICES_SHOT_DARK = file.replace(/(\.png)?$/, '-dark.png')
    await t.shot('PEAROFFICE_SMOKE_DEVICES_SHOT_DARK', 300)
    await t.js("delete document.documentElement.dataset.theme")
  } finally {
    handlers.set('worklet:call', real)
  }
}
