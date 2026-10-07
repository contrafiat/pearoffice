// Editor extensions of our own: paragraph formats kept as attributes on
// paragraphs and headings (indent, line spacing, space after, Title and
// Subtitle), and find and replace over the text.

import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color, FontSize, FontFamily } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'

export const MAX_INDENT = 8
export const LINE_HEIGHTS = ['1', '1.15', '1.5', '2']
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36] // points
const BLOCKS = ['paragraph', 'heading']

// Set an attribute on every paragraph and heading in the selection.
function eachBlock (state, tr, fn) {
  const { from, to } = state.selection
  let changed = false
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!BLOCKS.includes(node.type.name)) return true
    const attrs = fn(node.attrs, node)
    if (attrs) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }); changed = true }
    return false
  })
  return changed
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  priority: 50, // after lists and tables, which use Tab themselves

  addGlobalAttributes () {
    return [
      {
        types: BLOCKS,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Math.max(0, Math.min(MAX_INDENT, parseInt(el.getAttribute('data-indent'), 10) || 0)),
            renderHTML: (a) => (a.indent > 0 ? { 'data-indent': a.indent, style: 'margin-left: ' + a.indent * 2 + 'em' } : {})
          },
          lineHeight: {
            default: null,
            parseHTML: (el) => (LINE_HEIGHTS.includes(el.style.lineHeight) ? el.style.lineHeight : null),
            renderHTML: (a) => (a.lineHeight ? { style: 'line-height: ' + a.lineHeight } : {})
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => (el.getAttribute('data-space-after') === 'none' ? 'none' : null),
            renderHTML: (a) => (a.spaceAfter === 'none' ? { 'data-space-after': 'none' } : {})
          }
        }
      },
      {
        // Title and Subtitle are paragraph styles, as in Google Docs.
        types: ['paragraph'],
        attributes: {
          blockStyle: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => (['title', 'subtitle'].includes(el.getAttribute('data-style')) ? el.getAttribute('data-style') : null),
            renderHTML: (a) => (a.blockStyle ? { 'data-style': a.blockStyle } : {})
          }
        }
      }
    ]
  },

  addCommands () {
    return {
      indent: (delta) => ({ state, tr, dispatch }) => {
        const ok = eachBlock(state, tr, (a) => {
          const n = Math.max(0, Math.min(MAX_INDENT, (a.indent || 0) + delta))
          return n === (a.indent || 0) ? null : { indent: n }
        })
        if (ok && dispatch) dispatch(tr)
        return ok
      },
      setLineHeight: (value) => ({ state, tr, dispatch }) => {
        const v = LINE_HEIGHTS.includes(value) && value !== '1.15' ? value : null
        const ok = eachBlock(state, tr, (a) => (a.lineHeight === v ? null : { lineHeight: v }))
        if (ok && dispatch) dispatch(tr)
        return true
      },
      toggleSpaceAfter: () => ({ state, tr, dispatch }) => {
        const $from = state.selection.$from
        const now = $from.parent.attrs.spaceAfter === 'none'
        eachBlock(state, tr, () => ({ spaceAfter: now ? null : 'none' }))
        if (dispatch) dispatch(tr)
        return true
      },
      // 'normal', 'title', 'subtitle' or 'h1' to 'h3'.
      setBlockStyle: (style) => ({ chain }) => {
        if (/^h[1-3]$/.test(style)) return chain().setHeading({ level: Number(style[1]) }).run()
        return chain().setParagraph().updateAttributes('paragraph', { blockStyle: style === 'normal' ? null : style }).run()
      }
    }
  },

  addKeyboardShortcuts () {
    const inList = () => this.editor.isActive('listItem') || this.editor.isActive('taskItem')
    return {
      Tab: () => {
        if (this.editor.isActive('table')) return false
        if (inList()) return true // the list could not go deeper; stay in the editor
        return this.editor.commands.indent(1) || true
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table')) return false
        if (inList()) return true
        return this.editor.commands.indent(-1) || true
      }
    }
  }
})

