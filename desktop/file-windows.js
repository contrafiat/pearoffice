// Files in windows of their own (proposals/2026-10-26-file-windows.md). One
// window per file, loading the UI with ?file=<id>. Which files had windows,
// and where, is kept in windows.json in the data folder, so they open again
// after a restart; closing a window forgets it, quitting does not.

const fs = require('node:fs')
const path = require('node:path')

const ID = /^[A-Za-z0-9_-]{16,64}$/
const STEP = 30 // each new window a little down and right of the last
const SAVE_MS = 500

function createFileWindows ({ BrowserWindow, screen, uiFile, dataDir, preload, icon, smoke, guard, mainWindow, isQuitting, onChange = () => {}, log = () => {} }) {
  const file = path.join(dataDir, 'windows.json')
  const open = new Map() // sheetId -> BrowserWindow
  let saved = read()
  let timer = null
  let holding = false // closing for reopen(): keep them in the list

  function read () {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(list) ? list.filter((x) => x && ID.test(x.sheetId)) : []
    } catch { return [] }
  }
  function write () {
    clearTimeout(timer)
    timer = null
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(saved, null, 2))
    } catch (err) { log('windows.json not written:', err.message) }
  }
  const saveSoon = () => { if (!timer) timer = setTimeout(write, SAVE_MS) }

  // Where a window is now, as saved: its normal bounds, maximised, full screen.
  function remember (sheetId, w) {
    if (w.isDestroyed()) return
    const entry = { sheetId, bounds: w.getNormalBounds(), maximized: w.isMaximized(), fullScreen: w.isFullScreen() }
    const i = saved.findIndex((x) => x.sheetId === sheetId)
    if (i >= 0) saved[i] = entry
    else saved.push(entry)
    saveSoon()
  }
  function forget (sheetId) {
    const before = saved.length
    saved = saved.filter((x) => x.sheetId !== sheetId)
    if (saved.length !== before) saveSoon()
  }

  // Saved bounds that still land on a screen, or null.
  function onScreen (b) {
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null
    const seen = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      return w >= 100 && h >= 50
    })
    return seen ? b : null
  }
  // A new window: down and right of the newest one (or the main window),
  // kept on that screen.
  function nextBounds () {
    const main = mainWindow()
    const last = [...open.values()].filter((w) => !w.isDestroyed()).pop() || (main && !main.isDestroyed() ? main : null)
    const b = last ? last.getNormalBounds() : { x: 80, y: 80, width: 1280, height: 820 }
    const area = screen.getDisplayMatching(b).workArea
    let x = b.x + STEP
    let y = b.y + STEP
    if (x + b.width > area.x + area.width || y + b.height > area.y + area.height) { x = area.x + STEP; y = area.y + STEP }
    return { x, y, width: Math.min(b.width, area.width), height: Math.min(b.height, area.height) }
  }

  function openWindow (sheetId, place = null) {
    if (!ID.test(String(sheetId || ''))) return null
    const have = open.get(sheetId)
    if (have && !have.isDestroyed()) {
      if (have.isMinimized()) have.restore()
      have.show()
      have.focus()
      return have
    }
    const bounds = (place && onScreen(place.bounds)) || nextBounds()
    const w = new BrowserWindow({
      ...bounds,
      minWidth: 480,
      minHeight: 360,
      title: 'PearOffice',
      icon,
      show: !smoke,
      backgroundColor: '#f7f7f4',
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: smoke }
    })
    guard(w)
    open.set(sheetId, w)
    if (place && place.maximized) w.maximize()
    if (place && place.fullScreen && !smoke) w.setFullScreen(true)
    const keep = () => remember(sheetId, w)
    for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) w.on(ev, keep)
    // The page names the window after its file.
    w.on('page-title-updated', (e, title) => { e.preventDefault(); w.setTitle(title ? title + ' - PearOffice' : 'PearOffice') })
    w.on('close', keep)
    w.on('closed', () => {
      if (open.get(sheetId) === w) open.delete(sheetId)
      if (!isQuitting() && !holding) forget(sheetId)
      onChange()
    })
    w.loadFile(uiFile, { query: { file: sheetId } })
    remember(sheetId, w)
    onChange()
    return w
  }

  // The saved windows, opened again (once the main window shows).
  let restored = false
  function restore () {
    if (restored) return
    restored = true
    for (const entry of [...saved]) openWindow(entry.sheetId, entry)
  }

  // A file moved to fresh keys: its window follows it.
  function moved (from, to) {
    const w = open.get(from)
    if (!w || !ID.test(String(to || ''))) return
    open.delete(from)
    open.set(to, w)
    saved = saved.map((x) => (x.sheetId === from ? { ...x, sheetId: to } : x))
    saveSoon()
    onChange()
  }

  // The window's file is gone: close it and forget it.
  function gone (sheetId) {
    const w = open.get(sheetId)
    forget(sheetId)
    if (w && !w.isDestroyed()) w.close()
  }

  // After a device link or a phrase restore: another identity, other files.
  function closeAll () {
    saved = []
    write()
    for (const w of [...open.values()]) if (!w.isDestroyed()) w.close()
  }

  // For the smoke test, a restart without one: close every window keeping
  // the list, read windows.json back (`change` may alter it, as a screen
  // unplugged would) and reopen them.
  async function reopen (change = (list) => list) {
    holding = true
    await Promise.all(all().map((w) => new Promise((resolve) => { w.once('closed', resolve); w.close() })))
    holding = false
    write()
    saved = change(read())
    restored = false
    restore()
  }

  const all = () => [...open.values()].filter((w) => !w.isDestroyed())
  const idOf = (w) => { for (const [id, x] of open) if (x === w) return id; return null }

  return {
    openWindow,
    restore,
    moved,
    gone,
    closeAll,
    idOf,
    ids: () => [...open.keys()],
    all,
    reopen,
    flush: write
  }
}

module.exports = { createFileWindows }
