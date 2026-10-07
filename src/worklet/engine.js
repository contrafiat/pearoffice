/* global Bare */
// Builds the PearOffice engine on @peerloom/core. Split from bare.js so tests
// can build it in Node with an injected corestore and swarm.

const b4a = require('b4a')
const { createGroupEngine } = require('@peerloom/core/engine')
const { createSheets } = require('./sheets')
const { createApplyOps } = require('./sheetWire')
const { createSheetMethods } = require('../sheet/sheetMethods')
const { createFileMethods } = require('./fileMethods')
const { createDocMethods } = require('../doc/docMethods')
const { createSlidesMethods } = require('../slides/slidesMethods')
const { createJoinService } = require('./join')
const { createSeeding } = require('./seeding')
const { createMoves } = require('./moves')
const { createLinking } = require('./linking')
const { createDeleting } = require('./deleting')
const { createProfiles } = require('./profiles')
const { createPresence } = require('./presence')
const { createRediscover } = require('./rediscover')
const { createWake } = require('./wake')
const { createPictures } = require('./pictures')
const model = require('../sheet/sheetModel')

function createSheetEngine (opts = {}) {
  const { createSwarm: makeSwarm, log = () => {}, ...rest } = opts
  let engine = null
  let join = null
  let seeding = null
  let moves = null
  let linking = null
  let deleting = null
  let profiles = null
  let presence = null
  let rediscover = null
  let pictures = null
  const emit = (event, data) => engine && engine.emit(event, data)

  const sheets = createSheets({
    emit,
    getBase: (sheetId) => engine && engine.bases.get(sheetId),
    getLocalDb: () => engine && engine.localDb,
    getStore: () => engine && engine.store,
    onSnapshot: (sheetId) => autoCompact(sheetId).catch((e) => log('tidy-up failed: ' + e.message)),
    onChange: (sheetId) => { if (pictures) pictures.changed(sheetId) }
  })

  // The owner's device tidies up a sheet by itself once its history passes
  // COMPACT_AT updates (proposals/2026-10-05-shared-compaction.md), unless an
  // invite link is out. Checked each time the sheet saves a local snapshot.
  const COMPACT_AT = Number(opts.compactAt) || 50000
  const compacting = new Set()
  async function autoCompact (sheetId) {
    const base = engine && engine.bases.get(sheetId)
    if (!moves || !base || compacting.has(sheetId) || base.view.core.length < COMPACT_AT) return
    const sheet = (await base.view.get('sheet'))?.value
    if (!sheet || sheet.owner !== b4a.toString(engine.identity.publicKey, 'hex')) return
    if ((await base.view.get('moved')) || (await base.view.get('deleted'))) return
    if (await moves.openInvites(sheetId)) return
    compacting.add(sheetId)
    try {
      const r = await moves.compact(sheetId)
      emit('sheet:tidied', { from: sheetId, to: r.sheetId, updates: base.view.core.length })
    } finally {
      compacting.delete(sheetId)
    }
  }

  const deps = { getJoin: () => join, getMoves: () => moves, getProfiles: () => profiles, getPictures: () => pictures }
  const methods = {
    ...createFileMethods(sheets, deps),
    ...createSheetMethods(sheets, deps),
    ...createDocMethods(sheets, deps),
    ...createSlidesMethods(sheets, deps),
    // Who has a sheet open (proposals/2026-10-05-presence.md).
    'sheet:presence': async ({ sheetId, ...state }) => { if (presence) presence.set(sheetId, state); return {} },
    'sheet:present': async ({ sheetId }) => ({ people: presence ? presence.list(sheetId) : [] }),
    // A sheet came on screen or left it: look again for its other devices
    // while it is open and nobody is connected (src/worklet/rediscover.js).
    'sheet:visible': async ({ sheetId, visible }) => { if (rediscover) rediscover.visible(sheetId, !!visible); return {} },
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
  // The same methods under file: names, for any kind of file.
  for (const name of ['visible', 'removeLocal', 'cancelJoin', 'deleteForEveryone']) methods['file:' + name] = methods['sheet:' + name]

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
    appId: 'pearoffice',
    applyOps: createApplyOps({
      onUpdate: sheets.onUpdate,
      onMembership: (sheetId, type) => {
        emit('sheet:members', { sheetId })
        if (presence) setTimeout(() => presence.recheck(sheetId).catch(() => {}), 200)
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
    // Writers are admitted only by PearOffice's own inviteUse and role ops,
    // never by core's pair channel: never mint core addWriter ops, and refuse
    // any that arrive.
    mintAddWriter: () => null,
    authorizeWriter: () => false,
    // Same swarm core would build, plus the join handshake on every
    // connection. Core calls this during init, after localDb is ready.
    createSwarm: (args) => {
      const swarm = makeSwarm ? makeSwarm(args) : new (require('hyperswarm'))(args)
      profiles = createProfiles({ engine, getJoin: () => join, emit, log })
      join = createJoinService({ engine, emit, onProfile: (sheetId, op) => profiles.take(sheetId, op), kindOf: async (sheetId) => model.kind((await sheets.load(sheetId)).guarded.doc), log })
      presence = createPresence({ engine, emit, log })
      rediscover = createRediscover({ engine, log })
      // Let core attach replication first, then add our channels.
      swarm.on('connection', (conn) => { Promise.resolve().then(() => { join.onConnection(conn); presence.onConnection(conn); if (linking) linking.listen(conn) }) })
      setTimeout(() => join.resume().catch((e) => log('resume joins failed: ' + e.message)), 0)
      pictures = createPictures({ engine, sheets, getSeeding: () => seeding, log })
      seeding = createSeeding({ engine, getPictures: () => pictures, log })
      setTimeout(() => seeding.start(), 0)
      moves = createMoves({ engine, sheets, getJoin: () => join, getDeleting: () => deleting, getPictures: () => pictures, emit, log })
      linking = createLinking({ engine, log })
      deleting = createDeleting({ engine, sheets, getSeeding: () => seeding, getPictures: () => pictures, emit, log })
      // Core has no hook for "init finished", so catch up a little after
      // start, and once more later: open sheets that came with a device link,
      // follow sheets that moved, ask to be admitted where needed.
      for (const ms of [2000, 10000]) {
        const t = setTimeout(async () => {
          try { await linking.resume() } catch (e) { log('link resume failed: ' + e.message) }
          try { await moves.resume() } catch {}
          try { await deleting.resume() } catch {}
          try { await profiles.reconcileAll() } catch {}
          try { await pictures.resume() } catch {}
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
    if (deleting) deleting.close()
    if (linking) linking.close()
    if (profiles) profiles.close()
    if (presence) presence.close()
    if (rediscover) rediscover.close()
    if (pictures) await pictures.close()
    return coreClose()
  }
  // Phones: rebuild the swarm when the worklet resumes after a pause.
  const wake = createWake({ getSwarm: () => engine.swarm, log })
  if (typeof Bare !== 'undefined' && Bare.on) {
    Bare.on('suspend', () => wake.suspended())
    Bare.on('resume', () => { wake.resumed().catch(() => {}) })
  }
  engine.wake = wake
  engine.sheets = sheets
  engine.autoCompact = autoCompact // for tests
  engine.checkTidied = (sheetId) => deleting.checkTidied(sheetId) // for tests
  engine.methods = methods
  Object.defineProperty(engine, 'join', { get: () => join })
  Object.defineProperty(engine, 'seeding', { get: () => seeding })
  Object.defineProperty(engine, 'deleting', { get: () => deleting })
  Object.defineProperty(engine, 'profiles', { get: () => profiles })
  Object.defineProperty(engine, 'presence', { get: () => presence })
  Object.defineProperty(engine, 'rediscover', { get: () => rediscover })
  Object.defineProperty(engine, 'pictures', { get: () => pictures })
  return engine
}

module.exports = { createSheetEngine }
