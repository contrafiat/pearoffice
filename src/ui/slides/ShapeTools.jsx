import React, { useState } from 'react'
import { PaintBucket, PencilSimpleLine, AlignTopSimple, AlignCenterVerticalSimple, AlignBottomSimple } from '@phosphor-icons/react'
import { ShapeIcon, SHAPE_LABELS, INSERT_SHAPES } from './objects.jsx'

// The Insert shape menu, plus fill, outline colour, outline width, their
// opacity and a line's arrowheads for the selected shapes, plus where text
// sits in a box. Desktop only: phones draw shapes but do not style them
// (proposals/2026-10-06-slides.md, decision 5, and
// 2026-10-06-slides-followups.md).

const SLOTS = [['text', 'Theme text'], ['background', 'Theme background'], ['accent1', 'Accent 1'], ['accent2', 'Accent 2'], ['accent3', 'Accent 3'], ['accent4', 'Accent 4'], ['accent5', 'Accent 5'], ['accent6', 'Accent 6']]
const FIXED = ['#000000', '#7f7f7f', '#ffffff', '#d32f2f', '#f57c00', '#fbc02d', '#388e3c', '#1976d2', '#7b1fa2']
const WIDTHS = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24]
const OPACITIES = [1, 0.75, 0.5, 0.25]
const ENDS = [['none', 'None'], ['arrow', 'Arrow'], ['triangle', 'Triangle'], ['oval', 'Circle']]
const ANCHORS = [['top', 'Top', AlignTopSimple], ['middle', 'Middle', AlignCenterVerticalSimple], ['bottom', 'Bottom', AlignBottomSimple]]

// A stored colour as the theme shows it, for swatches outside the slide.
export function colourOf (theme, c) {
  if (c === 'text') return theme.text
  if (c === 'background') return theme.background
  const m = /^accent([1-6])$/.exec(c || '')
  if (m) return theme.accents[Number(m[1]) - 1]
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : null
}

const pop = (button) => {
  const r = button.getBoundingClientRect()
  return { top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - 260)) }
}

// Top, middle and bottom: where the text sits in the selected boxes.
// `value` is the anchor they share, or null.
export function AnchorButtons ({ btn, value, disabled, onPick }) {
  return ANCHORS.map(([v, label, Icon]) => (
    <React.Fragment key={v}>{btn('Text at the ' + label.toLowerCase(), Icon, value === v, () => onPick(v), { disabled, className: 'anchor-' + v + (value === v ? ' on' : '') })}</React.Fragment>
  ))
}

// The Insert shape button and its menu of six shapes.
export function InsertShape ({ btn, Icon, disabled, onPick }) {
  const [at, setAt] = useState(null)
  return (
    <>
      {btn('Insert a shape', Icon, undefined, (e) => setAt(at ? null : pop(e.currentTarget)), { disabled, className: 'add-shape', 'aria-haspopup': 'menu' })}
      {at && <div className='doc-scrim' onMouseDown={() => setAt(null)} />}
      {at && (
        <span className='shape-menu doc-pop' role='menu' style={{ position: 'fixed', top: at.top, left: at.left }}>
          {INSERT_SHAPES.map((shape) => (
            <button key={shape} role='menuitem' className={'shape-' + shape} title={SHAPE_LABELS[shape]} aria-label={SHAPE_LABELS[shape]} onMouseDown={(e) => e.preventDefault()} onClick={() => { setAt(null); onPick(shape) }}>
              <ShapeIcon shape={shape} size={22} />
            </button>
          ))}
        </span>
      )}
    </>
  )
}

