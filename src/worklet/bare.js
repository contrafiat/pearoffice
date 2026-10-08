// PearOffice Bare worklet entry. The same bundle runs on the desktop (spawned by
// Electron, IPC over stdin/stdout) and later on phones (BareKit IPC).
// @peerloom/core owns the P2P plumbing; this file wires in PearOffice's apply
// rules and IPC methods. See proposals/2026-10-03-wire-protocol.md.

const Hypercore = require('hypercore')
const b4a = require('b4a')
const { applyEncryptionReloadFix } = require('./hypercoreEncryptionPatch')

// Must run before any core opens: hypercore 11.37.1 still has the
// DefaultEncryption._reload bug that turns encrypted blocks into noise.
applyEncryptionReloadFix(Hypercore, b4a)
require('./hypercoreSnapshotPatch').applySnapshotFlushFix(require('hypercore/lib/session-state'))

const { createSheetEngine } = require('./engine')

createSheetEngine().start()
