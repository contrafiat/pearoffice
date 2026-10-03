// Bare entry: print the corpus results as JSON for scripts/bare-test.js.
const { runCorpus } = require('./formula-run')
console.log(JSON.stringify(runCorpus()))
