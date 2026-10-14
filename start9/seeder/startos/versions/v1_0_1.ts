import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v1_0_1 = VersionInfo.of({
  version: '1.0.1:0',
  releaseNotes: {
    en_US: "PearOffice 1.0.1",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