// shapes: the selected shape elements ({ id, style }). setStyle(fn) sets
// each one's fill, line and lineW to fn(el); setOpacity and setArrows take
// { fill, line } and { head, tail } for all of them.
export function ShapeTools ({ shapes, theme, phone, setStyle, setOpacity, setArrows }) {
  const [menu, setMenu] = useState(null) // { kind: 'fill' | 'line', top, left }
  const same = (k) => (shapes.every((el) => el.style[k] === shapes[0].style[k]) ? shapes[0].style[k] : null)
  const fill = same('fill')
  const line = same('line')
  const lineW = same('lineW')
  const head = same('head')
  const tail = same('tail')
  const onlyLines = shapes.every((el) => el.style.shape === 'line')
  const open = (kind, button) => setMenu(menu && menu.kind === kind ? null : { kind, ...pop(button) })
  const ICON = phone ? 20 : 18

  // Picking an outline colour on a shape with no outline gives it one, and
  // a width on a shape with no outline colour gives it the text colour.
  const pick = (c) => {
    const kind = menu.kind
    setMenu(null)
    if (kind === 'fill') setStyle(() => ({ fill: c }))
    else setStyle((el) => (c !== 'none' && !el.style.lineW ? { line: c, lineW: 4 } : { line: c }))
  }
  const width = (w) => setStyle((el) => (w > 0 && el.style.line === 'none' ? { lineW: w, line: 'text' } : { lineW: w }))

  const swatch = (kind, label, Icon, c) => {
    const shown = colourOf(theme, c)
    return (
      <button title={label} aria-label={label} className={'swatch-button shape-' + kind} onMouseDown={(e) => e.preventDefault()} onClick={(e) => open(kind, e.currentTarget)}>
        <span className='icon-swatch'><Icon size={ICON} /><span className={'swatch-bar' + (shown ? '' : ' none')} style={{ background: shown || 'transparent' }} /></span>
      </button>
    )
  }

  return (
    <>
      {!onlyLines && swatch('fill', 'Fill colour', PaintBucket, fill)}
      {swatch('line', 'Outline colour', PencilSimpleLine, line)}
      <select aria-label='Outline width' title='Outline width' className='line-width' value={lineW === null ? '' : String(lineW)} onChange={(e) => width(Number(e.target.value))}>
        {lineW === null && <option value=''>Mixed</option>}
        {(WIDTHS.includes(lineW) || lineW === null ? WIDTHS : [...WIDTHS, lineW].sort((a, b) => a - b)).map((w) => <option key={w} value={String(w)}>{w ? w + ' pt' : 'None'}</option>)}
      </select>
      {menu && <div className='doc-scrim' onMouseDown={() => setMenu(null)} />}
      {menu && (
        <span className={'palette shape-palette doc-pop ' + menu.kind + '-palette'} role='menu' style={{ position: 'fixed', top: menu.top, left: menu.left }}>
          <span className='palette-row'>
            {SLOTS.map(([c, label]) => (
              <button key={c} className={'swatch slot-' + c} style={{ background: colourOf(theme, c) }} title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)} />
            ))}
          </span>
          <span className='palette-row'>
            {FIXED.map((c) => (
              <button key={c} className='swatch' style={{ background: c }} title={c} aria-label={c} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)} />
            ))}
            <button className='swatch none' title='None' aria-label='None' onMouseDown={(e) => e.preventDefault()} onClick={() => pick('none')}>×</button>
          </span>
          <span className='palette-row opacity-row' role='group' aria-label='Opacity'>
            {OPACITIES.map((v) => {
              const key = menu.kind === 'fill' ? 'fillOpacity' : 'lineOpacity'
              const on = same(key) === v
              return (
                <button key={v} className={'opacity-button opacity-' + Math.round(v * 100) + (on ? ' on' : '')} aria-pressed={on} title={'Opacity ' + Math.round(v * 100) + '%'} onMouseDown={(e) => e.preventDefault()} onClick={() => { const kind = menu.kind; setMenu(null); setOpacity({ [kind]: v }) }}>
                  {Math.round(v * 100)}%
                </button>
              )
            })}
          </span>
        </span>
      )}
      {onlyLines && (
        <>
          <select aria-label='Line start' title='Line start' className='line-head' value={head === null ? '' : head} onChange={(e) => setArrows({ head: e.target.value })}>
            {head === null && <option value=''>Mixed</option>}
            {ENDS.map(([v, label]) => <option key={v} value={v}>{'Start: ' + label}</option>)}
          </select>
          <select aria-label='Line end' title='Line end' className='line-tail' value={tail === null ? '' : tail} onChange={(e) => setArrows({ tail: e.target.value })}>
            {tail === null && <option value=''>Mixed</option>}
            {ENDS.map(([v, label]) => <option key={v} value={v}>{'End: ' + label}</option>)}
          </select>
        </>
      )}
    </>
  )
}
