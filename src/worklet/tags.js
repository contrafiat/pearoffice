// Tags (proposals/2026-10-28-file-tags.md): labels a person puts on their own
// files, many per file. Nobody else in a file sees them. Built like folders
// (folders.js) and merged by the same rule.
//
// Two kinds of record in localDb:
//
//   tag:<tagId>                { at, name, color } or { at, removed: true }
//   tagged:<sheetId>:<tagId>   { at, on }   on: true or false
//
// One record per file and tag, so two devices adding different tags to one
// file while apart both keep theirs. The same records travel to this
// person's other devices (ownDevices.js, `tags` messages) and into the
// keyring (keyring.js). Removed tags and `on: false` records are kept for 30
// days, then dropped.

const b4a = require('b4a')
const sodium = require('sodium-universal')
const { later, TOMBSTONE_MS } = require('./folders')
const { CHIP_NAMES } = require('../sheet/validation')

const TAG_ID = /^[0-9a-f]{32}$/
const SHEET_ID = /^[A-Za-z0-9_-]{43}$/
const TAGGED_KEY = /^([A-Za-z0-9_-]{43}):([0-9a-f]{32})$/
const MAX_TAGS = 200
const MAX_TAGGED = 5000 // about 100 bytes each, in a keyring of 1 MB at most
const MAX_PER_FILE = 20
const MAX_NAME = 40
// New tags take these in turn; grey is left for "no colour".
const COLORS = CHIP_NAMES.filter((c) => c !== 'grey')

function cleanName (name) {
  if (typeof name !== 'string') return ''
  return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim()
}

const sameName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0

function cleanTag (rec) {
  if (!rec || typeof rec !== 'object' || !Number.isSafeInteger(rec.at) || rec.at < 0) return null
  if (rec.removed === true) return { at: rec.at, removed: true }
  const name = cleanName(rec.name)
  if (!name) return null
  return { at: rec.at, name, color: CHIP_NAMES.includes(rec.color) ? rec.color : 'grey' }
}

function cleanTagged (rec) {
  if (!rec || typeof rec !== 'object' || !Number.isSafeInteger(rec.at) || rec.at < 0 || typeof rec.on !== 'boolean') return null
  return { at: rec.at, on: rec.on }
}

function cleanTags (tags) {
  const out = {}
  let n = 0
  for (const [id, rec] of Object.entries(tags && typeof tags === 'object' ? tags : {})) {
    if (n >= MAX_TAGS * 2) break // live tags and removals
    if (!TAG_ID.test(id)) continue
    const c = cleanTag(rec)
    if (c) { out[id] = c; n++ }
  }
  return out
}

function cleanTaggedAll (tagged) {
  const out = {}
  let n = 0
  for (const [key, rec] of Object.entries(tagged && typeof tagged === 'object' ? tagged : {})) {
    if (n >= MAX_TAGGED) break
    if (!TAGGED_KEY.test(key)) continue
    const c = cleanTagged(rec)
    if (c) { out[key] = c; n++ }
  }
  return out
}

// `later`, and an `on: false` counting as a removal on a tie.
const laterTagged = (x, y) => later({ ...x, removed: !x.on }, { ...y, removed: !y.on })

const stale = (rec, now) => (rec.removed || rec.on === false) && rec.at < now - TOMBSTONE_MS

// Two sections of records, the later of each; old removals dropped.
function mergeTags (a, b, now) {
  const out = {}
  for (const src of [a, b]) for (const [id, rec] of Object.entries(src || {})) if (!out[id] || later(rec, out[id])) out[id] = rec
  for (const [id, rec] of Object.entries(out)) if (stale(rec, now)) delete out[id]
  return out
}

function mergeTagged (a, b, now) {
  const out = {}
  for (const src of [a, b]) for (const [key, rec] of Object.entries(src || {})) if (!out[key] || laterTagged(rec, out[key])) out[key] = rec
  for (const [key, rec] of Object.entries(out)) if (stale(rec, now)) delete out[key]
  return out
}

