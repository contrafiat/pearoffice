// Automerge's wasm-bindgen glue expects WHATWG TextEncoder/TextDecoder globals,
// which Bare does not define. Load before the adapters.
if (typeof globalThis.TextDecoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('bare-encoding')
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder
}

// Automerge's wasm also asks for globalThis.crypto.getRandomValues (actor ids).
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('./shim-node-crypto').webcrypto
}
