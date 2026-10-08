// Run under Bare by scripts/bare-test.js: the keyring seals, opens and signs
// a claim with Bare's sodium (proposals/2026-10-07-phrase-recovers-files.md).
const b4a = require('b4a')
const { deriveKeys, seal, open, files, signClaim } = require('../../src/worklet/keyring')
const { checkSealed, checkClaim } = require('../../src/seeder/keyringRecord')
const { rootToPhrase, phraseToRoot, seedFromRoot } = require('../../src/shared/phrase')

const root = b4a.alloc(16, 0x7f)
const keys = deriveKeys(seedFromRoot(phraseToRoot(rootToPhrase(root))))
const entry = { sheetId: 'k'.repeat(43), groupKey: 'a'.repeat(64), encryptionKey: 'b'.repeat(64), bootstrap: 'c'.repeat(64), name: 'Budget', kind: 'sheet' }
const rec = seal({ v: 1, files: { [entry.sheetId]: { at: 1, entry } }, seeders: {} }, keys, 1)
const locator = b4a.toString(keys.locator, 'hex')
const sig = signClaim(keys.signKeyPair, locator, 'd'.repeat(64), 'e'.repeat(64))
console.log(JSON.stringify({
  phrase: rootToPhrase(root),
  locator: locator.slice(0, 16),
  checks: !!checkSealed(rec),
  opened: files(open(rec, keys)).map((f) => f.name),
  claim: checkClaim({ locator, sig }, rec.signKey, 'd'.repeat(64), 'e'.repeat(64))
}))
