// Update checks for the desktop app (proposals/2026-10-05-update-checker.md).
// The checking and installing live in @peerloom/host, copied into vendor/ by
// scripts/vendor-peerloom-host.js; this file gives them PearOffice's names and
// tells the app how to restart.
//
// Off in development runs and the smoke test unless PEAROFFICE_UPDATE_LATEST_URL
// points at a test release (scripts/serve-local-release.js), and off with
// PEAROFFICE_NO_UPDATE_CHECK=1 or inside a container.

const { createUpdateChecker } = require('./vendor/peerloom-host/update-check')
const { UpdateApplier } = require('./vendor/peerloom-host/update-apply')

const CONFIG = {
  name: 'PearOffice',
  slug: 'pearoffice',
  repo: 'peerloomllc/pearoffice-releases',
  envPrefix: 'PEAROFFICE',
  // The names electron-builder gives them (desktop/package.json).
  assets: {
    win32: /^PearOffice-Setup-.*\.exe$/i,
    darwinArm64: /-mac-arm64\.dmg$/i,
    darwinX64: /-mac-x64\.dmg$/i,
    appImage: /^pearoffice-.*\.AppImage$/i,
    deb: /^pearoffice-.*\.deb$/i
  },
  mac: { appBundle: 'PearOffice.app', teamId: 'G79ALD29NA', daemonPlist: null, hostArgv: null },
  linux: { unit: null, debHelper: null },
  // electron-builder's one-click installer: silent, then start the new version.
  windows: { service: null, installerArgs: ['/S', '--force-run'] }
}

// A minute after start, then hourly.
const FIRST_DELAY_MS = Number(process.env.PEAROFFICE_UPDATE_DELAY_MS || 60 * 1000)

// An AppImage runs from a mount that goes away when it exits, so Electron's
// own relaunch (a helper inside that mount) never starts the new file. A
// shell outside it drops the files and sockets it inherited from this process,
// waits for this process (and a second for its helpers) to end, then starts
// the AppImage
// with none of the old mount's variables.
function relaunch (app) {
  const image = process.env.APPIMAGE
  if (!image) { app.relaunch(); return }
  const mount = process.env.APPDIR || '\0'
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'].includes(k)) continue
    // PATH and friends: keep the entries outside the old mount.
    const kept = String(v).includes(mount) ? String(v).split(':').filter((p) => !p.includes(mount)).join(':') : v
    if (kept) env[k] = kept
  }
  const fs = require('node:fs')
  const out = process.env.PEAROFFICE_DEBUG ? fs.openSync(require('node:path').join(require('node:os').tmpdir(), 'pearoffice-relaunch.log'), 'a') : 'ignore'
  const { spawn } = require('node:child_process')
  spawn('/bin/sh', ['-c', 'for f in /proc/$$/fd/*; do n=${f##*/}; [ "$n" -gt 2 ] 2>/dev/null && eval "exec $n>&-"; done; while kill -0 "$0" 2>/dev/null; do sleep 0.3; done; sleep 1; exec "$@"', String(process.pid), image, ...process.argv.slice(1)], { detached: true, stdio: ['ignore', out, out], env }).unref()
}

function startUpdates ({ app, log, onChange }) {
  const testing = !!process.env.PEAROFFICE_UPDATE_LATEST_URL
  if (!app.isPackaged && !testing) return null
  const { checker, reason } = createUpdateChecker({
    config: CONFIG,
    currentVersion: app.getVersion(),
    firstDelayMs: FIRST_DELAY_MS,
    log: (event, data) => { log(event, JSON.stringify(data || {})); if (event === 'update:available') onChange() }
  })
  if (!checker) { log('update checks off:', reason); return null }
  const applier = new UpdateApplier({
    config: CONFIG,
    getUpdate: () => checker.get(),
    log: (event, data) => log(event, JSON.stringify(data || {})),
    // The AppImage, the .deb and the Mac app were replaced on disk: start the
    // new copy once this one has closed its stores (app.quit, not exit).
    onRelaunch: () => setTimeout(() => { relaunch(app); app.quit() }, 500),
    // Windows: the installer is running and needs this copy gone.
    onQuit: () => setTimeout(() => app.quit(), 500)
  })
  return {
    state: () => ({ update: checker.get(), apply: applier.getState() }),
    apply: () => {
      const p = applier.apply()
      p.then(onChange, onChange)
      return applier.getState()
    },
    checkNow: () => checker.check()
  }
}

module.exports = { startUpdates, CONFIG }
