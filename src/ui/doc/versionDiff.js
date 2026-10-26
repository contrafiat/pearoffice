// What changed between two versions of a document, for version history
// (proposals/2026-10-26-version-history.md): the newer version as blocks
// (a paragraph, a heading, a list item, a table row, a picture), each with
// its words marked as kept, added or removed.

import { chipText } from './extensions.js'

const MAX_CELLS = 250000 // above this, a changed block is shown as replaced

// The document's JSON as a list of { kind, text } blocks.
export function blocksOf (json) {
  const out = []
  const inline = (nodes) => (nodes || []).map((n) => (n.type === 'text' ? n.text : n.type === 'hardBreak' ? '\n' : n.type === 'chip' ? chipText(n.attrs || {}) : inline(n.content))).join('')
  const walk = (nodes, list) => {
    for (const n of nodes || []) {
      if (n.type === 'paragraph') out.push({ kind: list ? 'li' : 'p', text: inline(n.content) })
      else if (n.type === 'heading') out.push({ kind: 'h' + Math.min(3, (n.attrs && n.attrs.level) || 1), text: inline(n.content) })
      else if (n.type === 'codeBlock') out.push({ kind: 'code', text: inline(n.content) })
      else if (n.type === 'image') out.push({ kind: 'pic', text: '[Picture' + (n.attrs && n.attrs.alt ? ': ' + n.attrs.alt : '') + ']' })
      else if (n.type === 'horizontalRule') out.push({ kind: 'hr', text: '' })
      else if (n.type === 'tableRow') out.push({ kind: 'row', text: (n.content || []).map((c) => (c.content || []).map((p) => inline(p.content)).join(' ')).join(' | ') })
      else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') walk(n.content, true)
      else walk(n.content, list)
    }
  }
  walk(json && json.content, false)
  return out
}

// The longest common subsequence of two lists, as pairs of indices.
function common (a, b, same) {
  const n = a.length
  const m = b.length
  if (n * m > MAX_CELLS) return null
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = same(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const pairs = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (same(a[i], b[j])) { pairs.push([i, j]); i++; j++ } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}

// Word by word: [{ text, op: 'same' | 'add' | 'del' }].
export function diffWords (before, after) {
  const a = before.split(/(\s+)/).filter(Boolean)
  const b = after.split(/(\s+)/).filter(Boolean)
  const pairs = common(a, b, (x, y) => x === y)
  if (!pairs) return [...(before ? [{ text: before, op: 'del' }] : []), ...(after ? [{ text: after, op: 'add' }] : [])]
  const out = []
  const push = (text, op) => { const last = out[out.length - 1]; if (last && last.op === op) last.text += text; else out.push({ text, op }) }
  let i = 0
  let j = 0
  for (const [pi, pj] of [...pairs, [a.length, b.length]]) {
    while (i < pi) push(a[i++], 'del')
    while (j < pj) push(b[j++], 'add')
    if (pi < a.length) { push(a[pi], 'same'); i = pi + 1; j = pj + 1 }
  }
  return out
}

// How alike two texts are: shared words over the longer one's, 0 to 1.
function likeness (x, y) {
  const a = x.split(/\s+/).filter(Boolean)
  const b = y.split(/\s+/).filter(Boolean)
  if (!a.length && !b.length) return 1
  const seen = new Map()
  for (const w of a) seen.set(w, (seen.get(w) || 0) + 1)
  let shared = 0
  for (const w of b) if (seen.get(w) > 0) { shared++; seen.set(w, seen.get(w) - 1) }
  return shared / Math.max(a.length, b.length)
}

// The newer version's blocks with the changes from the older one:
// [{ kind, op: 'same' | 'add' | 'del' | 'changed', parts }].
export function diffVersions (beforeJson, afterJson) {
  const a = beforeJson ? blocksOf(beforeJson) : []
  const b = blocksOf(afterJson)
  const pairs = common(a, b, (x, y) => x.kind === y.kind && x.text === y.text) || []
  const out = []
  let i = 0
  let j = 0
  for (const [pi, pj] of [...pairs, [a.length, b.length]]) {
    // Between two kept blocks: removed ones and added ones. A removed block
    // is paired with an added one of the same kind sharing most of its
    // words (an edited paragraph), in order; the rest stay removed or added.
    const dels = a.slice(i, pi)
    const adds = b.slice(j, pj)
    const match = new Map() // add index -> del index
    let after = 0
    dels.forEach((d, di) => {
      let best = -1
      let score = 0.4
      for (let k = after; k < adds.length; k++) {
        if (adds[k].kind !== d.kind) continue
        const s = likeness(d.text, adds[k].text)
        if (s >= score) { score = s; best = k }
      }
      if (best >= 0) { match.set(best, di); after = best + 1 }
    })
    const paired = new Set(match.values())
    dels.forEach((d, di) => { if (!paired.has(di)) out.push({ kind: d.kind, op: 'del', parts: [{ text: d.text, op: 'del' }] }) })
    adds.forEach((x, k) => {
      if (match.has(k)) out.push({ kind: x.kind, op: 'changed', parts: diffWords(dels[match.get(k)].text, x.text) })
      else out.push({ kind: x.kind, op: 'add', parts: [{ text: x.text, op: 'add' }] })
    })
    if (pi < a.length) out.push({ kind: b[pj].kind, op: 'same', parts: [{ text: b[pj].text, op: 'same' }] })
    i = pi + 1
    j = pj + 1
  }
  return out
}
