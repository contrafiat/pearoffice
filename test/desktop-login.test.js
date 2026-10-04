// Start at login: the Linux autostart entry (desktop/login.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { desktopEntry, launchCommand, createLoginItem } = require('../desktop/login')
const { tmpDir, cleanup } = require('./helpers')

test('the autostart entry starts this copy hidden', () => {
  assert.deepEqual(launchCommand({ appImage: '/home/a/PearSheet.AppImage', packaged: true, execPath: '/x' }), ['/home/a/PearSheet.AppImage'])
  assert.deepEqual(launchCommand({ packaged: true, execPath: '/opt/PearSheet/pearsheet' }), ['/opt/PearSheet/pearsheet'])
  assert.deepEqual(launchCommand({ packaged: false, execPath: '/e/electron', appPath: '/src/desktop' }), ['/e/electron', '/src/desktop'])
  const entry = desktopEntry(['/home/a b/Pear"Sheet'])
  assert.match(entry, /^Exec="\/home\/a b\/Pear\\"Sheet" "--hidden"$/m)
  assert.match(entry, /^Type=Application$/m)
})

test('turning it on and off writes and removes the entry', (t) => {
  t.after(cleanup)
  const dir = tmpDir()
  const app = { isPackaged: true, getAppPath: () => '/app' }
  const item = createLoginItem({ app, platform: 'linux', autostartDir: dir })
  assert.equal(item.isEnabled(), false)
  item.setEnabled(true)
  assert.equal(item.isEnabled(), true)
  assert.ok(fs.readFileSync(path.join(dir, 'pearsheet.desktop'), 'utf8').includes('"--hidden"'))
  item.setEnabled(false)
  assert.equal(item.isEnabled(), false)
  assert.equal(item.launchedAtLogin(['electron', '--hidden']), true)
  assert.equal(item.launchedAtLogin(['electron']), false)
})
