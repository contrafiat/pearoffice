// Sheets as JSON (src/shared/jsonExport.js): the reverse of the import.

const test = require('node:test')
const assert = require('node:assert')
const { jsonToTabs } = require('../src/shared/jsonImport')
const { sheetToJson, isoDate } = require('../src/shared/jsonExport')

// The import payload as a dump, with each input read as the engine would
// (numbers, TRUE/FALSE, text with its apostrophe dropped).
function dumpOf (payload) {
  return {
    tabs: payload.tabs.map((t) => ({
      name: t.name,
      cells: t.cells.map(([row, col, input, num]) => ({
        row,
        col,
        value: input[0] === "'" ? input.slice(1) : /^(TRUE|FALSE)$/.test(input) ? input === 'TRUE' : /^[+-]?\d/.test(input) ? Number(input) : input,
        fmt: num ? { num } : {}
      }))
    }))
  }
}
const roundTrip = (value) => sheetToJson(dumpOf(jsonToTabs(value)))

test('exporting gives back what was imported', () => {
  const people = [
    { name: 'Ann', age: 30, joined: '2026-10-04', admin: true, address: { city: 'Oslo', zip: '0150' } },
    { name: 'Bo', age: 41.5, joined: '2025-01-31', admin: false, address: { city: 'Bergen', zip: '5003' } }
  ]
  assert.deepEqual(roundTrip(people), people, 'a list of records')
  assert.deepEqual(roundTrip([3, 'x', true]), [3, 'x', true], 'a list of values')
  const file = { title: 'Report', meta: { version: 2, draft: false }, people, teams: { red: [{ id: 1 }, { id: 2 }] } }
  assert.deepEqual(roundTrip(file), file, 'summary fields, nested tabs and nested fields')
})

test('blank and repeated headings, empty cells, errors and dates with times', () => {
  const dump = {
    tabs: [
      { name: 'Data', cells: [{ row: 1, col: 1, value: 'a' }, { row: 1, col: 3, value: 'a' }, { row: 2, col: 1, value: 1 }, { row: 2, col: 2, value: null, error: '#DIV/0!' }, { row: 2, col: 3, value: 46299.5, fmt: { num: 'yyyy-mm-dd hh:mm' } }] },
      { name: 'Other', cells: [] }
    ]
  }
  assert.deepEqual(sheetToJson(dump), { Data: [{ a: 1, column2: null, 'a 2': '2026-10-04T12:00:00' }], Other: [] })
  assert.equal(isoDate(46299), '2026-10-04')
})