// What the UI shows: live tags by name, one per name (two devices apart can
// each make "Budget"; the older id stands for both), and each file's tags as
// those ids.
function view (tags, tagged) {
  const live = Object.entries(tags).filter(([, r]) => !r.removed).map(([id, r]) => ({ id, name: r.name, color: r.color, at: r.at }))
  live.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))
  const kept = []
  const alias = new Map() // id -> the id shown for its name
  for (const t of live) {
    const first = kept.find((k) => sameName(k.name, t.name))
    if (first) alias.set(t.id, first.id)
    else { kept.push(t); alias.set(t.id, t.id) }
  }
  kept.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base', numeric: true }) || (x.id < y.id ? -1 : 1))
  const files = {}
  for (const [key, r] of Object.entries(tagged)) {
    if (!r.on) continue
    const m = TAGGED_KEY.exec(key)
    const id = m && alias.get(m[2])
    if (!id) continue
    const list = files[m[1]] || (files[m[1]] = [])
    if (!list.includes(id)) list.push(id)
  }
  return { tags: kept.map(({ id, name, color }) => ({ id, name, color })), files }
}

// The files that have every one of `picked` (tag ids), by `files` from view().
function withAll (sheetIds, files, picked) {
  if (!picked.length) return sheetIds
  return sheetIds.filter((id) => picked.every((t) => (files[id] || []).includes(t)))
}