// --- pictures -----------------------------------------------------------------

// A picture (proposals/2026-10-06-document-images.md): a block node holding a
// reference to the bytes in a picture core (src/worklet/pictures.js), never
// the bytes. w and h are the picture's pixels, so the page lays out before
// it arrives; width is a percentage of the page (null: natural size); align
// is left, center or right. Needs document schema version 2.
export const PICTURE_ALIGNS = ['left', 'center', 'right']
const num = (v) => { const n = parseInt(v, 10); return n > 0 ? n : null }
const attr = (name, parse = (v) => v || null) => ({
  default: null,
  parseHTML: (el) => parse(el.getAttribute('data-' + name)),
  renderHTML: (a) => (a[name] == null ? {} : { ['data-' + name]: a[name] })
})

export const Picture = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes () {
    return {
      ref: attr('ref'),
      hash: attr('hash'),
      mime: attr('mime'),
      w: attr('w', num),
      h: attr('h', num),
      width: {
        default: null,
        parseHTML: (el) => { const n = num(el.getAttribute('data-width')); return n ? Math.max(10, Math.min(100, n)) : null },
        renderHTML: (a) => (a.width ? { 'data-width': a.width } : {})
      },
      align: {
        default: 'center',
        parseHTML: (el) => (PICTURE_ALIGNS.includes(el.getAttribute('data-align')) ? el.getAttribute('data-align') : 'center'),
        renderHTML: (a) => ({ 'data-align': a.align || 'center' })
      },
      alt: {
        default: '',
        parseHTML: (el) => el.getAttribute('alt') || '',
        renderHTML: (a) => (a.alt ? { alt: a.alt } : {})
      }
    }
  },

  parseHTML () {
    return [{ tag: 'img[data-ref]' }]
  },

  renderHTML ({ HTMLAttributes }) {
    return ['img', mergeAttributes({ class: 'doc-picture' }, HTMLAttributes)]
  }
})

// The extensions that make up the document's schema. The editor adds its own
// (Collaboration, cursors, find, placeholder) on top; import and export use
// these alone, so both read and write the same nodes and marks.
export function documentExtensions () {
  return textExtensions({ tables: true, pictures: true })
}

// A slide's text box (proposals/2026-10-06-slides.md, Text boxes): the
// document's schema without headings, tables, code blocks and pictures.
export function slideExtensions () {
  return textExtensions({ starter: { heading: false, codeBlock: false } })
}

// Speaker notes: paragraphs, bold, italic and lists.
export function notesExtensions () {
  return [
    StarterKit.configure({
      undoRedo: false,
      trailingNode: false,
      heading: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      link: false
    })
  ]
}

// Documents and slides share these, in this order.
function textExtensions ({ starter = {}, tables = false, pictures = false }) {
  return [
    StarterKit.configure({
      undoRedo: false, // Collaboration's undo only undoes this person's edits
      trailingNode: false, // it would add a paragraph on every device at once
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      ...starter
    }),
    TextStyle,
    Color,
    FontSize,
    FontFamily,
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    tables && TableKit.configure({ table: { resizable: false } }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript,
    Superscript,
    ParagraphFormat,
    pictures && Picture
  ].filter(Boolean)
}

// --- find and replace -------------------------------------------------------

export const findKey = new PluginKey('find')

function escape (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Every match of `query` in the text, as document positions. Text is read a
// block at a time, so a match can span bold and plain parts of a word.
export function findMatches (doc, query, matchCase) {
  if (!query) return []
  const re = new RegExp(escape(query), matchCase ? 'g' : 'gi')
  const out = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const at = []
    node.forEach((child, offset) => {
      const start = pos + 1 + offset
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) at.push(start + i)
        text += child.text
      } else {
        at.push(start)
        text += '￼'
      }
    })
    re.lastIndex = 0
    let mt
    while ((mt = re.exec(text))) {
      if (!mt[0].length) { re.lastIndex++; continue }
      out.push({ from: at[mt.index], to: at[mt.index + mt[0].length - 1] + 1 })
    }
    return false
  })
  return out
}

