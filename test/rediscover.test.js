// Looking again for a sheet's other devices while it is on screen and
// nobody is connected (src/worklet/rediscover.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const { topicForKey } = require('@peerloom/core/swarm')
const b4a = require('b4a')
const { createRediscover } = require('../src/worklet/rediscover')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fakeEngine () {
  const groupKey = 'ab'.repeat(32)
  const refreshed = []
  const base = { local: { peers: [] } }
  const discovery = { refresh: async () => { refreshed.push(Date.now()) } }
  const topicHex = b4a.toString(topicForKey(groupKey), 'hex')
  return {
    refreshed,
    base,
    engine: {
      bases: new Map([['s1', base]]),
      localDb: { get: async (k) => (k === 'groups:joined:s1' ? { value: { groupKey } } : null) },
      swarm: { status: (topic) => (b4a.toString(topic, 'hex') === topicHex ? discovery : null) }
    }
  }
}

test('an open sheet with nobody connected is looked up again, then stops when closed', async () => {
  const f = fakeEngine()
  const r = createRediscover({ engine: f.engine, delays: [20, 20, 40] })
  r.visible('s1', true)
  await sleep(5)
  assert.equal(f.refreshed.length, 1, 'right away on opening')
  await sleep(100)
  assert.ok(f.refreshed.length >= 3, 'and again on the schedule')
  r.visible('s1', false)
  const n = f.refreshed.length
  await sleep(80)
  assert.equal(f.refreshed.length, n, 'nothing once the sheet is closed')
  r.close()
})

test('a sheet that already has a device connected is left alone', async () => {
  const f = fakeEngine()
  f.base.local.peers.push({})
  const r = createRediscover({ engine: f.engine, delays: [10] })
  r.visible('s1', true)
  await sleep(60)
  assert.equal(f.refreshed.length, 0)
  r.close()
})
