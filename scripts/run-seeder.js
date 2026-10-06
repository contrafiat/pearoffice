// Build and run the seeder from the checkout. Data goes to ~/.pearoffice-seeder
// unless PEAROFFICE_SEEDER_DATA is set. Type `pair` for a new pairing link.
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const { root, barePath } = require('./bare')

require('./build-seeder')
const data = process.env.PEAROFFICE_SEEDER_DATA || path.join(os.homedir(), '.pearoffice-seeder')
spawn(barePath(), [path.join(root, 'dist', 'seeder', 'seeder.bundle'), '--data', data], { stdio: 'inherit' })
  .on('exit', (code) => process.exit(code || 0))
