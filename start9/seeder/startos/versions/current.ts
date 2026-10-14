import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.1.1:0',
  releaseNotes: {
    en_US: "PearOffice Seeder is now PeerLoom Seeder, one seeder for every PeerLoom app. Your seeder, paired devices and stored files are kept.",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
