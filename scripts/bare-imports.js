// Import overrides for bare-pack (--imports). Keep this map small: a key here
// replaces that specifier anywhere in the module graph.
const path = require('path')

module.exports = {
  // lib0 (used by Yjs) requires node:crypto for getRandomValues. Bare has no
  // node:crypto.
  'node:crypto': path.join(__dirname, '..', 'src', 'shared', 'shims', 'node-crypto.js')
}
