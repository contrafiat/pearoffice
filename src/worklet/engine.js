// Builds the PearSheet engine on @peerloom/core. Split from bare.js so tests
// can build it in Node with an injected corestore and swarm.

const { createGroupEngine } = require('@peerloom/core/engine')
const { createSheets } = require('./sheets')
const { createApplyOps } = require('./sheetWire')
const { createSheetMethods } = require('./sheetMethods')
const { createJoinService } = require('./join')

function createSheetEngine (opts = {}) {
  const { createSwarm: makeSwarm, log = () => {}, ...rest } = opts
  let engine = null
  let join = null
  const emit = (event, data) => engine && engine.emit(event, data)

  const sheets = createSheets({
    emit,
    getBase: (sheetId) => engine && engine.bases.get(sheetId)
  })

  const methods = {
    ...createSheetMethods(sheets, { getJoin: () => join }),
    // Close stores cleanly, then exit. The desktop shell calls this on quit.
    'app:close': async () => {
      setTimeout(async () => {
        try { await engine.close() } catch {}
        if (typeof Bare !== 'undefined') Bare.exit(0)
      }, 0)
      return { ok: true }
    }
  }

  engine = createGroupEngine({
    appId: 'pearsheet',
    applyOps: createApplyOps({
      onUpdate: sheets.onUpdate,
      onMembership: (sheetId) => emit('sheet:members', { sheetId }),
      log
    }),
    methods,
    // Writers are admitted only by PearSheet's own inviteUse and role ops,
    // never by core's pair channel: never mint core addWriter ops, and refuse
    // any that arrive.
    mintAddWriter: () => null,
    authorizeWriter: () => false,
    // Same swarm core would build, plus the join handshake on every
    // connection. Core calls this during init, after localDb is ready.
    createSwarm: (args) => {
      const swarm = makeSwarm ? makeSwarm(args) : new (require('hyperswarm'))(args)
      join = createJoinService({ engine, emit, log })
      // Let core attach replication first, then add our channel.
      swarm.on('connection', (conn) => { Promise.resolve().then(() => join.onConnection(conn)) })
      setTimeout(() => join.resume().catch((e) => log('resume joins failed: ' + e.message)), 0)
      return swarm
    },
    ...rest
  })
  const coreClose = engine.close
  engine.close = async () => {
    if (join) join.close()
    return coreClose()
  }
  engine.sheets = sheets
  engine.methods = methods
  Object.defineProperty(engine, 'join', { get: () => join })
  return engine
}

module.exports = { createSheetEngine }
