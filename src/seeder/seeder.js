// The PearOffice seeder is @peerloom/seeder (vendored from ../peerloom-seeder), the seeder
// every PeerLoom app shares (suite proposals/2026-10-12-generic-seeder.md).
// It keeps PearOffice's state folder, so seeders set up before the move keep
// their paired devices and files, and shows pearoffice:// links, which every
// PearOffice version can read.

const { createSeeder } = require('./vendor/peerloom-seeder/src/seeder')

module.exports = {
  createSeeder: (opts) => createSeeder({ stateName: 'pearoffice-state', linkStyle: 'pearoffice', ...opts })
}
