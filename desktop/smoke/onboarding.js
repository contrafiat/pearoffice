// Smoke test part "onboarding": the first-run welcome, your name and the
// tour (src/ui/Onboarding.jsx). The only part that starts with onboarding
// not done (launch.js sets PEAROFFICE_NO_ONBOARDING for the others).
// PEAROFFICE_SMOKE_ONBOARDING_SHOTS=<folder> saves every step in light and
// dark, and a few in the phone layout.

const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')

const TITLES = ['No account needed', 'Share with a link', 'Changes go device to device', 'Seeders keep files moving', 'Use all your devices', 'Keep your recovery phrase', 'You are all set']

module.exports = async function onboarding (t) {
  const { js, wc, step, waitFor, type, sleep, openSettings, result, key } = t
  const shots = process.env.PEAROFFICE_SMOKE_ONBOARDING_SHOTS || ''
  if (shots) fs.mkdirSync(shots, { recursive: true })
  const title = () => js("(document.querySelector('.ob-card .ob-title') || {}).textContent || ''")
  const waitTitle = (want) => waitFor('card ' + want, "(document.querySelector('.ob-card .ob-title') || {}).textContent === " + JSON.stringify(want), 5000)
  const click = (sel) => js('document.querySelector(' + JSON.stringify(sel) + ').click(); true')
  const ask = (method, args = {}) => js('window.pearoffice.call(' + JSON.stringify(method) + ', ' + JSON.stringify(args) + ')')

  // Light, then dark, of whatever is on screen.
  async function snap (name) {
    if (!shots) return
    await sleep(350)
    const was = await js('document.documentElement.dataset.theme || ""')
    for (const theme of ['light', 'dark']) {
      await js('document.documentElement.dataset.theme = ' + JSON.stringify(theme) + '; true')
      await sleep(300)
      fs.writeFileSync(path.join(shots, 'desktop-' + name + '-' + theme + '.png'), (await wc.capturePage()).toPNG())
    }
    await js(was ? 'document.documentElement.dataset.theme = ' + JSON.stringify(was) + '; true' : 'delete document.documentElement.dataset.theme; true')
  }

  async function reload () {
    await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload() })
    await waitFor('ui after reload', "!!document.querySelector('.new-sheet') && !document.querySelector('.sheet-list .muted')?.textContent.includes('Starting')")
    // Let the page's own app:onboarding call answer.
    await ask('app:onboarding')
    await sleep(400)
  }
  const shown = () => js("!!document.querySelector('.ob-backdrop:not(.hidden)')")

  // A fresh device shows the welcome.
  await waitFor('welcome', "(document.querySelector('.ob-card .ob-title') || {}).textContent === 'Welcome to PearOffice'")
  result.freshNotDone = (await ask('app:onboarding')).done === false
  result.noNudge = await js("!document.querySelector('.main .banner')")
  step('welcome on a fresh start')

  // Once shown, a file made outside the tour does not skip it (devices
  // already in use before onboarding are covered by test/onboarding.test.js).
  const { sheetId } = await ask('sheet:create', { title: 'Old file' })
  await reload()
  await waitTitle('Welcome to PearOffice')
  result.startedStays = (await ask('app:onboarding')).done === false
  await ask('sheet:removeLocal', { sheetId })
  await reload()
  await waitTitle('Welcome to PearOffice')
  step('a started tour comes back')

  await snap('1-welcome')
  if (shots) await phoneShots(t, shots)

  // Your name.
  await click('.ob-start')
  await waitTitle('What should we call you?')
  result.continueOff = await js("document.querySelector('.ob-name-form button[type=submit]').disabled")
  await waitFor('name focused', "document.activeElement === document.querySelector('.ob-name')", 3000)
  await type('Ada Lovelace', 20)
  await snap('2-name')
  await click('.ob-name-form button[type=submit]')
  await waitTitle(TITLES[0])
  result.name = (await ask('app:me')).name
  step('name set')

  // Every card with Next, a Back in the middle.
  const seen = []
  for (let i = 0; i < TITLES.length; i++) {
    await waitTitle(TITLES[i])
    seen.push(await title())
    await snap('3-card-' + (i + 1))
    if (i === 2) {
      await click('.ob-back')
      await waitTitle(TITLES[1])
      await click('.ob-next')
      await waitTitle(TITLES[2])
    }
    if (i < TITLES.length - 2) await click('.ob-next')
    else if (i === TITLES.length - 2) {
      result.laterLabel = await js("document.querySelector('.ob-next').textContent.trim()")
      // Show my phrase opens the 24 words over the tour.
      await click('.ob-show-phrase')
      await waitFor('recovery phrase', "document.querySelectorAll('.phrase li').length === 24 && !!document.querySelector('.ob-backdrop.hidden')")
      result.phrase = true
      await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Done').click()")
      await waitFor('phrase closed', "!document.querySelector('.phrase') && !!document.querySelector('.ob-backdrop:not(.hidden)')")
    }
  }
  result.titles = seen.join(' | ') === TITLES.join(' | ')
  result.dots = await js("document.querySelectorAll('.ob-dots li').length")
  step('cards')

  // New file finishes it and opens New.
  await click('.ob-new')
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-sheet') && !document.querySelector('.ob-backdrop')")
  await click('.kind-choice.kind-sheet')
  await waitFor('grid', "!!document.querySelector('.grid .body')")
  result.doneAfter = (await ask('app:onboarding')).done === true
  step('finished with New file')

  await reload()
  result.notAgain = !(await shown())
  step('not shown after reload')

  // Settings, Take the tour: the cards only, and Skip closes.
  await openSettings()
  await click('.settings-tour')
  await waitTitle(TITLES[0])
  result.tourNoName = await js("!document.querySelector('.ob-name')")
  result.backOff = await js("document.querySelector('.ob-back').disabled")
  await click('.ob-next')
  await waitTitle(TITLES[1])
  await click('.ob-skip')
  await waitFor('tour closed', "!document.querySelector('.ob-backdrop')", 3000)
  step('settings tour and skip')

  // About, How it works, Take the tour; Escape closes.
  await openSettings()
  await click('.panel .about-link')
  await js("[...document.querySelectorAll('.about-toggle')].find((b) => b.textContent.trim() === 'How it works').click()")
  await waitFor('about tour button', "!!document.querySelector('.about-tour')", 3000)
  await click('.about-tour')
  await waitTitle(TITLES[0])
  await key('Escape')
  await waitFor('tour closed by Escape', "!document.querySelector('.ob-backdrop')", 3000)
  step('about tour and escape')

  return result.freshNotDone && result.noNudge && result.startedStays && result.continueOff && result.name === 'Ada Lovelace' &&
    result.titles && result.dots === 7 && result.laterLabel === 'Later' && result.phrase && result.doneAfter && result.notAgain && result.tourNoName && result.backOff
}

