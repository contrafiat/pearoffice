// Row, column and tab ids: 8 random bytes as base64url (11 chars). The
// alphabet is A-Z a-z 0-9 - _, so ids never contain the `{ } . | $` characters
// that stored formula references use as delimiters (see refs.js).

const sodium = require('sodium-universal')
const b4a = require('b4a')

function newId () {
  const buf = b4a.alloc(8)
  sodium.randombytes_buf(buf)
  return b4a.toString(buf, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

module.exports = { newId }
