// A menu entry and icon for the AppImage on Linux. The .deb installs both;
// an AppImage installs nothing, so the desktop cannot match the window to
// an icon (Wayland shows its generic one) and pearoffice:// links have no
// handler. The window's Wayland app id is "pearoffice-desktop", so the entry
// takes that name. Rewritten when the AppImage moves.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')

const NAME = 'pearoffice-desktop'

function quote (s) {
  return '"' + String(s).replace(/(["\\`$])/g, '\\$1') + '"'
}

function menuEntry (appImage) {
  return [
    '[Desktop Entry]',
    'Name=PearOffice',
    'Comment=Shared spreadsheets that sync device to device. No accounts, no servers.',
    'Exec=' + quote(appImage) + ' %U',
    'Terminal=false',
    'Type=Application',
    'Icon=' + NAME,
    'StartupWMClass=' + NAME,
    'MimeType=x-scheme-handler/pearoffice;',
    'Categories=Office;',
    ''
  ].join('\n')
}

// image: an Electron nativeImage of the app icon (resized here).
function installMenuEntry ({ appImage, image, dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), refresh = true }) {
  if (!appImage) return false
  const file = path.join(dataHome, 'applications', NAME + '.desktop')
  const entry = menuEntry(appImage)
  let changed = false
  for (const size of [256, 512]) {
    const icon = path.join(dataHome, 'icons', 'hicolor', size + 'x' + size, 'apps', NAME + '.png')
    if (fs.existsSync(icon) || !image) continue
    fs.mkdirSync(path.dirname(icon), { recursive: true })
    fs.writeFileSync(icon, image.resize({ width: size, height: size, quality: 'best' }).toPNG())
    changed = true
  }
  let old = null
  try { old = fs.readFileSync(file, 'utf8') } catch {}
  if (old !== entry) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, entry)
    changed = true
  }
  // So pearoffice:// links find the entry. Not every desktop has the tool.
  // (`refresh: false` in tests: it writes into the folder in the background.)
  if (changed && refresh) execFile('update-desktop-database', [path.dirname(file)], () => {})
  return changed
}

module.exports = { installMenuEntry, menuEntry, NAME }