const EMPTY = { query: '', matchCase: false, matches: [], index: -1 }

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins () {
    return [new Plugin({
      key: findKey,
      state: {
        init: () => EMPTY,
        apply (tr, prev, _old, state) {
          const meta = tr.getMeta(findKey)
          if (!meta && !tr.docChanged) return prev
          const query = meta && 'query' in meta ? meta.query : prev.query
          const matchCase = meta && 'matchCase' in meta ? meta.matchCase : prev.matchCase
          const matches = findMatches(state.doc, query, matchCase)
          let index = meta && 'index' in meta ? meta.index : prev.index
          if (!matches.length) index = -1
          else if (index < 0 || index >= matches.length) index = 0
          return { query, matchCase, matches, index }
        }
      },
      props: {
        decorations (state) {
          const { matches, index } = findKey.getState(state)
          if (!matches.length) return null
          return DecorationSet.create(state.doc, matches.map((x, i) => Decoration.inline(x.from, x.to, { class: i === index ? 'find-match current' : 'find-match' })))
        }
      }
    })]
  },

  addCommands () {
    return {
      setFind: (opts) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(findKey, opts).setMeta('addToHistory', false))
        return true
      },
      // Move to the next (1) or previous (-1) match and show it.
      findStep: (dir) => ({ state, tr, dispatch }) => {
        const { matches, index } = findKey.getState(state)
        if (!matches.length) return false
        const i = (index + dir + matches.length) % matches.length
        if (dispatch) dispatch(tr.setMeta(findKey, { index: i }).setSelection(TextSelection.create(state.doc, matches[i].from, matches[i].to)).scrollIntoView())
        return true
      },
      replaceMatch: (by) => ({ state, tr, dispatch }) => {
        const { matches, index } = findKey.getState(state)
        if (index < 0) return false
        const m = matches[index]
        if (dispatch) {
          if (by) tr.insertText(by, m.from, m.to)
          else tr.delete(m.from, m.to)
          dispatch(tr.setMeta(findKey, { index }))
        }
        return true
      },
      replaceAll: (by) => ({ state, tr, dispatch }) => {
        const { matches } = findKey.getState(state)
        if (!matches.length) return false
        if (dispatch) {
          for (const m of [...matches].reverse()) {
            if (by) tr.insertText(by, m.from, m.to)
            else tr.delete(m.from, m.to)
          }
          dispatch(tr)
        }
        return true
      }
    }
  }
})

// --- change case --------------------------------------------------------------

export function changeCase (text, mode) {
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'lower') return text.toLowerCase()
  const lower = text.toLowerCase()
  if (mode === 'title') return lower.replace(/(^|[\s\-(["'“‘])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  // Sentence case: the first letter, and the first after . ! or ?
  return lower.replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
}

// Change the case of the selected text, keeping its formatting. Each block is
// changed as a whole (so Sentence case knows where sentences start), then cut
// back into its formatted parts.
export function changeCaseCommand (mode) {
  return ({ state, tr, dispatch }) => {
    const { from, to, empty } = state.selection
    if (empty) return false
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      const parts = []
      node.forEach((child, offset) => {
        if (!child.isText) return
        const start = pos + 1 + offset
        const a = Math.max(from, start)
        const b = Math.min(to, start + child.text.length)
        if (a < b) parts.push({ a, b, text: child.text.slice(a - start, b - start), marks: child.marks })
      })
      const whole = parts.map((p) => p.text).join('')
      const changed = changeCase(whole, mode)
      const same = changed.length === whole.length
      let i = 0
      for (const p of parts) {
        const next = same ? changed.slice(i, i + p.text.length) : changeCase(p.text, mode)
        i += p.text.length
        if (next !== p.text) tr.replaceWith(tr.mapping.map(p.a), tr.mapping.map(p.b), state.schema.text(next, p.marks))
      }
      return false
    })
    if (dispatch) dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from), tr.mapping.map(to))))
    return true
  }
}
