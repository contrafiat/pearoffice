// Folders (proposals/2026-10-10-folders.md): how a person arranges their own
// files. Nobody else in a file sees them.
//
// Two kinds of record in localDb, one per id:
//
//   folder:<folderId>  { at, name } or { at, removed: true }
//   place:<sheetId>    { at, folder }   folder: a folderId or null
//
// The same records travel to this person's other devices (ownDevices.js,
// `folders` messages) and into the keyring on their seeders (keyring.js), so
// the recovery phrase brings them back. Merging keeps, per id, the later
// record by the keyring's rule. A file whose folder is removed or unknown
// shows at the top level. A removed folder is kept for 30 days, so a device
// that was offline does not bring it back, then dropped.

const b4a = require('b4a')
const sodium = require('sodium-universal')

const FOLDER_ID = /^[0-9a-f]{32}$/
const SHEET_ID = /^[A-Za-z0-9_-]{43}$/
const MAX_FOLDERS = 500
const MAX_PLACES = 5000
const MAX_NAME = 100
const TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000

// A folder's name as kept: no control characters, trimmed, at most 100
// characters. Empty means not a name.
function cleanName (name) {
  if (typeof name !== 'string') return ''
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME).trim()
}

function cleanFolder (rec) {
  if (!rec || typeof rec !== 'object' || !Number.isSafeInteger(rec.at) || rec.at < 0) return null
  if (rec.removed === true) return { at: rec.at, removed: true }
  const name = cleanName(rec.name)
  return name ? { at: rec.at, name } : null
}

function cleanPlace (rec) {
  if (!rec || typeof rec !== 'object' || !Number.isSafeInteger(rec.at) || rec.at < 0) return null
  if (rec.folder === null) return { at: rec.at, folder: null }
  return typeof rec.folder === 'string' && FOLDER_ID.test(rec.folder) ? { at: rec.at, folder: rec.folder } : null
}

// Both sections, malformed ids and records dropped, at most the limits.
function cleanFolders (folders) {
  const out = {}
  let n = 0
  for (const [id, rec] of Object.entries(folders && typeof folders === 'object' ? folders : {})) {
    if (n >= MAX_FOLDERS * 2) break // live folders and removals
    if (!FOLDER_ID.test(id)) continue
    const c = cleanFolder(rec)
    if (c) { out[id] = c; n++ }
  }
  return out
}

function cleanPlaces (places) {
  const out = {}
  let n = 0
  for (const [id, rec] of Object.entries(places && typeof places === 'object' ? places : {})) {
    if (n >= MAX_PLACES) break
    if (!SHEET_ID.test(id)) continue
    const c = cleanPlace(rec)
    if (c) { out[id] = c; n++ }
  }
  return out
}

// The later record; on a tie a removal wins, then the larger JSON, so every
// device picks the same one whatever order it merges in (keyring.js later).
function later (x, y) {
  if (x.at !== y.at) return x.at > y.at
  if (!!x.removed !== !!y.removed) return !!x.removed
  return JSON.stringify(x) > JSON.stringify(y)
}

// Two sections of records, the later of each; removed folders older than 30
// days dropped.
function mergeRecords (a, b, now) {
  const out = {}
  for (const src of [a, b]) {
    for (const [id, rec] of Object.entries(src || {})) {
      if (!out[id] || later(rec, out[id])) out[id] = rec
    }
  }
  for (const [id, rec] of Object.entries(out)) {
    if (rec.removed && rec.at < now - TOMBSTONE_MS) delete out[id]
  }
  return out
}

// What the UI shows: live folders by name, and each placed file's folder
// when that folder is live.
function view (folders, places) {
  const live = Object.entries(folders).filter(([, r]) => !r.removed).map(([id, r]) => ({ id, name: r.name }))
  live.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base', numeric: true }) || (x.id < y.id ? -1 : 1))
  const ids = new Set(live.map((f) => f.id))
  const placed = {}
  for (const [sheetId, r] of Object.entries(places)) if (r.folder && ids.has(r.folder)) placed[sheetId] = r.folder
  return { folders: live, places: placed }
}

