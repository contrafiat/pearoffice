// Seeder pairing protocol: @peerloom/seeder's (vendored,
// src/protocol.js has the whole exchange). These are its PearOffice names,
// which PearOffice seeders show and every PearOffice version speaks. Links
// in either style parse.

const p = require('./vendor/peerloom-seeder/src/protocol')

const names = p.NAMES.pearoffice

module.exports = {
  PAIR_PROTOCOL: names.pairProtocol,
  PAIR_NAMESPACE: names.pairNamespace,
  PAIR_WINDOW_MS: p.PAIR_WINDOW_MS,
  SEEDER_PROTOCOL: names.seederProtocol,
  DROP_MAX_MS: p.DROP_MAX_MS,
  DROP_GRACE_MS: p.DROP_GRACE_MS,
  pairTopic: (rv) => p.pairTopic(rv, 'pearoffice'),
  seederLink: ({ rv, seederKey }) => p.seederLink({ rv, seederKey, style: 'pearoffice' }),
  parseSeederLink: p.parseSeederLink
}
