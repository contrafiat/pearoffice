// The "what's new" part of the Nostr announcement (scripts/release.sh
// nostr): the notes' bullets under their headings, while they fit.
//
//   node scripts/release/nostr-bullets.js <notes-file> [budget]

const fs = require('fs')

const [file, budgetArg] = process.argv.slice(2)
const budget = Number(budgetArg || 900)
const out = []
let used = 0
let dropped = 0
let heading = null
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const h = /^#{2,4}\s+(.*)/.exec(line)
  if (h) { heading = h[1].trim(); continue }
  const b = /^\s*[-*]\s+(.+)/.exec(line)
  if (!b) continue
  let item = b[1].replace(/\*\*/g, '').trim()
  if (item.length > 120) item = item.slice(0, 120).replace(/\s+\S*$/, '').replace(/[,.;:]$/, '') + '…'
  const cost = (heading ? heading.length + 2 : 0) + item.length + 3
  if (dropped || used + cost > budget) { dropped++; continue }
  if (heading) { out.push((out.length ? '\n' : '') + heading); heading = null }
  out.push('• ' + item)
  used += cost
}
if (dropped) out.push('• …and ' + dropped + ' more')
console.log(out.join('\n'))
