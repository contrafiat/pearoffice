// Smoke test part "windows": files in windows of their own
// (proposals/2026-10-26-file-windows.md). Open in new window from a card's
// menu and from an open file's menu, the main window bringing that window
// forward instead of opening the file, edits reaching both, a folder link
// from a file window opening in the main window, closing one, and a restart
// reopening the rest where they were (one moved back on screen).
// PEAROFFICE_SMOKE_WINDOWS_SHOT=<png> saves the file window.

const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')

module.exports = async function windows (t) {
  const { js, step, waitFor, result, sleep, dataDir, win } = t
  const ask = (method, args = {}) => js('window.pearoffice.call(' + JSON.stringify(method) + ', ' + JSON.stringify(args) + ')')
  const others = () => BrowserWindow.getAllWindows().filter((w) => w !== win && !w.isDestroyed() && /[?&]file=/.test(w.webContents.getURL()))
  const windowFor = (id) => others().find((w) => new URL(w.webContents.getURL()).searchParams.get('file') === id)
  const inWin = (w, code) => w.webContents.executeJavaScript(code)
  const waitIn = async (label, w, code, ms = 10000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (w && !w.isDestroyed() && !w.webContents.isLoading() && await inWin(w, code).catch(() => false)) return
      await sleep(100)
    }
    throw new Error('timed out waiting for ' + label)
  }
  const until = async (label, test, ms = 10000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await test()) return; await sleep(100) }
    throw new Error('timed out waiting for ' + label)
  }
  const saved = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'windows.json'), 'utf8')).map((x) => x.sheetId) } catch { return [] } }
  const card = (title) => `[...document.querySelectorAll('.file-cell')].find((c) => c.querySelector('.file-title').textContent === ${JSON.stringify(title)})`

  const budget = (await ask('sheet:create', { title: 'Budget' })).sheetId
  const notes = (await ask('doc:create', { title: 'Notes' })).sheetId
  await ask('file:newFolder', { name: 'Work' })
  await waitFor('cards', `!!${card('Budget')} && !!${card('Notes')}`)

  // From a card's menu.
  await js(`(() => { const c = ${card('Budget')}; const b = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 20 })) })()`)
  await waitFor('Open in new window', "!!document.querySelector('.card-menu .open-window')")
  await js("document.querySelector('.card-menu .open-window').click()")
  await until('Budget window', async () => !!windowFor(budget))
  const bw = windowFor(budget)
  await waitIn('Budget grid in its window', bw, "!!document.querySelector('.grid') && document.title === 'Budget' && !document.querySelector('.sidebar')")
  if (process.env.PEAROFFICE_SMOKE_WINDOWS_SHOT) { await sleep(300); fs.writeFileSync(process.env.PEAROFFICE_SMOKE_WINDOWS_SHOT, (await bw.webContents.capturePage()).toPNG()) }
  result.opened = true
  step('opened from a card')

  // The main window brings it forward instead of opening it.
  await js(`${card('Budget')}.querySelector('.file-card').click()`)
  await sleep(300)
  if (await js("!!document.querySelector('.grid')")) throw new Error('the main window opened a file that has its own window')
  // An edit in the window reaches the main window.
  await inWin(bw, `window.pearoffice.call('file:setTitle', { sheetId: ${JSON.stringify(budget)}, title: 'Budget 2027' })`)
  await waitFor('main sees the rename', `!!${card('Budget 2027')}`)
  await waitIn('window title follows', bw, "document.title === 'Budget 2027'")
  result.shared = true
  step('main brings it forward, edits reach both')

  // A folder link from the file window opens in the main window.
  const work = (await ask('file:folders')).folders.find((f) => f.name === 'Work').id
  await inWin(bw, `window.pearoffice.call('app:openInMain', { folderId: ${JSON.stringify(work)} })`)
  await waitFor('folder in main', "!!document.querySelector('.in-folder .folder-head h1') && document.querySelector('.in-folder .folder-head h1').textContent.includes('Work')")
  result.folder = true
  step('folder link opens in the main window')

  // From an open file's menu: the main window goes back to the list.
  await js("[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes('Notes')).click()")
  await waitFor('Notes open here', "!!document.querySelector('.doc-body')")
  await js("document.querySelector('.more-button').click()")
  await waitFor('file menu', "!!document.querySelector('.more-menu .open-window')")
  await js("document.querySelector('.more-menu .open-window').click()")
  await until('Notes window', async () => !!windowFor(notes))
  await waitFor('main left Notes', "!document.querySelector('.doc-body')")
  await waitIn('Notes in its window', windowFor(notes), "!!document.querySelector('.doc-body') && !document.querySelector('.more-menu .open-window')")
  await until('both saved', async () => saved().length === 2)
  result.fromMenu = true
  step('opened from the file menu')

  // Closing a window forgets it; a restart reopens the rest, on screen.
  const before = bw.getBounds()
  windowFor(notes).close()
  await until('Notes forgotten', async () => !windowFor(notes) && saved().join() === budget)
  await ask('app:smokeReopenWindows', { offScreen: false })
  await until('Budget back', async () => !!windowFor(budget) && !windowFor(notes))
  const again = windowFor(budget).getBounds()
  if (Math.abs(again.x - before.x) > 2 || Math.abs(again.y - before.y) > 2 || Math.abs(again.width - before.width) > 2) throw new Error('not where it was: ' + JSON.stringify({ before, again }))
  await waitIn('Budget grid again', windowFor(budget), "!!document.querySelector('.grid')")
  await ask('app:smokeReopenWindows', { offScreen: true })
  await until('Budget back on screen', async () => { const w = windowFor(budget); return !!w && w.getBounds().x > -10000 })
  result.restart = true
  step('closing and restarting')

  return result.opened && result.shared && result.folder && result.fromMenu && result.restart
}
