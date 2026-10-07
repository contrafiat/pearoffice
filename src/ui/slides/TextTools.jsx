import React, { useState } from 'react'
import { useEditorState } from '@tiptap/react'
import {
  TextB, TextItalic, TextUnderline, TextStrikethrough, TextAUnderline, Highlighter,
  ListBullets, ListNumbers, LinkSimple
} from '@phosphor-icons/react'
import { COLOURS, HIGHLIGHTS, ALIGNS, LinkBar } from '../doc/DocView.jsx'

// Formatting for the text being edited: a slide's text box or its speaker
// notes. The notes take only bold, italic and lists; the rest is greyed out
// there. Built from the document toolbar's parts (src/ui/doc/DocView.jsx).

const FONTS = [['', 'Theme'], ['sans-serif', 'Sans'], ['serif', 'Serif'], ['monospace', 'Mono']]
export const SLIDE_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 88, 96] // points

// afterAlign: more buttons after Alignment (where text sits in its box).
export function TextTools ({ editor: given, defaultSize, phone, btn, afterAlign }) {
  const editor = given && !given.isDestroyed ? given : null
  const s = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed || !ed.view || !ed.state) return null
      const has = (name) => !!ed.schema.marks[name]
      const ts = ed.getAttributes('textStyle')
      return {
        rich: has('textStyle'),
        font: ts.fontFamily || '',
        size: ts.fontSize ? String(parseFloat(ts.fontSize)) : String(defaultSize),
        color: ts.color || null,
        highlight: has('highlight') ? ed.getAttributes('highlight').color || null : null,
        bold: ed.isActive('bold'),
        italic: ed.isActive('italic'),
        underline: ed.isActive('underline'),
        strike: ed.isActive('strike'),
        align: ed.state.selection.$from.parent.attrs.textAlign || 'left',
        bullet: ed.isActive('bulletList'),
        ordered: ed.isActive('orderedList'),
        link: ed.isActive('link'),
        href: ed.getAttributes('link').href || ''
      }
    }
  })
  const [menu, setMenu] = useState(null) // { kind, top, left }
  const [linking, setLinking] = useState(null)
  const off = !editor || !s
  const rich = !off && s.rich
  const openMenu = (kind, button) => {
    if (menu && menu.kind === kind) { setMenu(null); return }
    const r = button.getBoundingClientRect()
    setMenu({ kind, top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - 200)) })
  }
  const run = (fn) => { setMenu(null); fn(editor.chain().focus()).run() }
  const AlignIcon = (ALIGNS.find((a) => a[0] === (s && s.align)) || ALIGNS[0])[2]
  const size = s ? s.size : String(defaultSize)
  const sizes = SLIDE_SIZES.includes(Number(size)) ? SLIDE_SIZES : [...SLIDE_SIZES, Number(size)].sort((a, b) => a - b)
  const swatch = (kind, label, Icon, colour) => (
    <button title={label} aria-label={label} className='swatch-button' disabled={!rich} onMouseDown={(e) => e.preventDefault()} onClick={(e) => openMenu(kind, e.currentTarget)}>
      <span className='icon-swatch'><Icon size={phone ? 20 : 18} /><span className='swatch-bar' style={{ background: colour || (kind === 'color' ? 'currentColor' : 'transparent') }} /></span>
    </button>
  )

  return (
    <>
      <select aria-label='Font' title='Font' className='font-select' disabled={!rich} value={s ? s.font : ''} onChange={(e) => run((c) => (e.target.value ? c.setFontFamily(e.target.value) : c.unsetFontFamily()))}>
        {FONTS.map(([v, label]) => <option key={label} value={v}>{label}</option>)}
      </select>
      <select aria-label='Font size' title='Font size' className='size-select' disabled={!rich} value={size} onChange={(e) => run((c) => (Number(e.target.value) === defaultSize ? c.unsetFontSize() : c.setFontSize(e.target.value + 'pt')))}>
        {sizes.map((n) => <option key={n} value={String(n)}>{n}</option>)}
      </select>
      <span className='sep' />
      {btn('Bold (Ctrl+B)', TextB, s && s.bold, () => run((c) => c.toggleBold()), { disabled: off, className: 'fmt-b' + (s && s.bold ? ' on' : '') })}
      {btn('Italic (Ctrl+I)', TextItalic, s && s.italic, () => run((c) => c.toggleItalic()), { disabled: off })}
      {btn('Underline (Ctrl+U)', TextUnderline, s && s.underline, () => run((c) => c.toggleUnderline()), { disabled: !rich })}
      {btn('Strikethrough', TextStrikethrough, s && s.strike, () => run((c) => c.toggleStrike()), { disabled: !rich })}
      {swatch('color', 'Text colour', TextAUnderline, s && s.color)}
      {swatch('highlight', 'Highlight', Highlighter, s && s.highlight)}
      <span className='sep' />
      {btn('Alignment', AlignIcon, undefined, (e) => openMenu('align', e.currentTarget), { disabled: !rich, 'aria-haspopup': 'menu', className: 'align-button' })}
      {afterAlign}
      {btn('Bulleted list', ListBullets, s && s.bullet, () => run((c) => c.toggleBulletList()), { disabled: off })}
      {btn('Numbered list', ListNumbers, s && s.ordered, () => run((c) => c.toggleOrderedList()), { disabled: off })}
      {btn('Link (Ctrl+K)', LinkSimple, s && s.link, () => setLinking(linking === null ? s.href : null), { disabled: !rich })}
      {menu && <div className='doc-scrim' onMouseDown={() => setMenu(null)} />}
      {menu && (menu.kind === 'color' || menu.kind === 'highlight') && (
        <span className='palette doc-pop' role='menu' style={{ position: 'fixed', top: menu.top, left: menu.left }}>
          {(menu.kind === 'color' ? COLOURS : HIGHLIGHTS).map((c) => (
            <button key={c} className='swatch' style={{ background: c }} title={c} aria-label={c} onMouseDown={(e) => e.preventDefault()} onClick={() => run((ch) => (menu.kind === 'color' ? ch.setColor(c) : ch.setHighlight({ color: c })))} />
          ))}
          <button className='swatch none' title='None' aria-label='None' onMouseDown={(e) => e.preventDefault()} onClick={() => run((ch) => (menu.kind === 'color' ? ch.unsetColor() : ch.unsetHighlight()))}>×</button>
        </span>
      )}
      {menu && menu.kind === 'align' && (
        <ul className='menu doc-pop' role='menu' style={{ top: menu.top, left: menu.left }}>
          {ALIGNS.map(([v, label, Icon]) => (
            <li key={v} role='menuitemradio' aria-checked={s && s.align === v} className={'align-' + v + (s && s.align === v ? ' on' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => run((c) => c.setTextAlign(v))}><Icon size={16} /> {label}</li>
          ))}
        </ul>
      )}
      {linking !== null && rich && <div className='slides-link'><LinkBar editor={editor} initial={linking} onClose={() => setLinking(null)} /></div>}
    </>
  )
}
