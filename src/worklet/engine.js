// Builds the PearSheet engine on @peerloom/core. Split from bare.js so tests
// can build it in Node with an injected corestore and swarm.

const { createGroupEngine } = require('@peerloom/core/engine')
const { createSheets } = require('./sheets')
const { createApplyOps } = require('./sheetWire')
const { createSheetMethods } = require('./sheetMethods')
const { createJoinService } = require('./join')
const { createSeeding } = require('./seeding')
const { createMoves } = require('./moves')
const { createLinking } = require('./linking')
const { createDeleting } = require('./deleting')
const { createProfiles } = require('./profiles')

function createSheetEngine (opts = {}) {
  const { createSwarm: makeSwarm, log = () => {}, ...rest } = opts
  let engine = null
  let join = null
  let seeding = null
  let moves = null
  let linking = null
  let deleting = null
  let profiles = null
  const emit = (event, data) => engine && engine.emit(event, data)

  const sheets = createSheets({
    emit,
    getBase: (sheetId) => engine && engine.bases.get(sheetId),
    getLocalDb: () => engine && engine.localDb,
    getStore: () => engine && engine.store
  })

  const methods = {
    ...createSheetMethods(sheets, { getJoin: () => join, getMoves: () => moves, getProfiles: () => profiles }),
    'seeder:pair': async ({ link }) => seeding.pair(link),
    'seeder:list': async () => seeding.list(),
    'seeder:sheet': async ({ sheetId }) => seeding.sheetSeeders(sheetId),
    'seeder:removeFromSheet': async ({ sheetId, seederKey }) => seeding.removeFromSheet(sheetId, seederKey),
    'seeder:addToSheet': async ({ sheetId, seederKey }) => seeding.addToSheet(sheetId, seederKey),
    'seeder:stopPreview': async ({ seederKey }) => seeding.stopPreview(seederKey),
    'seeder:stopUsing': async ({ seederKey }) => seeding.stopUsing(seederKey),
    'sheet:removeLocal': async ({ sheetId }) => deleting.removeLocal(sheetId),
    // Stop a join that is still waiting; if its keys had arrived, also
    // remove what was opened.
    'sheet:cancelJoin': async ({ sheetId }) => {
      await join.cancel(sheetId)
      if (engine.bases.get(sheetId)) return deleting.removeLocal(sheetId, { reason: 'join cancelled' })
      emit('sheet:gone', { sheetId, reason: 'join cancelled' })
      return { ok: true }
    },
    'sheet:deleteForEveryone': async ({ sheetId }) => deleting.deleteForEveryone(sheetId),
    'link:start': async () => linking.start(),
    'link:join': async ({ link }) => linking.join(link),
    'link:phrase': async () => ({ phrase: linking.phrase() }),
    'app:restorePhrase': async ({ phrase }) => linking.restore(phrase),
    // Close stores cleanly, then exit. The desktop shell calls this on quit.
    'app:close': async () => {
      setTimeout(async () => {
        try { await engine.close() } catch {}
        if (typeof Bare !== 'undefined') Bare.exit(0)
      }, 0)
      return { ok: true }
    }
  }

  // Run a handler that reads what this apply batch wrote. The view shows it
  // only once the batch is done, which can take seconds on a busy device, so
  // call again until the handler says it saw it (true), for about 30 s. An op
  // that never shows (a forged delete, say) just stops being checked. One
  // round per sheet and kind at a time: a later call while one is running
  // is covered by it.
  const pendingShown = new Set()
  function untilShown (key, handler, waits = [0, 200, 500, 1000, 2000, 4000, 8000, 15000]) {
    if (pendingShown.has(key)) return
    pendingShown.add(key)
    let i = 0
    const attempt = () => handler().then((seen) => {
      if (!seen && ++i < waits.length) setTimeout(attempt, waits[i])
      else pendingShown.delete(key)
    }, (e) => { pendingShown.delete(key); log(key + ' failed: ' + e.message) })
    setTimeout(attempt, waits[0])
  }

  engine = createGroupEngine({
    appId: 'pearsheet',
    applyOps: createApplyOps({
      onUpdate: sheets.onUpdate,
      onMembership: (sheetId, type) => {
        emit('sheet:members', { sheetId })
        // The view shows the change only once this apply batch is done.
        if ((type === 'seeder' || type === 'seederOff') && seeding) setTimeout(() => seeding.sweep().catch(() => {}), 200)
        if (type === 'move' && moves) untilShown('move:' + sheetId, () => moves.onMoved(sheetId))
        if (type === 'delete' && deleting) untilShown('delete:' + sheetId, () => deleting.onDeleted(sheetId))
        // Bring this person's name and picture in step with the sheet.
        if (profiles) setTimeout(() => profiles.reconcile(sheetId).catch(() => {}), 200)
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
      profiles = createProfiles({ engine, getJoin: () => join, emit, log })
      join = createJoinService({ engine, emit, onProfile: (sheetId, op) => profiles.take(sheetId, op), log })
      // Let core attach replication first, then add our channel.
      swarm.on('connection', (conn) => { Promise.resolve().then(() => { join.onConnection(conn); if (linking) linking.listen(conn) }) })
      setTimeout(() => join.resume().catch((e) => log('resume joins failed: ' + e.message)), 0)
      seeding = createSeeding({ engine, log })
      setTimeout(() => seeding.start(), 0)
      moves = createMoves({ engine, sheets, getJoin: () => join, getDeleting: () => deleting, emit, log })
      linking = createLinking({ engine, log })
      deleting = createDeleting({ engine, sheets, getSeeding: () => seeding, emit, log })
      // Core has no hook for "init finished", so catch up a little after
      // start, and once more later: open sheets that came with a device link,
      // follow sheets that moved, ask to be admitted where needed.
      for (const ms of [2000, 10000]) {
        const t = setTimeout(async () => {
          try { await linking.resume() } catch (e) { log('link resume failed: ' + e.message) }
          try { await moves.resume() } catch {}
          try { await deleting.resume() } catch {}
          try { await profiles.reconcileAll() } catch {}
        }, ms)
        if (t.unref) t.unref()
      }
      return swarm
    },
    ...rest
  })
  const coreClose = engine.close
  engine.close = async () => {
    try { await sheets.flushSnapshots() } catch {}
    if (join) join.close()
    if (seeding) await seeding.close()
    if (moves) moves.close()
    if (linking) linking.close()
    if (profiles) profiles.close()
    return coreClose()
  }
  engine.sheets = sheets
  engine.methods = methods
  Object.defineProperty(engine, 'join', { get: () => join })
  Object.defineProperty(engine, 'seeding', { get: () => seeding })
  Object.defineProperty(engine, 'deleting', { get: () => deleting })
  Object.defineProperty(engine, 'profiles', { get: () => profiles })
  return engine
}

module.exports = { createSheetEngine }
