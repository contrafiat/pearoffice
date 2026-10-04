// "Start when the computer starts": opens PearSheet hidden in the tray at
// login, so sheets stay reachable after a reboot. macOS and Windows use
// Electron's login items; Linux uses an XDG autostart entry, which Electron
// does not manage.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HIDDEN_FLAG = '--hidden'

function quote (s) {
  return '"' + String(s).replace(/(["\\`$])/g, '\\$1') + '"'
}

// The command that starts this copy of PearSheet: the AppImage itself when
// running from one, the installed binary, or Electron plus the app folder in
// a dev checkout.
function launchCommand ({ packaged, execPath, appPath, appImage }) {
  if (appImage) return [appImage]
  if (packaged) return [execPath]
  return [execPath, appPath]
}

function desktopEntry (command) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=PearSheet',
    'Comment=Keep your sheets online',
    'Exec=' + [...command, HIDDEN_FLAG].map(quote).join(' '),
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

function createLoginItem ({ app, platform = process.platform, autostartDir, fake = false }) {
  const linuxFile = path.join(autostartDir || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart'), 'pearsheet.desktop')
  let fakeOn = false

  function isEnabled () {
    if (platform === 'linux') return fs.existsSync(linuxFile)
    if (fake) return fakeOn
    return app.getLoginItemSettings().openAtLogin
  }

  function setEnabled (on) {
    if (platform === 'linux') {
      if (on) {
        const command = launchCommand({ packaged: app.isPackaged, execPath: process.execPath, appPath: app.getAppPath(), appImage: process.env.APPIMAGE })
        fs.mkdirSync(path.dirname(linuxFile), { recursive: true })
        fs.writeFileSync(linuxFile, desktopEntry(command))
      } else {
        fs.rmSync(linuxFile, { force: true })
      }
      return
    }
    if (fake) { fakeOn = on; return }
    // `args` is used on Windows; macOS reports wasOpenedAtLogin instead.
    app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_FLAG] })
  }

  // Whether this launch came from the login item.
  function launchedAtLogin (argv = process.argv) {
    if (argv.includes(HIDDEN_FLAG)) return true
    if (platform === 'darwin' && !fake) return !!app.getLoginItemSettings().wasOpenedAtLogin
    return false
  }

  return { isEnabled, setEnabled, launchedAtLogin, linuxFile }
}

module.exports = { createLoginItem, desktopEntry, launchCommand, HIDDEN_FLAG }
