import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v0_1_0 = VersionInfo.of({
  version: '0.1.0:0',
  releaseNotes: {
    en_US: 'First release',
    es_ES: 'Lanzamiento inicial para StartOS',
    de_DE: 'Erstveröffentlichung für StartOS',
    pl_PL: 'Pierwsze wydanie dla StartOS',
    fr_FR: 'Version initiale pour StartOS',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
