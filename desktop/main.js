// PearOffice desktop: Electron main process. Starts the shared Bare worklet
// (the same bundle the phones will run), opens the window and relays calls and
// events between the UI and the worklet. See proposal section 9.

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, dialog, nativeImage, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { Worklet } = require('./worklet')
const { SeederProcess } = require('./seeder-process')
const { resolvePaths } = require('./paths')
const { createLoginItem } = require('./login')
const { startUpdates } = require('./updates')
const { installMenuEntry } = require('./appimage')

const SMOKE = !!process.env.PEAROFFICE_SMOKE

// The smoke test keeps the page's storage (zoom, theme) in its throwaway
// folder too, so one run cannot leave settings for the next.
if (SMOKE && process.env.PEAROFFICE_DATA) app.setPath('userData', path.join(process.env.PEAROFFICE_DATA, 'electron'))

// One running copy per data folder: the worklet holds a lock on its store.
if (!SMOKE && !app.requestSingleInstanceLock()) app.exit(0)

// pearoffice:// invite links open the app. Registration only makes sense for an
// installed copy; a dev checkout still handles links passed on the command line.
// An AppImage first adds its own menu entry, which the link handler and the
// taskbar icon both need.
const ICON = path.join(__dirname, 'build', 'icon.png')
if (!SMOKE && process.platform === 'linux' && process.env.APPIMAGE) {
  try { installMenuEntry({ appImage: process.env.APPIMAGE, image: nativeImage.createFromPath(ICON) }) } catch (err) { console.error('[pearoffice] menu entry', err.message) }
}
if (app.isPackaged) app.setAsDefaultProtocolClient('pearoffice')

let pendingLink = linkIn(process.argv)

function linkIn (argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.startsWith('pearoffice://')) || null
}

function sendLink (url) {
  if (!url) return
  pendingLink = url
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('worklet:event', { name: 'app:deeplink', data: { url } })
}

const paths = resolvePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
const dataDir = process.env.PEAROFFICE_DATA || path.join(app.getPath('userData'), 'data')

let win = null
let worklet = null
let quitting = false
let tray = null
// A smoke run must not touch the real login items.
const loginItem = createLoginItem({ app, autostartDir: SMOKE ? path.join(dataDir, 'autostart') : null, fake: SMOKE })

// Desktop-only settings, kept next to the data (not in the sheets).
const settingsFile = path.join(dataDir, 'desktop-settings.json')
const DEFAULTS = { keepOnline: false, runSeeder: false, startAtLogin: false }
function readSettings () {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) } } catch { return { ...DEFAULTS } }
}
// The tray (and hide-on-close) is on while either keeps the app running.
const stayRunning = () => settings.keepOnline || settings.runSeeder
let settings = readSettings()
// Make the system's login entry match the setting. Runs on every start too,
// so a reinstalled or moved app points the entry at itself again.
function syncLoginItem () {
  // Starting at login only makes sense while PearOffice stays running.
  if (!stayRunning()) settings.startAtLogin = false
  try {
    if (settings.startAtLogin) loginItem.setEnabled(true)
    else if (loginItem.isEnabled()) loginItem.setEnabled(false)
  } catch (err) {
    log('login item failed:', err.message)
    settings.startAtLogin = loginItem.isEnabled()
  }
}
function writeSettings (patch) {
  settings = { ...settings, ...patch }
  syncLoginItem()
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
  if (stayRunning()) createTray()
  else if (tray) { tray.destroy(); tray = null }
  if (settings.runSeeder) startSeeder().catch((err) => log('seeder failed to start:', err.message))
  else stopSeeder()
}

// "Run a seeder on this computer": the blind seeder as its own process.
let seeder = null
function startSeeder () {
  if (seeder && seeder.running) return Promise.resolve()
  seeder = new SeederProcess({
    barePath: paths.bare,
    bundlePath: paths.seeder,
    dataDir: path.join(dataDir, 'seeder'),
    onLog: (kind, text) => log(kind, text)
  })
  return seeder.start()
}
function stopSeeder () {
  if (seeder) { const s = seeder; seeder = null; return s.stop() }
}

function showWindow () {
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
}

// "Keep my sheets online" (proposal section 8): with it on, closing the
// window hides it and PearOffice keeps syncing from the tray.
function createTray () {
  if (tray && !tray.isDestroyed()) return
  try {
    tray = new Tray(ICON)
  } catch (err) {
    log('tray failed:', err.message)
    return
  }
  tray.setToolTip('PearOffice is running')
  setTrayMenu()
  tray.on('click', showWindow)
}

// "Update to 0.2.0" appears when a newer release is out.
function setTrayMenu () {
  if (!tray || tray.isDestroyed()) return
  const u = updates && updates.state().update
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open PearOffice', click: showWindow },
    ...(u && u.available ? [{ label: 'Update to ' + u.latest, click: () => { updates.apply(); showWindow() } }] : []),
    { type: 'separator' },
    { label: 'Quit PearOffice', click: () => app.quit() }
  ]))
}

