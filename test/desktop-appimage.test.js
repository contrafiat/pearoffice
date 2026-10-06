// The AppImage's own menu entry and icon (desktop/appimage.js).

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installMenuEntry, menuEntry } = require('../desktop/appimage')

const image = { resize: ({ width }) => ({ toPNG: () => Buffer.from('png' + width) }) }

test('an AppImage adds a menu entry named for its window, with an icon', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-appimage-'))
  assert.equal(installMenuEntry({ appImage: '/apps/Pear Sheet.AppImage', image, dataHome: home }), true)
  const entry = fs.readFileSync(path.join(home, 'applications', 'pearsheet-desktop.desktop'), 'utf8')
  assert.match(entry, /^Exec="\/apps\/Pear Sheet\.AppImage" %U$/m)
  assert.match(entry, /^Icon=pearsheet-desktop$/m)
  assert.match(entry, /^StartupWMClass=pearsheet-desktop$/m)
  assert.match(entry, /^MimeType=x-scheme-handler\/pearsheet;$/m)
  assert.equal(fs.readFileSync(path.join(home, 'icons', 'hicolor', '512x512', 'apps', 'pearsheet-desktop.png'), 'utf8'), 'png512')
  assert.equal(installMenuEntry({ appImage: '/apps/Pear Sheet.AppImage', image, dataHome: home }), false, 'nothing to change the second time')
  assert.equal(installMenuEntry({ appImage: '/elsewhere/PearSheet.AppImage', image, dataHome: home }), true, 'moved: rewritten')
  assert.equal(fs.readFileSync(path.join(home, 'applications', 'pearsheet-desktop.desktop'), 'utf8'), menuEntry('/elsewhere/PearSheet.AppImage'))
  assert.equal(installMenuEntry({ appImage: undefined, image, dataHome: home }), false, 'not an AppImage: nothing')
  fs.rmSync(home, { recursive: true })
})
