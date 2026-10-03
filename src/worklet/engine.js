// Builds the PearSheet engine on @peerloom/core. Split from bare.js so tests
// can build it in Node with an injected corestore and swarm.

const { createGroupEngine } = require('@peerloom/core/engine')
const { createSheets } = require('./sheets')
const { createApplyOps } = require('./sheetWire')
const { createSheetMethods } = require('./sheetMethods')

function createSheetEngine (opts = {}) {
  let engine = null
  const sheets = createSheets({
    emit: (event, data) => engine && engine.emit(event, data),
    getBase: (sheetId) => engine && engine.bases.get(sheetId)
  })
  const methods = createSheetMethods(sheets)
  engine = createGroupEngine({
    appId: 'pearsheet',
    applyOps: createApplyOps({ onUpdate: sheets.onUpdate }),
    methods,
    ...opts
  })
  engine.sheets = sheets
  engine.methods = methods
  return engine
}

module.exports = { createSheetEngine }
