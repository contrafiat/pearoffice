// Where the Bare binary, the worklet bundle and the UI live, in development
// (the repo checkout) and in a packaged app (process.resourcesPath).

const path = require('node:path')

function resolvePaths ({ packaged, resourcesPath }) {
  const bareName = process.platform === 'win32' ? 'bare.exe' : 'bare'
  if (packaged) {
    return {
      bare: path.join(resourcesPath, 'bare', bareName),
      bundle: path.join(resourcesPath, 'worklet', 'worklet.bundle'),
      seeder: path.join(resourcesPath, 'seeder', 'seeder.bundle'),
      ui: path.join(resourcesPath, 'ui', 'index.html'),
      licence: path.join(resourcesPath, 'LICENSE.txt'),
      notices: path.join(resourcesPath, 'THIRD-PARTY-NOTICES.txt')
    }
  }
  const root = path.join(__dirname, '..')
  return {
    bare: path.join(root, 'node_modules', `bare-runtime-${process.platform}-${process.arch}`, 'bin', bareName),
    bundle: path.join(root, 'dist', 'worklet', 'worklet.bundle'),
    seeder: path.join(root, 'dist', 'seeder', 'seeder.bundle'),
    ui: path.join(root, 'dist', 'ui', 'index.html'),
    // Written by scripts/stage-desktop.js.
    licence: path.join(root, 'LICENSE'),
    notices: path.join(root, 'desktop', 'build', 'resources', 'THIRD-PARTY-NOTICES.txt')
  }
}

module.exports = { resolvePaths }
