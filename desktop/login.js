// "Start when the computer starts": opens PearOffice hidden in the tray at
// login, so sheets stay reachable after a reboot.
//
// - Linux: an XDG autostart entry, which Electron does not manage.
// - macOS: a LaunchAgent. Electron's login items cannot pass arguments there
//   and cannot tell a login launch apart on macOS 13 and later.
// - Windows: Electron's login items, with `--hidden` as an argument.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HIDDEN_FLAG = '--hidden'

function quote (s) {
  return '"' + String(s).replace(/(["\\`$])/g, '\\$1') + '"'
}

// The command that starts this copy of PearOffice: the AppImage itself when
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
    'Name=PearOffice',
    'Comment=Keep your files online',
    'Exec=' + [...command, HIDDEN_FLAG].map(quote).join(' '),
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

function xmlEscape (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const AGENT_LABEL = 'com.peerloom.pearoffice.login'

// macOS: open the app bundle through Launch Services, in the background, with
// the hidden flag. A dev checkout runs Electron directly.
function launchAgent ({ packaged, execPath, appPath }) {
  const args = packaged
    ? ['/usr/bin/open', '-g', '-a', path.resolve(execPath, '..', '..', '..'), '--args', HIDDEN_FLAG]
    : [execPath, appPath, HIDDEN_FLAG]
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>' + AGENT_LABEL + '</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((a) => '    <string>' + xmlEscape(a) + '</string>'),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    ''
  ].join('\n')
}

function createLoginItem ({ app, platform = process.platform, autostartDir, fake = false }) {
  const home = os.homedir()
  const file = platform === 'linux'
    ? path.join(autostartDir || path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart'), 'pearoffice.desktop')
    : platform === 'darwin'
      ? path.join(autostartDir || path.join(home, 'Library', 'LaunchAgents'), AGENT_LABEL + '.plist')
      : null
  let fakeOn = false

  function isEnabled () {
    if (file) return fs.existsSync(file)
    if (fake) return fakeOn
    return app.getLoginItemSettings({ args: [HIDDEN_FLAG] }).openAtLogin
  }

  function setEnabled (on) {
    if (file) {
      if (!on) return fs.rmSync(file, { force: true })
      const where = { packaged: app.isPackaged, execPath: process.execPath, appPath: app.getAppPath(), appImage: process.env.APPIMAGE }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, platform === 'linux' ? desktopEntry(launchCommand(where)) : launchAgent(where))
      return
    }
    if (fake) { fakeOn = on; return }
    app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_FLAG] })
  }

  // Whether this launch came from the login item.
  function launchedAtLogin (argv = process.argv) {
    return argv.includes(HIDDEN_FLAG)
  }

  return { isEnabled, setEnabled, launchedAtLogin, file }
}

module.exports = { createLoginItem, desktopEntry, launchCommand, launchAgent, HIDDEN_FLAG }
