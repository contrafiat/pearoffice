// Seeder pairing protocol, shared by the seeder and the app (wire protocol
// proposal, section 8).
//
// The seeder shows a link (and later a QR code):
//   pearsheet://seeder?rv=<rendezvous>&seeder=<seederKey>&v=1
// valid for 5 minutes. A device meets it on topic
//   blake2b("pearsheet/seeder-pair/v1" + rv)
// and talks only if the connection's remote public key equals seederKey.
// On channel `pearsheet/seeder-pair/1` (id = rv) the device sends
//   { t: 'trust', deviceKey }     its swarm public key, which must match the
//                                 connection's remote key
// and the seeder answers { t: 'ok' } or { t: 'no', reason }. Nothing about
// any sheet is sent.

const b4a = require('b4a')
const sodium = require('sodium-universal')

const PAIR_PROTOCOL = 'pearsheet/seeder-pair/1'
const PAIR_NAMESPACE = 'pearsheet/seeder-pair/v1'
const PAIR_WINDOW_MS = 5 * 60 * 1000

function pairTopic (rv) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.concat([b4a.from(PAIR_NAMESPACE), rv]))
  return out
}

function b64url (buf) {
  return b4a.toString(buf, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function seederLink ({ rv, seederKey }) {
  return 'pearsheet://seeder?' + new URLSearchParams({ rv: b64url(rv), seeder: b4a.toString(seederKey, 'hex'), v: '1' }).toString()
}

function parseSeederLink (link) {
  const m = /^pearsheet:\/\/seeder\?(.+)$/.exec(String(link).trim())
  if (!m) throw new Error('That is not a PearSheet seeder link')
  const q = new URLSearchParams(m[1])
  if (q.get('v') !== '1') throw new Error('This seeder needs a newer version of PearSheet')
  const rv = b4a.from((q.get('rv') || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const seeder = q.get('seeder') || ''
  if (rv.length !== 32 || !/^[0-9a-f]{64}$/.test(seeder)) throw new Error('This seeder link is damaged')
  return { rv, seederKey: b4a.from(seeder, 'hex') }
}

module.exports = { PAIR_PROTOCOL, PAIR_NAMESPACE, PAIR_WINDOW_MS, pairTopic, seederLink, parseSeederLink }