// getOwnDevices: ownDevices.js, to tell this person's other devices.
// getKeyring: keyringSync.js, to back the change up.
function createFolders ({ engine, emit = () => {}, getOwnDevices = () => null, getKeyring = () => null, log = () => {}, now = () => Date.now() }) {
  // One change at a time, so two quick ones never read the same old record.
  let queue = Promise.resolve()
  const serial = (fn) => {
    const p = queue.then(fn)
    queue = p.catch(() => {})
    return p
  }

  async function read (prefix, clean) {
    const out = {}
    for await (const { key, value } of engine.localDb.createReadStream({ gt: prefix, lt: prefix + '~' })) {
      const c = clean(value)
      if (c) out[key.slice(prefix.length)] = c
    }
    return out
  }

  // Every record here, removals included: what the other devices and the
  // keyring get.
  async function all () {
    return { folders: await read('folder:', cleanFolder), places: await read('place:', cleanPlace) }
  }

  async function list () {
    const { folders, places } = await all()
    return view(folders, places)
  }

  // A local change: a time later than the record it replaces, even on a
  // clock that went back.
  async function stamp (key) {
    const was = (await engine.localDb.get(key))?.value
    return Math.max(now(), was && Number.isSafeInteger(was.at) ? was.at + 1 : 0)
  }

  async function liveFolder (id) {
    if (typeof id !== 'string' || !FOLDER_ID.test(id)) return null
    const rec = cleanFolder((await engine.localDb.get('folder:' + id))?.value)
    return rec && !rec.removed ? rec : null
  }

  function changed (records) {
    emit('folders:changed', {})
    const own = getOwnDevices()
    if (own && own.sendFolders) own.sendFolders(records)
    const keyring = getKeyring()
    if (keyring) keyring.poke()
  }

  function create (name) {
    return serial(async () => {
      const clean = cleanName(name)
      if (!clean) throw new Error('A folder needs a name')
      const { folders } = await all()
      if (Object.values(folders).filter((r) => !r.removed).length >= MAX_FOLDERS) throw new Error('You have ' + MAX_FOLDERS + ' folders, the most PearOffice keeps')
      const id = b4a.toString(randomBytes(16), 'hex')
      const rec = { at: now(), name: clean }
      await engine.localDb.put('folder:' + id, rec)
      changed({ folders: { [id]: rec } })
      return { id, name: clean }
    })
  }

  function rename (id, name) {
    return serial(async () => {
      const clean = cleanName(name)
      if (!clean) throw new Error('A folder needs a name')
      if (!(await liveFolder(id))) throw new Error('That folder is gone')
      const rec = { at: await stamp('folder:' + id), name: clean }
      await engine.localDb.put('folder:' + id, rec)
      changed({ folders: { [id]: rec } })
      return { id, name: clean }
    })
  }

  // The folder goes; its files show at the top level again.
  function remove (id) {
    return serial(async () => {
      if (!(await liveFolder(id))) return { ok: true }
      const rec = { at: await stamp('folder:' + id), removed: true }
      await engine.localDb.put('folder:' + id, rec)
      changed({ folders: { [id]: rec } })
      return { ok: true }
    })
  }

  // folder: a folder's id, or null for the top level.
  function place (sheetId, folder) {
    return serial(async () => {
      if (typeof sheetId !== 'string' || !SHEET_ID.test(sheetId)) throw new Error('Not a file')
      if (folder !== null && !(await liveFolder(folder))) throw new Error('That folder is gone')
      const was = cleanPlace((await engine.localDb.get('place:' + sheetId))?.value)
      if ((was ? was.folder : null) === folder) return { ok: true }
      const rec = { at: await stamp('place:' + sheetId), folder }
      await engine.localDb.put('place:' + sheetId, rec)
      changed({ places: { [sheetId]: rec } })
      return { ok: true }
    })
  }

  // Records from another device or the keyring: keep each one that is later
  // than ours. True when anything changed here.
  function take ({ folders, places } = {}) {
    return serial(async () => {
      let n = 0
      for (const [section, prefix, clean] of [[cleanFolders(folders), 'folder:', cleanFolder], [cleanPlaces(places), 'place:', cleanPlace]]) {
        for (const [id, rec] of Object.entries(section)) {
          const mine = clean((await engine.localDb.get(prefix + id))?.value)
          if (mine && !later(rec, mine)) continue
          if (rec.removed && rec.at < now() - TOMBSTONE_MS) continue
          await engine.localDb.put(prefix + id, rec)
          n++
        }
      }
      if (n) emit('folders:changed', {})
      return n > 0
    })
  }

  // A file moved to fresh keys (moves.js): the new copy goes where the old
  // one was. Every device follows the move itself and copies the same folder.
  function carry (oldId, newId) {
    return serial(async () => {
      const was = cleanPlace((await engine.localDb.get('place:' + oldId))?.value)
      if (!was || !was.folder) return false
      const mine = cleanPlace((await engine.localDb.get('place:' + newId))?.value)
      if (mine && mine.at >= was.at) return false
      const rec = { at: await stamp('place:' + newId), folder: was.folder }
      await engine.localDb.put('place:' + newId, rec)
      changed({ places: { [newId]: rec } })
      return true
    })
  }

  // Drops removed folders older than 30 days.
  function prune () {
    return serial(async () => {
      for await (const { key, value } of engine.localDb.createReadStream({ gt: 'folder:', lt: 'folder:~' })) {
        const rec = cleanFolder(value)
        if (!rec || (rec.removed && rec.at < now() - TOMBSTONE_MS)) await engine.localDb.del(key)
      }
    })
  }

  return { all, list, create, rename, remove, place, take, carry, prune }
}

function randomBytes (n) {
  const out = b4a.alloc(n)
  sodium.randombytes_buf(out)
  return out
}

module.exports = { createFolders, cleanFolders, cleanPlaces, mergeRecords, view, cleanName, later, MAX_FOLDERS, MAX_PLACES, TOMBSTONE_MS }
