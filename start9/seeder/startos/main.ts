import { i18n } from './i18n'
import { sdk } from './sdk'
import { uiPort } from './utils'

// The seeder and its dashboard (seeder-dist/umbrel/server.js in the
// PearSheet repo). The dashboard asks for a password, made on first start and
// saved in the data volume (the "Show password" action reads it). Update
// checks are off: StartOS updates the package.
export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting the PearSheet seeder'))
  return sdk.Daemons.of(effects).addDaemon('seeder', {
    subcontainer: sdk.SubContainer.of(
      effects,
      { imageId: 'seeder' },
      sdk.Mounts.of().mountVolume({
        volumeId: 'main',
        subpath: null,
        mountpoint: '/data',
        readonly: false,
      }),
      'seeder',
    ),
    exec: {
      command: ['node', '/app/seeder-dist/umbrel/server.js'],
      env: {
        SEEDER_HOST: '0.0.0.0',
        SEEDER_PORT: String(uiPort),
        SEEDER_DATA: '/data',
        SEEDER_BARE: '/app/bare',
        SEEDER_BUNDLE: '/app/seeder/seeder.bundle',
        PEARSHEET_NO_UPDATE_CHECK: '1',
      },
      runAsInit: true,
    },
    ready: {
      display: i18n('Dashboard'),
      fn: () =>
        sdk.healthCheck.checkPortListening(effects, uiPort, {
          successMessage: i18n('The dashboard is ready'),
          errorMessage: i18n('The dashboard is not ready'),
        }),
    },
    requires: [],
  })
})
