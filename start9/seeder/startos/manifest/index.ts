import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

// The PearOffice seeder for StartOS 0.4 (proposals/2026-10-05-start9-seeder.md).
// Last release: the PearOffice seeder is now PeerLoom Seeder, so this runs
// PeerLoom Seeder's image on the same volume (same code and data layout, so
// the seeder key, paired devices and files are kept). New installs should
// use the peerloom-seeder package.
export const manifest = setupManifest({
  id: 'pearoffice-seeder',
  title: 'PearOffice Seeder (now PeerLoom Seeder)',
  license: 'MIT',
  packageRepo: 'https://github.com/peerloomllc/pearoffice-releases',
  upstreamRepo: 'https://github.com/peerloomllc/pearoffice-releases',
  marketingUrl: 'https://peerloomllc.com/seeder/',
  donationUrl: null,
  description: { short, long },
  volumes: ['main'],
  images: {
    seeder: {
      source: { dockerTag: 'ghcr.io/peerloomllc/peerloom-seeder:1.0.0' },
      arch: ['x86_64'],
    },
  },
  dependencies: {},
})
