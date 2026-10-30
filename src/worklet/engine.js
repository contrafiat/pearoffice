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
const { createMediaMethods } = require('../media/mediaMethods')
const { createSlidesMethods } = require('../slides/slidesMethods')
const { createHistoryMethods } = require('./historyMethods')
const { createJoinService } = require('./join')
const { createSeeding } = require('./seeding')
const { createMoves } = require('./moves')
const { createLinking } = require('./linking')
const { createDeleting } = require('./deleting')
const { createProfiles } = require('./profiles')
const { createDevices } = require('./devices')
const { createPresence } = require('./presence')
const { createRediscover } = require('./rediscover')
const { createWake } = require('./wake')
const { createPictures } = require('./pictures')
const { createOwnDevices } = require('./ownDevices')
const { createKeyringSync } = require('./keyringSync')
const { createRestoring } = require('./restoring')
const { createFolders } = require('./folders')
const { createTags } = require('./tags')
const { createRelay } = require('./relay')
const { newRoot, identityFromRoot } = require('../shared/phrase')
const model = require('../sheet/sheetModel')

function createSheetEngine (opts = {}) {
  // platform: for tests; by default the host's (devices.js).
  const { createSwarm: makeSwarm, log = () => {}, platform, ...rest } = opts
  let engine = null
  let join = null
  let seeding = null
  let moves = null
  let linking = null
  let deleting = null
  let profiles = null
  let devices = null
  let presence = null
  let rediscover = null
  let pictures = null
  let ownDevices = null
  let keyring = null
  let restoring = null
  let folders = null
  let tags = null
  // The PeerLoom blind relay, direct first (proposals/2026-10-08-blind-relay.md).
  const relay = createRelay()
  const relayingDhts = new WeakMap() // swarm.dht -> its direct-first wrapper
  const dhtOf = (dht) => {
    if (!relayingDhts.has(dht)) relayingDhts.set(dht, relay.relayingDht(dht))
    return relayingDhts.get(dht)
  }
  const emit = (event, data) => engine && engine.emit(event, data)

  const sheets = createSheets({
    emit,
    getBase: (sheetId) => engine && engine.bases.get(sheetId),
    getLocalDb: () => engine && engine.localDb,
    getStore: () => engine && engine.store,
    onSnapshot: (sheetId) => autoCompact(sheetId).catch((e) => log('tidy-up failed: ' + e.message)),
    onChange: (sheetId) => { if (pictures) pictures.changed(sheetId); sharedTagsChanged(sheetId) }
  })

  // A file's shared tags (proposals/2026-10-29-shared-tags.md): when they
  // change, put new ones on the file as this person's own tags (tags.js).
  const sharedSeen = new Map() // sheetId -> meta.tags as last seen, JSON
  function sharedTagsChanged (sheetId) {
    if (!tags) return
    const list = model.sharedTags(sheets.entryFor(sheetId).guarded.doc)
    const json = JSON.stringify(list)
    if (sharedSeen.get(sheetId) === json) return
    sharedSeen.set(sheetId, json)
    if (list.length) tags.applyShared(sheetId, list).catch((e) => log('shared tags not applied: ' + e.message))
  }

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

  const deps = { getJoin: () => join, getMoves: () => moves, getProfiles: () => profiles, getDevices: () => devices, getPictures: () => pictures, getRestoring: () => restoring, getTags: () => tags }
  const methods = {
    ...createFileMethods(sheets, deps),
    ...createSheetMethods(sheets, deps),
    ...createDocMethods(sheets, deps),
    ...createMediaMethods(sheets, deps),
    ...createSlidesMethods(sheets, deps),
    ...createHistoryMethods(sheets),
    // Who has a sheet open (proposals/2026-10-05-presence.md).
    'sheet:presence': async ({ sheetId, ...state }) => { if (presence) presence.set(sheetId, state); return {} },
    'sheet:present': async ({ sheetId }) => ({ people: presence ? presence.list(sheetId) : [] }),
    // A sheet came on screen or left it: look again for its other devices
    // while it is open and nobody is connected (src/worklet/rediscover.js).
    'sheet:visible': async ({ sheetId, visible }) => { if (rediscover) rediscover.visible(sheetId, !!visible); return {} },
    // Your linked devices and their names (proposals/2026-10-07-device-names.md).
    'app:devices': async () => (devices ? devices.list() : []),
    'app:restoreStatus': async () => (restoring ? restoring.status() : null),
    'file:recoverCopy': async ({ sheetId }) => moves.recoverCopy(sheetId),
    // "Connect anywhere" in Settings: this device only, never synced.
    'app:relay': async () => ({ useRelay: relay.useRelay, configured: relay.configured, stats: engine.swarm ? dhtOf(engine.swarm.dht).relayStats : null }),
    'app:setRelay': async ({ on }) => ({ useRelay: await relay.save(engine.localDb, on !== false) }),
    'app:keyring': async () => (keyring ? keyring.status() : { seeders: 0, paired: 0, at: null }),
    'app:renameDevice': async ({ deviceKey, name }) => { await devices.rename(deviceKey, name); return { ok: true } },
    // This person's folders (proposals/2026-10-10-folders.md).
    'file:folders': async () => (folders ? folders.list() : { folders: [], places: {} }),
    'file:newFolder': async ({ name }) => folders.create(name),
    'file:renameFolder': async ({ id, name }) => folders.rename(id, name),
    'file:deleteFolder': async ({ id }) => folders.remove(id),
    'file:place': async ({ sheetId, folder }) => folders.place(sheetId, folder === undefined ? null : folder),
    // This person's tags (proposals/2026-10-28-file-tags.md).
    'file:tags': async () => (tags ? tags.list() : { tags: [], files: {} }),
    'file:newTag': async ({ name }) => tags.create(name),
    'file:renameTag': async ({ id, name }) => tags.rename(id, name),
    'file:deleteTag': async ({ id }) => tags.remove(id),
    'file:tag': async ({ sheetId, id, on }) => tags.tag(sheetId, id, on !== false),
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
    'link:join': async ({ link, replace }) => linking.join(link, { replace: replace === true }),
    // What taking on another identity would remove from this device: every
    // file here, and which of them nobody else is in (those are gone for good).
    'link:filesHere': async (args, ctx) => {
      const files = (await methods['file:list']({}, ctx)).filter((f) => !f.joining && !f.removed)
      const only = files.filter((f) => (f.people || 0) <= 1).map((f) => f.title || 'Untitled')
      return { total: files.length, onlyHere: only }
    },
    'link:cancel': async () => linking.cancel(),
    'link:phrase': async () => ({ phrase: await linking.phrase() }),
    'app:restorePhrase': async ({ phrase, replace }) => linking.restore(phrase, { replace: replace === true }),
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
        // Again once this apply batch is in the view, so a reader sees it
        // (a rename showing on a person chip, for one).
        setTimeout(() => emit('sheet:members', { sheetId }), 200)
        if (presence) setTimeout(() => presence.recheck(sheetId).catch(() => {}), 200)
        // The view shows the change only once this apply batch is done.
        if ((type === 'seeder' || type === 'seederOff') && seeding) setTimeout(() => seeding.sweep().catch(() => {}), 200)
        if (type === 'move' && moves) untilShown('move:' + sheetId, () => moves.onMoved(sheetId))
        if (type === 'delete' && deleting) untilShown('delete:' + sheetId, () => deleting.onDeleted(sheetId))
        // Bring this person's name and picture in step with the sheet.
        if (profiles) setTimeout(() => profiles.reconcile(sheetId).catch(() => {}), 200)
        if (devices) setTimeout(() => devices.reconcile(sheetId).catch(() => {}), 200)
        if (type === 'deviceName') setTimeout(() => emit('devices:changed', {}), 300)
      },
      log
    }),
    methods,
    // Writers are admitted only by PearOffice's own inviteUse and role ops,
    // never by core's pair channel: never mint core addWriter ops, and refuse
    // any that arrive.
    // A new device's identity comes from a fresh 12-word root (phrase.js).
    newIdentity: async (localDb) => {
      const root = newRoot()
      await localDb.put('phrase:root', { root: b4a.toString(root, 'hex') })
      return identityFromRoot(root)
    },
    mintAddWriter: () => null,
    authorizeWriter: () => false,
    // Same swarm core would build, plus the join handshake on every
    // connection. Core calls this during init, after localDb is ready.
    createSwarm: (args) => {
      // Read the switch before any dial; until then nothing relays.
      relay.hydrate(engine.localDb).catch(() => {})
      const swarm = makeSwarm ? makeSwarm(args) : new (require('hyperswarm'))({ ...args, relayThrough: relay.swarmRelayThrough })
      profiles = createProfiles({ engine, getJoin: () => join, emit, log })
      devices = createDevices({ engine, getJoin: () => join, getPresence: () => presence, emit, log, platform })
      join = createJoinService({ engine, emit, onProfile: (sheetId, op) => (op && op.type === 'deviceName' ? devices.take(sheetId, op) : profiles.take(sheetId, op)), kindOf: async (sheetId) => model.kind((await sheets.load(sheetId)).guarded.doc), onAdded: (sheetId) => { if (ownDevices) ownDevices.notify(sheetId); if (keyring) keyring.poke() }, log })
      presence = createPresence({ engine, emit, onSeen: (identity, device) => devices.seen(identity, device), log })
      rediscover = createRediscover({ engine, log })
      // Let core attach replication first, then add our channels.
      swarm.on('connection', (conn) => { Promise.resolve().then(() => { join.onConnection(conn); presence.onConnection(conn); if (ownDevices) ownDevices.onConnection(conn); if (linking) linking.listen(conn) }) })
      setTimeout(() => join.resume().catch((e) => log('resume joins failed: ' + e.message)), 0)
      pictures = createPictures({ engine, sheets, getSeeding: () => seeding, log })
      seeding = createSeeding({ engine, dhtOf, getPictures: () => pictures, log })
      setTimeout(() => seeding.start(), 0)
      folders = createFolders({ engine, emit, getOwnDevices: () => ownDevices, getKeyring: () => keyring, log })
      setTimeout(() => folders.prune().catch(() => {}), 0)
      // While this device shares a file's tags, a change to them updates the
      // file (file:shareTags).
      const onFileTags = (sheetId) => {
        engine.localDb.get('shareTags:' + sheetId).then((r) => (r && r.value ? methods['file:shareTags']({ sheetId, on: true }, engine) : null)).catch((e) => log('shared tags not updated: ' + e.message))
      }
      tags = createTags({ engine, emit, getOwnDevices: () => ownDevices, getKeyring: () => keyring, onFileTags })
      setTimeout(() => tags.prune().catch(() => {}), 0)
      // A file that moves to fresh keys stays in its folder and keeps its tags.
      const movesEmit = (event, data) => {
        if (event === 'sheet:moved' && data && data.to) {
          folders.carry(data.from, data.to).catch((e) => log('folder not carried: ' + e.message))
          tags.carry(data.from, data.to).catch((e) => log('tags not carried: ' + e.message))
        }
        emit(event, data)
      }
      moves = createMoves({ engine, sheets, getJoin: () => join, getDeleting: () => deleting, getPictures: () => pictures, emit: movesEmit, log })
      linking = createLinking({
        engine,
        log,
        // Every file on this device, frozen copies included (deleting.js).
        removeFiles: async () => {
          const ids = []
          for await (const { value } of engine.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~' })) if (value && value.groupId) ids.push(value.groupId)
          for (const id of ids) {
            await deleting.removeLocal(id, { reason: 'removed' })
            // Not a choice to drop this file: the identity's other devices
            // may bring it back (ownDevices.js skips files marked removed).
            await engine.localDb.del('removed:' + id)
          }
          log('removed ' + ids.length + ' files to take on another identity')
        }
      })
      deleting = createDeleting({ engine, sheets, getSeeding: () => seeding, getPictures: () => pictures, emit, log })
      // Your devices keep the same files (proposals/2026-10-07-own-devices-files.md).
      ownDevices = createOwnDevices({
        engine,
        getJoin: () => join,
        getMoves: () => moves,
        getFolders: () => folders,
        getTags: () => tags,
        describe: (sheetId) => {
          const e = sheets.peek(sheetId)
          return e ? { title: model.title(e.guarded.doc), kind: e.guarded.doc.getMap('meta').get('kind') } : null
        },
        emit,
        log
      })
      setTimeout(() => ownDevices.start(), 0)
      // The keyring on your seeders (proposals/2026-10-07-phrase-recovers-files.md).
      keyring = createKeyringSync({
        engine,
        getSeeding: () => seeding,
        getOwnDevices: () => ownDevices,
        getFolders: () => folders,
        getTags: () => tags,
        emit,
        log,
        ...(opts.keyringGapMs ? { gapMs: opts.keyringGapMs, checkMs: opts.keyringGapMs, settleMs: Math.min(3000, opts.keyringGapMs) } : {}),
        ...(opts.keyringNow ? { now: opts.keyringNow } : {}) // tests: a frozen clock
      })
      setTimeout(() => keyring.start(), 5000).unref?.()
      // After a restore from the phrase: bring the files back.
      restoring = createRestoring({
        engine,
        getSeeding: () => seeding,
        getOwnDevices: () => ownDevices,
        getFolders: () => folders,
        getTags: () => tags,
        emit,
        log,
        ...(opts.restoreLookMs ? { lookMs: opts.restoreLookMs, settleMs: Math.min(5000, opts.restoreLookMs) } : {})
      })
      setTimeout(() => restoring.start().catch(() => {}), 1000)
      // Core has no hook for "init finished", so catch up a little after
      // start, and once more later: open sheets that came with a device link,
      // follow sheets that moved, ask to be admitted where needed.
      for (const ms of [2000, 10000]) {
        const t = setTimeout(async () => {
          try { await linking.resume() } catch (e) { log('link resume failed: ' + e.message) }
          try { await moves.resume() } catch {}
          try { await deleting.resume() } catch {}
          try { await profiles.reconcileAll() } catch {}
          try { await devices.reconcileAll() } catch {}
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
    if (ownDevices) ownDevices.close()
    if (keyring) keyring.close()
    if (restoring) restoring.close()
    if (profiles) profiles.close()
    if (devices) devices.close()
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
  Object.defineProperty(engine, 'devices', { get: () => devices })
  Object.defineProperty(engine, 'presence', { get: () => presence })
  Object.defineProperty(engine, 'rediscover', { get: () => rediscover })
  Object.defineProperty(engine, 'pictures', { get: () => pictures })
  Object.defineProperty(engine, 'ownDevices', { get: () => ownDevices })
  Object.defineProperty(engine, 'keyring', { get: () => keyring })
  Object.defineProperty(engine, 'folders', { get: () => folders })
  Object.defineProperty(engine, 'tags', { get: () => tags })
  engine.relay = relay // for tests
  Object.defineProperty(engine, 'restoring', { get: () => restoring })
  return engine
}

module.exports = { createSheetEngine }
