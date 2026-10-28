// Keeping this person's keyring on their seeders up to date
// (proposals/2026-10-07-phrase-recovers-files.md, step 3).
//
// On by default once the device has a seeder. When this device's files or
// seeders change, it fetches the keyring from each seeder, merges in what
// changed here, seals it with the next seq and puts it on every seeder. At
// most once a minute, and a check every minute catches changes nothing
// told it about.
//
// What changed here, against the last keyring this device wrote
// (`keyring:local` in localDb):
//   - a file here that is new, or whose entry differs: listed, now;
//   - a file the keyring lists that this device removed, saw deleted or
//     saw move away: marked removed, now. A file this device never had
//     (another device's) stays as it is;
//   - each paired seeder: listed;
//   - this device's folders and placements (folders.js), merged in. Ones
//     that came from elsewhere are taken in here after the merge.

const b4a = require('b4a')
const { deriveKeys, empty, seal, open, clean, merge } = require('./keyring')
const { mergeRecords } = require('./folders')
const { mergeTags, mergeTagged } = require('./tags')

const hex = (buf) => b4a.toString(buf, 'hex')

function createKeyringSync ({ engine, getSeeding, getOwnDevices, getFolders = () => null, getTags = () => null, emit = () => {}, log = () => {}, now = () => Date.now(), gapMs = 60 * 1000, checkMs = 60 * 1000, settleMs = 3000 }) {
  let keys = null
  let keysFor = null
  let timer = null
  let checker = null
  let running = null
  let lastRun = 0
  let closed = false

  function keysNow () {
    const seed = b4a.from(engine.identity.secretKey.subarray(0, 32))
    if (!keys || !b4a.equals(keysFor, seed)) { keys = deriveKeys(seed); keysFor = seed }
    return keys
  }

  async function local () {
    return (await engine.localDb.get('keyring:local'))?.value || { seq: 0, keyring: empty(), fingerprint: '', held: [] }
  }

  async function gone (sheetId) {
    for (const k of ['removed:', 'deleted:', 'moves:']) if (await engine.localDb.get(k + sheetId)) return true
    return false
  }

  const fingerprintOf = (files, seederKeys, folders) => JSON.stringify([files.map((e) => JSON.stringify(e)).sort(), [...seederKeys].sort(), folders])

  async function withLocalChanges (keyring, files, seederKeys, folders) {
    const k = clean(keyring)
    const at = now()
    const here = new Set()
    // A change made here is always later than the version it replaces, even
    // within the same millisecond; otherwise the merge's tie-break could keep
    // the old one (as PearCal's keyringSync.js).
    const after = (item) => Math.max(at, item ? item.at + 1 : 0)
    for (const e of files) {
      here.add(e.sheetId)
      const item = k.files[e.sheetId]
      if (!item || item.removed || JSON.stringify(item.entry) !== JSON.stringify(e)) k.files[e.sheetId] = { at: after(item), entry: e }
    }
    for (const [id, item] of Object.entries(k.files)) {
      if (!item.removed && !here.has(id) && await gone(id)) k.files[id] = { at: after(item), removed: true }
    }
    for (const s of seederKeys) if (!k.seeders[s] || k.seeders[s].removed) k.seeders[s] = { at }
    k.folders = mergeRecords(k.folders, folders.folders, at)
    k.places = mergeRecords(k.places, folders.places, at)
    k.tags = mergeTags(k.tags, folders.tags, at)
    k.tagged = mergeTagged(k.tagged, folders.tagged, at)
    return k
  }

  async function write ({ force = false } = {}) {
    const seeding = getSeeding()
    const own = getOwnDevices()
    if (!seeding || !own || closed) return { written: false }
    const seederKeys = (await seeding.list()).map((s) => s.seederKey)
    if (!seederKeys.length) return { written: false }
    const files = await own.entries()
    // Folders and tags (tags.js) go in together.
    const folders = { ...(getFolders() ? await getFolders().all() : { folders: {}, places: {} }), ...(getTags() ? await getTags().all() : { tags: {}, tagged: {} }) }
    const last = await local()
    const fingerprint = fingerprintOf(files, seederKeys, folders)
    if (!force && fingerprint === last.fingerprint && seederKeys.every((s) => last.held.includes(s))) return { written: false }

    const ks = keysNow()
    const locator = hex(ks.locator)
    let keyring = await withLocalChanges(last.keyring, files, seederKeys, folders)
    let seq = last.seq
    const got = await Promise.all(seederKeys.map((s) => seeding.keyringGet(s, locator).catch(() => null)))
    for (const rec of got) {
      if (!rec) continue
      const theirs = open(rec, ks)
      if (!theirs) continue
      seq = Math.max(seq, rec.seq)
      keyring = merge(keyring, theirs, now())
    }
    keyring = merge(keyring, empty(), now()) // drops removals older than 30 days
    // Folders changed on a device this one has not met lately.
    if (getFolders()) await getFolders().take({ folders: keyring.folders, places: keyring.places })
    if (getTags()) await getTags().take({ tags: keyring.tags, tagged: keyring.tagged })
    seq = Math.max(seq + 1, 1)
    const rec = seal(keyring, ks, seq)
    const held = []
    let behind = false
    for (const s of seederKeys) {
      try {
        await seeding.keyringPut(s, rec)
        held.push(s)
      } catch (e) {
        if (/newer/.test(e.message)) behind = true
        log('keyring not backed up to ' + s.slice(0, 8) + ': ' + e.message)
      }
    }
    await engine.localDb.put('keyring:local', { seq, keyring, fingerprint, held, at: now() })
    emit('keyring:changed', { seeders: held.length })
    // Another device wrote in between: merge its version in and write again.
    if (behind) poke({ soon: true })
    return { written: true, seq, held }
  }

  function run (opts) {
    if (running) return running
    lastRun = now()
    running = write(opts).catch((e) => { log('keyring: ' + e.message); return { written: false, error: e.message } }).finally(() => { running = null })
    return running
  }

  // Something changed: write within `settleMs`, but at most once per `gapMs`.
  function poke ({ soon = false } = {}) {
    if (closed || timer) return
    const wait = soon ? settleMs : Math.max(settleMs, lastRun + gapMs - now())
    timer = setTimeout(() => { timer = null; run() }, wait)
    if (timer.unref) timer.unref()
  }

  function start () {
    poke({ soon: true })
    checker = setInterval(() => poke(), checkMs)
    if (checker.unref) checker.unref()
  }

  // For Settings: how many seeders hold the latest version, and when.
  async function status () {
    const last = await local()
    const seeding = getSeeding()
    const paired = seeding ? (await seeding.list()).map((s) => s.seederKey) : []
    return { seeders: last.held.filter((s) => paired.includes(s)).length, paired: paired.length, at: last.at || null }
  }

  function close () {
    closed = true
    clearTimeout(timer)
    clearInterval(checker)
  }

  return { start, poke, run, status, close }
}

module.exports = { createKeyringSync }