function createTags ({ engine, emit = () => {}, getOwnDevices = () => null, getKeyring = () => null, now = () => Date.now() }) {
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

  async function all () {
    return { tags: await read('tag:', cleanTag), tagged: await read('tagged:', cleanTagged) }
  }

  async function list () {
    const { tags, tagged } = await all()
    return view(tags, tagged)
  }

  async function stamp (key) {
    const was = (await engine.localDb.get(key))?.value
    return Math.max(now(), was && Number.isSafeInteger(was.at) ? was.at + 1 : 0)
  }

  async function liveTag (id) {
    if (typeof id !== 'string' || !TAG_ID.test(id)) return null
    const rec = cleanTag((await engine.localDb.get('tag:' + id))?.value)
    return rec && !rec.removed ? rec : null
  }

  function changed (records) {
    emit('tags:changed', {})
    const own = getOwnDevices()
    if (own && own.sendTags) own.sendTags(records)
    const keyring = getKeyring()
    if (keyring) keyring.poke()
  }

  // A new tag, or the one already called that (any case).
  function create (name) {
    return serial(async () => {
      const clean = cleanName(name)
      if (!clean) throw new Error('A tag needs a name')
      const { tags } = await all()
      const shown = view(tags, {}).tags
      const same = shown.find((t) => sameName(t.name, clean))
      if (same) return same
      if (shown.length >= MAX_TAGS) throw new Error('You have ' + MAX_TAGS + ' tags, the most PearOffice keeps')
      const used = Object.values(tags).filter((r) => !r.removed).length
      const id = b4a.toString(randomBytes(16), 'hex')
      const rec = { at: now(), name: clean, color: COLORS[used % COLORS.length] }
      await engine.localDb.put('tag:' + id, rec)
      changed({ tags: { [id]: rec } })
      return { id, name: clean, color: rec.color }
    })
  }

  // Live tags with the same name as `id` (itself included): two devices apart
  // can each make "Budget", and a rename or delete covers both.
  async function siblings (id) {
    const was = await liveTag(id)
    if (!was) return []
    const { tags } = await all()
    return Object.entries(tags).filter(([, r]) => !r.removed && sameName(r.name, was.name)).map(([tid, r]) => [tid, r])
  }

  function rename (id, name) {
    return serial(async () => {
      const clean = cleanName(name)
      if (!clean) throw new Error('A tag needs a name')
      const same = await siblings(id)
      if (!same.length) throw new Error('That tag is gone')
      const { tags } = await all()
      const ids = new Set(same.map(([tid]) => tid))
      if (Object.entries(tags).some(([tid, r]) => !ids.has(tid) && !r.removed && sameName(r.name, clean))) throw new Error('You already have a tag called ' + clean)
      const out = {}
      for (const [tid, r] of same) {
        out[tid] = { at: await stamp('tag:' + tid), name: clean, color: r.color }
        await engine.localDb.put('tag:' + tid, out[tid])
      }
      changed({ tags: out })
      return { id, name: clean, color: out[id].color }
    })
  }

  // The tag goes, and with it from every file.
  function remove (id) {
    return serial(async () => {
      const same = await siblings(id)
      if (!same.length) return { ok: true }
      const out = {}
      for (const [tid] of same) {
        out[tid] = { at: await stamp('tag:' + tid), removed: true }
        await engine.localDb.put('tag:' + tid, out[tid])
      }
      changed({ tags: out })
      return { ok: true }
    })
  }

  // Put a tag on a file (on true) or take it off.
  function tag (sheetId, id, on) {
    return serial(async () => {
      if (typeof sheetId !== 'string' || !SHEET_ID.test(sheetId)) throw new Error('Not a file')
      if (!(await liveTag(id))) throw new Error('That tag is gone')
      const key = 'tagged:' + sheetId + ':' + id
      const was = cleanTagged((await engine.localDb.get(key))?.value)
      if ((was ? was.on : false) === !!on) return { ok: true }
      if (on) {
        const { tags, tagged } = await all()
        if ((view(tags, tagged).files[sheetId] || []).length >= MAX_PER_FILE) throw new Error('A file can have up to ' + MAX_PER_FILE + ' tags')
      }
      const rec = { at: await stamp(key), on: !!on }
      await engine.localDb.put(key, rec)
      changed({ tagged: { [sheetId + ':' + id]: rec } })
      return { ok: true }
    })
  }

  // Records from another device or the keyring: keep each one that is later
  // than ours. True when anything changed here.
  function take ({ tags, tagged } = {}) {
    return serial(async () => {
      let n = 0
      for (const [section, prefix, clean, isLater] of [[cleanTags(tags), 'tag:', cleanTag, later], [cleanTaggedAll(tagged), 'tagged:', cleanTagged, laterTagged]]) {
        for (const [id, rec] of Object.entries(section)) {
          const mine = clean((await engine.localDb.get(prefix + id))?.value)
          if (mine && !isLater(rec, mine)) continue
          if (stale(rec, now())) continue
          await engine.localDb.put(prefix + id, rec)
          n++
        }
      }
      if (n) emit('tags:changed', {})
      return n > 0
    })
  }

  // A file moved to fresh keys (moves.js): the new copy keeps its tags.
  function carry (oldId, newId) {
    return serial(async () => {
      const out = {}
      const prefix = 'tagged:' + oldId + ':'
      for await (const { key, value } of engine.localDb.createReadStream({ gt: prefix, lt: prefix + '~' })) {
        const was = cleanTagged(value)
        if (!was || !was.on) continue
        const to = 'tagged:' + newId + ':' + key.slice(prefix.length)
        const mine = cleanTagged((await engine.localDb.get(to))?.value)
        if (mine && mine.at >= was.at) continue
        const rec = { at: await stamp(to), on: true }
        await engine.localDb.put(to, rec)
        out[to.slice('tagged:'.length)] = rec
      }
      if (Object.keys(out).length) changed({ tagged: out })
      return Object.keys(out).length > 0
    })
  }

  // Drops removals older than 30 days.
  function prune () {
    return serial(async () => {
      for (const [prefix, clean] of [['tag:', cleanTag], ['tagged:', cleanTagged]]) {
        for await (const { key, value } of engine.localDb.createReadStream({ gt: prefix, lt: prefix + '~' })) {
          const rec = clean(value)
          if (!rec || stale(rec, now())) await engine.localDb.del(key)
        }
      }
    })
  }

  return { all, list, create, rename, remove, tag, take, carry, prune }
}

function randomBytes (n) {
  const out = b4a.alloc(n)
  sodium.randombytes_buf(out)
  return out
}

module.exports = { createTags, cleanTags, cleanTaggedAll, mergeTags, mergeTagged, view, withAll, cleanName, COLORS, MAX_TAGS, MAX_PER_FILE, MAX_NAME }
