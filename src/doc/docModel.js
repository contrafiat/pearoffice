// A document inside its Yjs doc (proposals/2026-10-06-documents.md, "Inside
// the Yjs doc"): `meta` (title, kind 'doc', schema version) and `body`, a
// Y.XmlFragment in the editor's schema. The editor (TipTap's Collaboration
// extension, field 'body') reads and writes `body` directly.
//
// Versions: 1 is the first schema; 2 adds pictures (image nodes,
// proposals/2026-10-06-document-images.md). A document becomes 2 when its
// first picture goes in, so documents without pictures still open in
// builds that know only 1. 3 adds @ chips (chip nodes,
// proposals/2026-10-26-document-chips.md), the same way. VERSION is the
// newest this build knows.

const Y = require('yjs')

const VERSION = 3
const FIRST_VERSION = 1
const PICTURES_VERSION = 2
const CHIPS_VERSION = 3
const FIELD = 'body'
const IMAGE = 'image'

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
    meta.set('version', FIRST_VERSION)
  })
}

function body (doc) {
  return doc.getXmlFragment(FIELD)
}

function version (doc) {
  return doc.getMap('meta').get('version') || FIRST_VERSION
}

// Raise the schema version to at least `v`. Call inside a transaction.
function raiseVersion (doc, v) {
  const meta = doc.getMap('meta')
  if ((meta.get('version') || FIRST_VERSION) < v) meta.set('version', v)
}

// Every image node in the body, in document order.
function images (doc) {
  const out = []
  const walk = (node) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue
      if (child.nodeName === IMAGE) out.push(child)
      else walk(child)
    }
  }
  walk(body(doc))
  return out
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

module.exports = { VERSION, FIRST_VERSION, PICTURES_VERSION, CHIPS_VERSION, FIELD, IMAGE, capture, initDoc, body, version, raiseVersion, images, plainText }
