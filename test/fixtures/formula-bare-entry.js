// Bare entry: print the corpus results as JSON for scripts/bare-test.js.
const { runCorpus } = require('./formula-run')
const { runFunctionCorpus } = require('./function-run')
const { runSpillCorpus } = require('./spill-run')
console.log(JSON.stringify({ corpus: runCorpus(), functions: runFunctionCorpus(), spills: runSpillCorpus(), lifts: runSpillCorpus('lift') }))
