// Build the seeder bundle for this machine: dist/seeder/seeder.bundle plus its
// native addons. Run with: bare dist/seeder/seeder.bundle --data <folder>
const path = require('path')
const { root, pack } = require('./bare')

pack(path.join(root, 'src', 'seeder', 'bare.js'), path.join(root, 'dist', 'seeder', 'seeder.bundle'))
