// Smoke test part "onboarding-restore": "I already use PearOffice", then a
// restore from the recovery phrase all the way through the restart
// (src/ui/Onboarding.jsx, src/ui/takeIdentity.js). Its own launch, since the
// restore ends onboarding. It restores this device's own phrase: a fresh
// device has no files, so the restore runs as it would with any other.
// PEAROFFICE_SMOKE_ONBOARDING_SHOTS=<folder> saves the welcome back note.

const fs = require('node:fs')
const path = require('node:path')

module.exports = async function onboardingRestore (t) {
  const { js, wc, step, waitFor, sleep, result } = t
  const shots = process.env.PEAROFFICE_SMOKE_ONBOARDING_SHOTS || ''
  const waitTitle = (want) => waitFor('card ' + want, "(document.querySelector('.ob-card .ob-title') || {}).textContent === " + JSON.stringify(want), 5000)
  const click = (sel) => js('document.querySelector(' + JSON.stringify(sel) + ').click(); true')
  const ask = (method, args = {}) => js('window.pearoffice.call(' + JSON.stringify(method) + ', ' + JSON.stringify(args) + ')')

  await waitTitle('Welcome to PearOffice')
  const before = await ask('app:me')
  const { phrase } = await ask('link:phrase')
  result.noNoteYet = (await ask('app:welcomeBack')).show === false
  step('welcome')

  await click('.ob-have')
  await waitTitle('Welcome back')
  await click('.ob-choice-restore')
  await waitTitle('Restore from my recovery phrase')
  await waitFor('phrase focused', "document.activeElement === document.querySelector('.ob-phrase')", 3000)
  // As someone might type it: capitals, new lines and extra spaces.
  const words = phrase.split(' ')
  await wc.insertText('  ' + words.slice(0, 12).join(' ').toUpperCase() + '\n' + words.slice(12).join('  ') + '\n')
  result.wordCount = await js("document.querySelector('.ob-count').textContent")
  // The restart reloads the page; the note shows once it is back.
  await js("document.querySelector('.ob-restore-form button[type=submit]').click(); window.__beforeRestart = true; true")
  await waitFor('restarted with the note', "!window.__beforeRestart && !!document.querySelector('.banner.welcome-back') && !document.querySelector('.ob-backdrop')", 30000)
  result.note = await js("document.querySelector('.banner.welcome-back').textContent.replace(/\\s*OK$/, '')")
  result.onboarded = (await ask('app:onboarding')).done === true
  result.sameIdentity = (await ask('app:me')).identity === before.identity
  result.noteFlag = (await ask('app:welcomeBack')).show === true
  step('restored and restarted')

  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await js("document.documentElement.dataset.theme = 'light'; true")
    await sleep(400)
    fs.writeFileSync(path.join(shots, 'desktop-8-welcome-back-light.png'), (await wc.capturePage()).toPNG())
  }

  await js("[...document.querySelectorAll('.banner.welcome-back button')].find((b) => b.textContent === 'OK').click(); true")
  await waitFor('note gone', "!document.querySelector('.banner.welcome-back')", 3000)
  // The flag is cleared in the background; give it a moment.
  for (let i = 0; i < 30 && !result.noteCleared; i++) {
    result.noteCleared = (await ask('app:welcomeBack')).show === false
    if (!result.noteCleared) await sleep(100)
  }
  step('note dismissed')

  return result.noNoteYet && result.wordCount === '24 words of 24' && result.onboarded && result.sameIdentity && result.noteFlag && result.noteCleared &&
    result.note === 'Welcome back. Ask the owners of your files to invite you again; you will be back as yourself.'
}
