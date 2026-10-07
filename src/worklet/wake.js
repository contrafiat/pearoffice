// Rebuilding the swarm after the app was paused. On phones BareKit suspends
// the worklet whenever the app leaves the screen, and the network paths
// behind every connection, announcement and lookup die while it sleeps: a
// device link made just before switching apps to send it could not be
// reached after coming back (found 2026-10-07). Hyperswarm's suspend() and
// resume() rebuild all of it (PearCal's bounceSwarm, pearcal-native
// src/bare.js, explains why flush() is not enough). Short pauses keep their
// connections.

const BOUNCE_AFTER_MS = 3000

function createWake ({ getSwarm, log = () => {}, now = () => Date.now(), minMs = BOUNCE_AFTER_MS }) {
  let pausedAt = null
  let bouncing = null

  async function bounce (reason) {
    const swarm = getSwarm()
    if (!swarm) return false
    if (bouncing) return bouncing
    bouncing = (async () => {
      const t0 = now()
      try {
        await swarm.suspend()
        await swarm.resume()
        log('swarm rebuilt (' + reason + ') in ' + (now() - t0) + ' ms')
        return true
      } catch (e) {
        log('swarm rebuild failed (' + reason + '): ' + e.message)
        // Never leave it parked: every file would stay offline.
        try { if (swarm.suspended) await swarm.resume() } catch {}
        return false
      }
    })()
    try { return await bouncing } finally { bouncing = null }
  }

  function suspended () { pausedAt = now() }

  // Resolves to whether the swarm was rebuilt.
  async function resumed () {
    const away = pausedAt === null ? 0 : now() - pausedAt
    pausedAt = null
    if (away < minMs) return false
    return bounce('back after ' + Math.round(away / 1000) + ' s')
  }

  return { suspended, resumed, bounce }
}

module.exports = { createWake, BOUNCE_AFTER_MS }
