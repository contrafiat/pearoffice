// Import overrides for bare-pack (--imports). Keep this map small: a key here
// replaces that specifier anywhere in the module graph.
//
// Targets are file: URLs. A plain absolute path works on Linux and macOS but
// not on Windows, where bare-pack fails to resolve C:\... paths.
const path = require('path')
const { pathToFileURL } = require('url')

module.exports = {
  // lib0 (used by Yjs) requires node:crypto for getRandomValues. Bare has no
  // node:crypto.
  'node:crypto': pathToFileURL(path.join(__dirname, '..', 'src', 'shared', 'shims', 'node-crypto.js')).href
}
