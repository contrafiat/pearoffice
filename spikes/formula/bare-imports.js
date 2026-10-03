const path = require('path')

module.exports = {
  'node:crypto': path.join(__dirname, 'shim-node-crypto.js'),
  // The default "node" entry reads the .wasm file with fs. The base64 build
  // embeds it, which is what a bundled worklet needs.
  '@automerge/automerge': path.join(__dirname, 'node_modules/@automerge/automerge/dist/cjs/fullfat_base64.cjs')
}
