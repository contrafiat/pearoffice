// The grid's small helpers: decimal places and Ctrl+arrow jumps.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const load = () => import(path.join(__dirname, '..', 'src', 'ui', 'cellTools.js'))

test('more and fewer decimal places', async () => {
  const { changeDecimals } = await load()
  assert.equal(changeDecimals('', 1, '1650.5'), '0.00')
  assert.equal(changeDecimals('', -1, '1650.5'), '0')
  assert.equal(changeDecimals('$#,##0.00', 1), '$#,##0.000')
  assert.equal(changeDecimals('$#,##0.00', -1), '$#,##0.0')
  assert.equal(changeDecimals('0%', 1), '0.0%')
  assert.equal(changeDecimals('0.0"kg"', 1), '0.00"kg"')
  assert.equal(changeDecimals('0.00;[Red]-0.00', -1), '0.0;[Red]-0.00')
  assert.equal(changeDecimals('yyyy-mm-dd', 1), 'yyyy-mm-dd', 'dates are left alone')
})

test('Ctrl+arrow jumps along runs and gaps', async () => {
  const { jumpTarget } = await load()
  const filled = new Set(['1,1', '2,1', '3,1', '6,1'])
  const f = (r, c) => filled.has(r + ',' + c)
  assert.deepEqual(jumpTarget(f, 10, 5, { row: 1, col: 1 }, 1, 0), { row: 3, col: 1 }, 'to the end of the run')
  assert.deepEqual(jumpTarget(f, 10, 5, { row: 3, col: 1 }, 1, 0), { row: 6, col: 1 }, 'across the gap')
  assert.deepEqual(jumpTarget(f, 10, 5, { row: 6, col: 1 }, 1, 0), { row: 10, col: 1 }, 'to the edge')
  assert.deepEqual(jumpTarget(f, 10, 5, { row: 1, col: 1 }, 0, 1), { row: 1, col: 5 })
})
