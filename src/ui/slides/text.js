// Text on slides without a live editor: the boxes nobody is typing in and
// the slide list draw their text from the Yjs fragment as plain DOM, in the
// same schema the editor uses (src/ui/doc/extensions.js, slideExtensions).
// Also the undo history shared by the deck and its text editors.

import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { yXmlFragmentToProseMirrorRootNode, ySyncPluginKey, defaultDeleteFilter, defaultProtectedNodes } from '@tiptap/y-tiptap'
import { slideExtensions } from '../doc/extensions.js'
import { plainOf } from '../../slides/slidesModel.js'

let schema = null
export function slideSchema () {
  if (!schema) schema = getSchema(slideExtensions())
  return schema
}

// The fragment's content as DOM nodes, or null when it is empty or cannot be
// read in this schema.
export function fragmentDom (fragment) {
  if (!(fragment instanceof Y.XmlFragment) || fragment.length === 0) return null
  try {
    const node = yXmlFragmentToProseMirrorRootNode(fragment, slideSchema())
    if (!node.textContent && node.childCount <= 1) return null
    return DOMSerializer.fromSchema(slideSchema()).serializeFragment(node.content)
  } catch { return null }
}

export function isEmptyFragment (fragment) {
  return !(fragment instanceof Y.XmlFragment) || plainOf(fragment).trim() === ''
}

// This editor's own changes to the deck carry this origin, so the undo
// history takes them and nothing from anyone else.
export const LOCAL = 'slides-local'

// One history for the deck: slides, boxes, frames and every box's text and
// notes. TipTap's undo plugin is handed this manager (yUndoOptions); it
// would destroy it whenever an editor closes, so each editor gets a stand-in
// whose destroy only takes back the listeners that editor added.
export function deckUndo (ydoc) {
  return new Y.UndoManager([ydoc.getMap('slides'), ydoc.getMap('deck')], {
    trackedOrigins: new Set([LOCAL, ySyncPluginKey]),
    captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
    deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes)
  })
}

export function undoForEditor (um) {
  const added = []
  return new Proxy(um, {
    get (target, prop) {
      if (prop === 'destroy') return () => { for (const [name, fn] of added.splice(0)) target.off(name, fn) }
      if (prop === 'on') return (name, fn) => { added.push([name, fn]); target.on(name, fn) }
      if (prop === 'restore') return undefined
      const v = Reflect.get(target, prop)
      return typeof v === 'function' ? v.bind(target) : v
    },
    set (target, prop, value) {
      if (prop === 'restore') return true // TipTap's put back after destroy: not needed
      return Reflect.set(target, prop, value)
    }
  })
}
