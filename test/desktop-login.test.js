// Start at login: the Linux autostart entry (desktop/login.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { desktopEntry, launchCommand, launchAgent, createLoginItem } = require('../desktop/login')
const { tmpDir, cleanup } = require('./helpers')

test('the autostart entry starts this copy hidden', () => {
  assert.deepEqual(launchCommand({ appImage: '/home/a/PearOffice.AppImage', packaged: true, execPath: '/x' }), ['/home/a/PearOffice.AppImage'])
  assert.deepEqual(launchCommand({ packaged: true, execPath: '/opt/PearOffice/pearoffice' }), ['/opt/PearOffice/pearoffice'])
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
  assert.ok(fs.readFileSync(path.join(dir, 'pearoffice.desktop'), 'utf8').includes('"--hidden"'))
  item.setEnabled(false)
  assert.equal(item.isEnabled(), false)
  assert.equal(item.launchedAtLogin(['electron', '--hidden']), true)
  assert.equal(item.launchedAtLogin(['electron']), false)
})

test('the macOS launch agent opens the app bundle hidden', (t) => {
  t.after(cleanup)
  const plist = launchAgent({ packaged: true, execPath: '/Applications/PearOffice.app/Contents/MacOS/PearOffice' })
  assert.match(plist, /<string>\/usr\/bin\/open<\/string>\n    <string>-g<\/string>\n    <string>-a<\/string>\n    <string>\/Applications\/PearOffice.app<\/string>\n    <string>--args<\/string>\n    <string>--hidden<\/string>/)
  assert.match(plist, /<key>RunAtLoad<\/key>\n  <true\/>/)
  const dir = tmpDir()
  const item = createLoginItem({ app: { isPackaged: true, getAppPath: () => '/app' }, platform: 'darwin', autostartDir: dir })
  item.setEnabled(true)
  assert.ok(fs.existsSync(path.join(dir, 'com.peerloom.pearoffice.login.plist')))
  item.setEnabled(false)
  assert.equal(item.isEnabled(), false)
})
