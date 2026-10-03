// Build the desktop worklet bundle for this machine: dist/worklet/worklet.bundle
// plus its native addons. Electron starts it with the bare-runtime binary.
// (The mobile build will use bare-pack --linked instead.)
const path = require('path')
const { root, pack } = require('./bare')

pack(path.join(root, 'src', 'worklet', 'bare.js'), path.join(root, 'dist', 'worklet', 'worklet.bundle'))
