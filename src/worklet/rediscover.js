// Look again for the other devices in a sheet that is on screen.
//
// Hyperswarm looks a topic up when it is joined and then every 10 minutes.
// If the first lookup found nobody (the other device had not announced yet),
// or its connection attempt failed (a device behind a NAT that cannot take
// incoming connections, like the Android emulator), nothing happens until the
// next refresh, so two devices could sit unconnected for minutes until one
// app restarted (seen 2026-10-05/06 between the emulator and the TCL).
//
// While a sheet is on screen and no other device replicates it, refresh its
// topic after 5, 15 and 30 seconds and then every minute. Opening a sheet
// (or coming back to the app) starts the schedule again with an immediate
// refresh. Sheets that are not on screen keep Hyperswarm's own schedule.

const { topicForKey } = require('@peerloom/core/swarm')

const DELAYS_MS = [5000, 15000, 30000, 60000]

function createRediscover ({ engine, log = () => {}, delays = DELAYS_MS }) {
  const watched = new Map() // sheetId -> { timer, step }
  let closed = false

  // Other devices (members or a seeder) replicating this sheet right now.
  function connected (base) {
    const core = base && base.local
    return !!(core && core.peers && core.peers.length > 0)
  }

  // The sheet's topic comes from its group key (as core joins it).
  const topics = new Map()
  async function topicOf (sheetId) {
    if (!topics.has(sheetId)) {
      const g = (await engine.localDb.get('groups:joined:' + sheetId))?.value
      if (!g || !g.groupKey) return null
      topics.set(sheetId, topicForKey(g.groupKey))
    }
    return topics.get(sheetId)
  }

  async function refresh (sheetId) {
    if (!engine.swarm) return false
    const topic = await topicOf(sheetId)
    const discovery = topic && engine.swarm.status(topic)
    if (!discovery) return false
    discovery.refresh().catch(() => {})
    return true
  }

  function schedule (sheetId) {
    const w = watched.get(sheetId)
    if (!w || closed) return
    const wait = delays[Math.min(w.step, delays.length - 1)]
    w.timer = setTimeout(() => {
      if (!watched.has(sheetId) || closed) return
      w.step++
      if (!connected(engine.bases.get(sheetId))) refresh(sheetId).then((ok) => { if (ok) log('looking again for ' + sheetId.slice(0, 8)) }, () => {})
      schedule(sheetId)
    }, wait)
    if (w.timer.unref) w.timer.unref()
  }

  // The UI's view of a sheet: on screen or not.
  function visible (sheetId, on) {
    if (closed || typeof sheetId !== 'string') return
    const w = watched.get(sheetId)
    if (!on) {
      if (w) { clearTimeout(w.timer); watched.delete(sheetId) }
      return
    }
    if (w) clearTimeout(w.timer)
    watched.set(sheetId, { timer: null, step: 0 })
    if (!connected(engine.bases.get(sheetId))) refresh(sheetId).catch(() => {})
    schedule(sheetId)
  }

  function close () {
    closed = true
    for (const w of watched.values()) clearTimeout(w.timer)
    watched.clear()
  }

  return { visible, refresh, close, _watched: watched }
}

module.exports = { createRediscover, DELAYS_MS }