let updates = null

function log (...args) {
  if (!app.isPackaged || SMOKE || process.env.PEAROFFICE_DEBUG) console.log('[pearoffice]', ...args)
}

function startWorklet () {
  worklet = new Worklet({
    barePath: paths.bare,
    bundlePath: paths.bundle,
    dataDir,
    onLog: (kind, text) => log(kind, text.trimEnd())
  })
  // Events go to every window: the audience window of a slide show keeps
  // its own copy of the deck too.
  worklet.on('event', (msg) => sendAll(msg))
  worklet.on('exit', ({ code, signal }) => {
    log('worklet exited', code, signal)
    if (!quitting) sendAll({ name: 'worklet:exit', data: { code, signal } })
  })
  return worklet.start()
}

function sendTo (w, msg) {
  if (w && !w.isDestroyed()) w.webContents.send('worklet:event', msg)
}
function sendAll (msg) {
  sendTo(win, msg)
  sendTo(audience, msg)
}

// --- slide shows (src/ui/slides/Present.jsx) ---------------------------------
// With one display the main window goes full screen. With two or more, a
// second window shows the slides full screen on another display and the main
// window becomes the presenter view; the presenter sends app:presentGo and
// this relays it to the audience window, which sends its keys and clicks
// back as app:presentInput. Ending the show in either window, or closing
// either, closes the audience window and tells the main window
// (app:presentEnded). PEAROFFICE_FAKE_DISPLAYS=1 or 2 pretends there are
// that many displays, for the smoke test.

let audience = null
let presenting = false
let wasFullScreen = false

function otherDisplay () {
  const here = screen.getDisplayMatching(win.getBounds())
  const fake = Number(process.env.PEAROFFICE_FAKE_DISPLAYS)
  if (fake) return fake >= 2 ? { bounds: { ...here.bounds, x: here.bounds.x + here.bounds.width } } : null
  return screen.getAllDisplays().find((d) => d.id !== here.id) || null
}

function presentStart ({ sheetId, slideId }) {
  presentEnd({ quiet: true })
  if (!win || win.isDestroyed()) return { mode: 'single' }
  presenting = true
  const other = otherDisplay()
  if (!other) {
    wasFullScreen = win.isFullScreen()
    if (!SMOKE && !wasFullScreen) win.setFullScreen(true)
    return { mode: 'single' }
  }
  const b = other.bounds
  const show = audience = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    show: false,
    frame: false,
    title: 'PearOffice slide show',
    icon: process.platform === 'linux' ? ICON : undefined,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: SMOKE
    }
  })
  show.removeMenu()
  show.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  show.webContents.on('will-navigate', (e) => e.preventDefault())
  show.once('ready-to-show', () => {
    if (SMOKE || show.isDestroyed()) return
    show.show()
    show.setFullScreen(true)
    // Keys stay with the presenter view.
    if (win && !win.isDestroyed()) win.focus()
  })
  show.on('closed', () => {
    if (audience === show) audience = null
    if (presenting) presentEnd()
  })
  show.loadFile(paths.ui, { query: { audience: String(sheetId || ''), slide: String(slideId || '') } })
  return { mode: 'presenter' }
}

function presentEnd ({ quiet = false } = {}) {
  const was = presenting
  presenting = false
  const show = audience
  audience = null
  if (show && !show.isDestroyed()) show.close()
  if (win && !win.isDestroyed() && win.isFullScreen() && !wasFullScreen) win.setFullScreen(false)
  wasFullScreen = false
  if (was && !quiet) sendTo(win, { name: 'app:presentEnded', data: {} })
  return { ok: true }
}

