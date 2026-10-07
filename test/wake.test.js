// Rebuilding the swarm after a pause (src/worklet/wake.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const { createWake } = require('../src/worklet/wake')

function fakeSwarm ({ failResume = false } = {}) {
  const calls = []
  return {
    calls,
    suspended: false,
    async suspend () { calls.push('suspend'); this.suspended = true },
    async resume () { calls.push('resume'); if (failResume && calls.filter((c) => c === 'resume').length === 1) throw new Error('boom'); this.suspended = false }
  }
}

test('a short pause keeps the connections; a long one rebuilds them', async () => {
  let t = 0
  const swarm = fakeSwarm()
  const wake = createWake({ getSwarm: () => swarm, now: () => t })
  wake.suspended(); t += 1000
  assert.equal(await wake.resumed(), false)
  assert.equal(swarm.calls.join(), '')
  wake.suspended(); t += 20000
  assert.equal(await wake.resumed(), true)
  assert.equal(swarm.calls.join(), 'suspend,resume')
  assert.equal(await wake.resumed(), false, 'a resume with no pause before it does nothing')
})

test('two resumes at once rebuild once', async () => {
  const swarm = fakeSwarm()
  const wake = createWake({ getSwarm: () => swarm })
  const [a, b] = await Promise.all([wake.bounce('a'), wake.bounce('b')])
  assert.equal(a && b, true)
  assert.equal(swarm.calls.join(), 'suspend,resume')
})

test('a failed rebuild never leaves the swarm suspended', async () => {
  const swarm = fakeSwarm({ failResume: true })
  const wake = createWake({ getSwarm: () => swarm })
  assert.equal(await wake.bounce('x'), false)
  assert.equal(swarm.suspended, false)
})
