// lib0 (a Yjs dependency) requires `node:crypto` for webcrypto.getRandomValues.
// Bare has no node:crypto, so the bundle maps it here. Yjs only uses this for
// random client ids.
const sodium = require('sodium-universal')

module.exports = {
  webcrypto: {
    getRandomValues (arr) {
      sodium.randombytes_buf(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
      return arr
    },
    subtle: {}
  }
}