ipcMain.handle('worklet:call', async (_e, method, args) => {
  if (method === 'app:presentStart') return presentStart(args || {})
  if (method === 'app:presentEnd') return presentEnd()
  if (method === 'app:presentGo') { sendTo(audience, { name: 'app:presentGo', data: { slideId: String((args && args.slideId) || ''), blank: (args && args.blank) || null } }); return { ok: true } }
  if (method === 'app:presentInput') { sendTo(win, { name: 'app:presentInput', data: { key: String((args && args.key) || '') } }); return { ok: true } }
  // Is a show on, and in which window (the smoke test asks).
  if (method === 'app:presentState') return { presenting, audience: !!(audience && !audience.isDestroyed()), fullScreen: !!(win && !win.isDestroyed() && win.isFullScreen()) }
  // The UI asks for a link that arrived before it was listening.
  if (method === 'app:takeLink') { const url = pendingLink; pendingLink = null; return { url } }
  // The cell menu's Cut, Copy and Paste.
  // This Electron's clipboard calls return promises.
  if (method === 'app:setClipboard') { await clipboard.writeText(String((args && args.text) || '')); return { ok: true } }
  if (method === 'app:getClipboard') return { text: String((await clipboard.readText()) || '') }
  // A tab as PDF or on paper: the UI sends a printable page.
  if (method === 'app:savePdf' || method === 'app:print') {
    const page = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
    try {
      await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String((args && args.html) || '')))
      if (method === 'app:print') {
        await new Promise((resolve) => page.webContents.print({ printBackground: true }, () => resolve()))
        return { ok: true }
      }
      const pdf = await page.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      const name = String((args && args.name) || 'PearOffice.pdf').replace(/[\\/:*?"<>|]/g, ' ')
      // The smoke test saves without asking.
      const file = SMOKE
        ? path.join(dataDir, name)
        : (await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'PDF', extensions: ['pdf'] }] })).filePath
      if (!file) return { ok: false }
      fs.writeFileSync(file, pdf)
      return { ok: true, file }
    } finally {
      page.destroy()
    }
  }
  // About: web and email links open outside the app.
  if (method === 'app:openUrl') {
    const url = String((args && args.url) || '')
    if (/^(https:|mailto:|lightning:)/.test(url)) await shell.openExternal(url)
    return { ok: true }
  }
  // After a device link or a phrase restore the identity changed: start a
  // fresh worklet and reload the UI.
  if (method === 'app:update') return updates ? updates.state() : { update: null, apply: { status: 'idle' } }
  if (method === 'app:updateApply') {
    if (!updates) throw new Error('Updates are off in this copy')
    return updates.apply()
  }
  if (method === 'app:settings') return { ...settings, startAtLogin: settings.startAtLogin && loginItem.isEnabled() }
  if (method === 'app:setSetting') {
    const patch = {}
    for (const k of Object.keys(DEFAULTS)) if (args && typeof args[k] === 'boolean') patch[k] = args[k]
    writeSettings(patch)
    return settings
  }
  if (method === 'app:seederHost') {
    if (!seeder || !seeder.running) return { running: false }
    return { running: true, ...(await seeder.call('status')) }
  }
  if (method === 'app:seederHostPair') {
    if (!seeder || !seeder.running) throw new Error('The seeder on this computer is not running')
    return seeder.call('pair')
  }
  if (method === 'app:seederHostDevices') {
    if (!seeder || !seeder.running) throw new Error('The seeder on this computer is not running')
    return seeder.call('devices')
  }
  if (method === 'app:seederHostForget') {
    if (!seeder || !seeder.running) throw new Error('The seeder on this computer is not running')
    return seeder.call('forget', { deviceKey: String((args && args.deviceKey) || '') })
  }
  if (method === 'app:restart') {
    await worklet.stop()
    await startWorklet()
    if (win && !win.isDestroyed()) win.webContents.reload()
    return { ok: true }
  }
  if (typeof method !== 'string' || !/^(sheet|file|doc|slides|app|seeder|link|donation):[A-Za-z]+$/.test(method)) throw new Error('bad method')
  await worklet.ready()
  return worklet.call(method, args || {})
})

function createWindow () {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    title: 'PearOffice',
    icon: process.platform === 'linux' ? ICON : undefined,
    // Started at login with the tray on: stay hidden until opened.
    show: !SMOKE && !(stayRunning() && loginItem.launchedAtLogin()),
    backgroundColor: '#f7f7f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: SMOKE
    }
  })
  win.removeMenu()
  win.on('close', (e) => {
    if (presenting) presentEnd()
    if (!quitting && stayRunning()) {
      e.preventDefault()
      win.hide()
    }
  })
  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.loadFile(paths.ui)
  return win
}

app.whenReady().then(async () => {
  log('data', dataDir, 'argv', process.argv.slice(1).join(' '), 'stayRunning', stayRunning())
  const ready = startWorklet().catch((err) => {
    log('worklet failed to start:', err.message)
    throw err
  })
  syncLoginItem()
  createWindow()
  if (stayRunning()) createTray()
  if (!SMOKE) log(win.isVisible() ? 'window shown' : 'started hidden in the tray')
  if (settings.runSeeder) startSeeder().catch((err) => log('seeder failed to start:', err.message))
  updates = startUpdates({ app, log, onChange: setTrayMenu })
  if (SMOKE) {
    // Downloads (Export) go straight to the smoke test's data folder.
    win.webContents.session.on('will-download', (_e, item) => {
      const target = path.join(dataDir, 'downloads', item.getFilename())
      require('node:fs').mkdirSync(path.dirname(target), { recursive: true })
      item.setSavePath(target)
    })
    require('./smoke-run').run({ app, win, ready, log, dataDir, getTray: () => tray })
  }
})

app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  sendLink(linkIn(argv))
})

app.on('open-url', (e, url) => { e.preventDefault(); sendLink(url) }) // macOS

app.on('window-all-closed', () => app.quit())

app.on('activate', showWindow) // macOS: clicking the dock icon

app.on('before-quit', async (e) => {
  if (quitting || !worklet) return
  e.preventDefault()
  quitting = true
  await Promise.all([worklet.stop(), stopSeeder()])
  app.quit()
})
