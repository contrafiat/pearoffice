// PearSheet desktop: Electron main process. Starts the shared Bare worklet
// (the same bundle the phones will run), opens the window and relays calls and
// events between the UI and the worklet. See proposal section 9.

const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { Worklet } = require('./worklet')
const { SeederProcess } = require('./seeder-process')
const { resolvePaths } = require('./paths')
const { createLoginItem } = require('./login')

const SMOKE = !!process.env.PEARSHEET_SMOKE

// One running copy per data folder: the worklet holds a lock on its store.
if (!SMOKE && !app.requestSingleInstanceLock()) app.exit(0)

// pearsheet:// invite links open the app. Registration only makes sense for an
// installed copy; a dev checkout still handles links passed on the command line.
if (app.isPackaged) app.setAsDefaultProtocolClient('pearsheet')

let pendingLink = linkIn(process.argv)

function linkIn (argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.startsWith('pearsheet://')) || null
}

function sendLink (url) {
  if (!url) return
  pendingLink = url
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('worklet:event', { name: 'app:deeplink', data: { url } })
}

const paths = resolvePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
const dataDir = process.env.PEARSHEET_DATA || path.join(app.getPath('userData'), 'data')

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
function writeSettings (patch) {
  settings = { ...settings, ...patch }
  // Starting at login only makes sense while PearSheet stays running.
  if (!stayRunning()) settings.startAtLogin = false
  try {
    if (loginItem.isEnabled() !== settings.startAtLogin) loginItem.setEnabled(settings.startAtLogin)
  } catch (err) {
    log('login item failed:', err.message)
    settings.startAtLogin = loginItem.isEnabled()
  }
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
// window hides it and PearSheet keeps syncing from the tray.
function createTray () {
  if (tray && !tray.isDestroyed()) return
  try {
    tray = new Tray(path.join(__dirname, 'build', 'icon.png'))
  } catch (err) {
    log('tray failed:', err.message)
    return
  }
  tray.setToolTip('PearSheet is running')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open PearSheet', click: showWindow },
    { type: 'separator' },
    { label: 'Quit PearSheet', click: () => app.quit() }
  ]))
  tray.on('click', showWindow)
}

function log (...args) {
  if (!app.isPackaged || SMOKE) console.log('[pearsheet]', ...args)
}

function startWorklet () {
  worklet = new Worklet({
    barePath: paths.bare,
    bundlePath: paths.bundle,
    dataDir,
    onLog: (kind, text) => log(kind, text.trimEnd())
  })
  worklet.on('event', (msg) => {
    if (win && !win.isDestroyed()) win.webContents.send('worklet:event', msg)
  })
  worklet.on('exit', ({ code, signal }) => {
    log('worklet exited', code, signal)
    if (!quitting && win && !win.isDestroyed()) {
      win.webContents.send('worklet:event', { name: 'worklet:exit', data: { code, signal } })
    }
  })
  return worklet.start()
}

ipcMain.handle('worklet:call', async (_e, method, args) => {
  // The UI asks for a link that arrived before it was listening.
  if (method === 'app:takeLink') { const url = pendingLink; pendingLink = null; return { url } }
  // After a device link or a phrase restore the identity changed: start a
  // fresh worklet and reload the UI.
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
  if (typeof method !== 'string' || !/^(sheet|app|seeder|link):[A-Za-z]+$/.test(method)) throw new Error('bad method')
  return worklet.call(method, args || {})
})

function createWindow () {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    title: 'PearSheet',
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
  log('data', dataDir)
  const ready = startWorklet().catch((err) => {
    log('worklet failed to start:', err.message)
    throw err
  })
  createWindow()
  if (stayRunning()) createTray()
  if (!SMOKE) log(win.isVisible() ? 'window shown' : 'started hidden in the tray')
  if (settings.runSeeder) startSeeder().catch((err) => log('seeder failed to start:', err.message))
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
