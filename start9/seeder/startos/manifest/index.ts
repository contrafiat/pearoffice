import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

// The PearOffice seeder for StartOS 0.4 (proposals/2026-10-05-start9-seeder.md).
// It runs the same image as the Umbrel app.
export const manifest = setupManifest({
  id: 'pearoffice-seeder',
  title: 'PearOffice Seeder',
  license: 'MIT',
  packageRepo: 'https://github.com/peerloomllc/pearoffice',
  upstreamRepo: 'https://github.com/peerloomllc/pearoffice',
  marketingUrl: 'https://peerloomllc.com',
  donationUrl: null,
  description: { short, long },
  volumes: ['main'],
  images: {
    seeder: {
      source: { dockerTag: 'ghcr.io/peerloomllc/pearoffice-seeder:0.1.0' },
      arch: ['x86_64'],
    },
  },
  dependencies: {},
})
