// A document inside its Yjs doc (proposals/2026-10-06-documents.md, "Inside
// the Yjs doc"): `meta` (title, kind 'doc', schema version) and `body`, a
// Y.XmlFragment in the editor's schema. The editor (TipTap's Collaboration
// extension, field 'body') reads and writes `body` directly.

const Y = require('yjs')

const VERSION = 1
const FIELD = 'body'

function capture (doc, fn) {
  let update = null
  const onUpdate = (u, origin) => { if (origin === 'local') update = u }
  doc.on('update', onUpdate)
  try {
    doc.transact(fn, 'local')
  } finally {
    doc.off('update', onUpdate)
  }
  return update
}

function initDoc (doc, { title = 'Untitled document' } = {}) {
  return capture(doc, () => {
    const meta = doc.getMap('meta')
    meta.set('title', title)
    meta.set('kind', 'doc')
    meta.set('version', VERSION)
  })
}

function body (doc) {
  return doc.getXmlFragment(FIELD)
}

function version (doc) {
  return doc.getMap('meta').get('version') || VERSION
}

// The body as plain text, one line per block (paragraph, heading, list item,
// table cell), for tests and the file list.
function plainText (doc) {
  const lines = []
  const walk = (node) => {
    if (node instanceof Y.XmlText) return node.toDelta().map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('')
    let text = ''
    let blocks = false
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) text += walk(child)
      else { blocks = true; const t = walk(child); if (t !== null) lines.push(t) }
    }
    return blocks ? null : text
  }
  for (const child of body(doc).toArray()) {
    const t = walk(child)
    if (t !== null) lines.push(t)
  }
  return lines.join('\n')
}

module.exports = { VERSION, FIELD, initDoc, body, version, plainText }
