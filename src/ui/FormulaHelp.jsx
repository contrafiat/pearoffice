import React, { useLayoutEffect, useState } from 'react'
import { helpFor, insertFunction } from '../shared/formula/help.js'

export { helpFor, insertFunction }

function Args ({ args, current }) {
  if (!args) return <span className='args'>()</span>
  const parts = args.split(', ')
  const last = parts.length - 1
  const at = current > last && /\.\.\./.test(parts[last]) ? last : current
  return (
    <span className='args'>
      ({parts.map((p, i) => <span key={i}>{i ? ', ' : ''}{i === at ? <b>{p}</b> : p}</span>)})
    </span>
  )
}

// The help panel, placed under the input being edited (above it when there is
// no room, as with a phone keyboard open).
export function FormulaHelp ({ help, selected, onPick, anchor }) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!anchor) return setPos(null)
    const r = anchor.getBoundingClientRect()
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight
    const below = r.bottom + 4
    const room = vh - below
    setPos(room < 180 ? { left: Math.max(4, r.left), bottom: vh - r.top + 4 } : { left: Math.max(4, r.left), top: below })
  }, [anchor, help])
  if (!help || !pos) return null
  return (
    <div className='formula-help' style={pos} role='listbox' aria-label='Formula help' onMouseDown={(e) => e.preventDefault()}>
      {help.list && help.list.map((f, i) => (
        <div
          key={f.name}
          role='option'
          aria-selected={i === selected}
          className={'fh-item' + (i === selected ? ' on' : '')}
          onClick={() => onPick(f.name)}
        >
          <div><span className='fname'>{f.name}</span><Args args={f.args} current={-1} /></div>
          <div className='about'>{f.about}</div>
        </div>
      ))}
      {help.signature && (
        <div className='fh-item sig'>
          <div><span className='fname'>{help.signature.name}</span><Args args={help.signature.args} current={help.arg} /></div>
          <div className='about'>{help.signature.about}</div>
        </div>
      )}
    </div>
  )
}
