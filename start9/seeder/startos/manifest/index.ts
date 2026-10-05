import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

// The PearSheet seeder for StartOS 0.4 (proposals/2026-10-05-start9-seeder.md).
// It runs the same image as the Umbrel app.
export const manifest = setupManifest({
  id: 'pearsheet-seeder',
  title: 'PearSheet Seeder',
  license: 'MIT',
  packageRepo: 'https://github.com/peerloomllc/pearsheet',
  upstreamRepo: 'https://github.com/peerloomllc/pearsheet',
  marketingUrl: 'https://peerloomllc.com',
  donationUrl: null,
  description: { short, long },
  volumes: ['main'],
  images: {
    seeder: {
      source: { dockerTag: 'ghcr.io/peerloomllc/pearsheet-seeder:0.1.0' },
      arch: ['x86_64'],
    },
  },
  dependencies: {},
})
