// PearSheet desktop: Electron main process. Starts the shared Bare worklet
// (the same bundle the phones will run), opens the window and relays calls and
// events between the UI and the worklet. See proposal section 9.

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const { Worklet } = require('./worklet')
const { resolvePaths } = require('./paths')

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
  if (typeof method !== 'string' || !/^(sheet|app):[A-Za-z]+$/.test(method)) throw new Error('bad method')
  return worklet.call(method, args || {})
})

function createWindow () {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    title: 'PearSheet',
    show: !SMOKE,
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
  if (SMOKE) {
    // Downloads (Export) go straight to the smoke test's data folder.
    win.webContents.session.on('will-download', (_e, item) => {
      const target = path.join(dataDir, 'downloads', item.getFilename())
      require('node:fs').mkdirSync(path.dirname(target), { recursive: true })
      item.setSavePath(target)
    })
    require('./smoke-run').run({ app, win, ready, log, dataDir })
  }
})

app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  sendLink(linkIn(argv))
})

app.on('open-url', (e, url) => { e.preventDefault(); sendLink(url) }) // macOS

app.on('window-all-closed', () => app.quit())

app.on('before-quit', async (e) => {
  if (quitting || !worklet) return
  e.preventDefault()
  quitting = true
  await worklet.stop()
  app.quit()
})
