// Builds the PearSheet engine on @peerloom/core. Split from bare.js so tests
// can build it in Node with an injected corestore and swarm.

const { createGroupEngine } = require('@peerloom/core/engine')
const { createSheets } = require('./sheets')
const { createApplyOps } = require('./sheetWire')
const { createSheetMethods } = require('./sheetMethods')
const { createJoinService } = require('./join')
const { createSeeding } = require('./seeding')
const { createMoves } = require('./moves')

function createSheetEngine (opts = {}) {
  const { createSwarm: makeSwarm, log = () => {}, ...rest } = opts
  let engine = null
  let join = null
  let seeding = null
  let moves = null
  const emit = (event, data) => engine && engine.emit(event, data)

  const sheets = createSheets({
    emit,
    getBase: (sheetId) => engine && engine.bases.get(sheetId)
  })

  const methods = {
    ...createSheetMethods(sheets, { getJoin: () => join, getMoves: () => moves }),
    'seeder:pair': async ({ link }) => seeding.pair(link),
    'seeder:list': async () => seeding.list(),
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
      onMembership: (sheetId, type) => {
        emit('sheet:members', { sheetId })
        if (type === 'seeder' && seeding) seeding.register(sheetId).catch(() => {})
        if (type === 'move' && moves) moves.onMoved(sheetId).catch((e) => log('move failed: ' + e.message))
      },
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
      seeding = createSeeding({ engine, log })
      setTimeout(() => seeding.start(), 0)
      moves = createMoves({ engine, sheets, getJoin: () => join, emit, log })
      // Core has no hook for "init finished", so look for sheets that moved
      // while this device was off a little after start, and once more later.
      for (const ms of [2000, 10000]) {
        const t = setTimeout(() => moves.resume().catch(() => {}), ms)
        if (t.unref) t.unref()
      }
      return swarm
    },
    ...rest
  })
  const coreClose = engine.close
  engine.close = async () => {
    if (join) join.close()
    if (seeding) await seeding.close()
    if (moves) moves.close()
    return coreClose()
  }
  engine.sheets = sheets
  engine.methods = methods
  Object.defineProperty(engine, 'join', { get: () => join })
  Object.defineProperty(engine, 'seeding', { get: () => seeding })
  return engine
}

module.exports = { createSheetEngine }