// The phone layout (a 390 x 844 window whose bridge says mobile) at the
// welcome, the name and a few cards. Uses no button that saves anything.
async function phoneShots (t, shots) {
  const { wc, sleep } = t
  const phone = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { preload: path.join(__dirname, 'phone-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true } })
  try {
    const pjs = (code) => phone.webContents.executeJavaScript(code, true)
    const pwait = async (label, code) => {
      for (let i = 0; i < 100; i++) { if (await pjs(code).catch(() => false)) return; await sleep(100) }
      throw new Error('phone: timed out waiting for ' + label)
    }
    const pshot = async (name, theme = 'light') => {
      await pjs('document.documentElement.dataset.theme = ' + JSON.stringify(theme) + '; true')
      await sleep(400)
      fs.writeFileSync(path.join(shots, 'phone-' + name + '-' + theme + '.png'), (await phone.webContents.capturePage()).toPNG())
    }
    const title = (want) => pwait(want, "(document.querySelector('.ob-card .ob-title') || {}).textContent === " + JSON.stringify(want))
    await phone.loadURL(wc.getURL())
    await title('Welcome to PearOffice')
    await pshot('1-welcome')
    await pjs("document.querySelector('.ob-start').click(); true")
    await title('What should we call you?')
    await pshot('2-name')
    await pjs("document.querySelector('.ob-later').click(); true")
    await title(TITLES[0])
    await pshot('3-card-1')
    await pjs("document.querySelector('.ob-next').click(); true")
    await title(TITLES[1])
    await pshot('3-card-2')
    await pshot('3-card-2', 'dark')
    for (let i = 2; i <= 3; i++) { await pjs("document.querySelector('.ob-next').click(); true"); await title(TITLES[i]) }
    await pshot('3-card-4')
    for (let i = 4; i <= 6; i++) { await pjs("document.querySelector('.ob-next').click(); true"); await title(TITLES[i]) }
    await pshot('3-card-7')
    await pshot('3-card-7', 'dark')
  } finally {
    phone.destroy()
  }
}
