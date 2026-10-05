// One column's filter (proposals/2026-10-04-freeze-filter.md): sort, a
// checklist of its values with a search box, and a condition. The filter is
// this device's own; sorting is an ordinary shared sort.

import React, { useEffect, useRef, useState } from 'react'
import { X, SortAscending, SortDescending } from '@phosphor-icons/react'

const CONDITIONS = [
  ['', 'No condition'],
  ['eq', 'Equals'],
  ['ne', 'Does not equal'],
  ['contains', 'Contains'],
  ['begins', 'Starts with'],
  ['ends', 'Ends with'],
  ['gt', 'Greater than'],
  ['lt', 'Less than'],
  ['between', 'Between'],
  ['top', 'Top (how many)']
]

export function FilterPanel ({ title, values, rule, canSort, onSort, onApply, onClose }) {
  const all = values.map((v) => v.value)
  const [checked, setChecked] = useState(() => new Set(rule && Array.isArray(rule.values) ? rule.values : all))
  const [search, setSearch] = useState('')
  const [op, setOp] = useState((rule && rule.cond && rule.cond.op) || '')
  const [a, setA] = useState((rule && rule.cond && rule.cond.a) || (op === 'top' ? '10' : ''))
  const [b, setB] = useState((rule && rule.cond && rule.cond.b) || '')
  const searchRef = useRef(null)
  useEffect(() => { if (searchRef.current && !('ontouchstart' in window)) searchRef.current.focus() }, [])

  const q = search.trim().toLowerCase()
  const listed = values.filter((v) => !q || v.value.toLowerCase().includes(q))
  const allListed = listed.length > 0 && listed.every((v) => checked.has(v.value))
  const flip = (value) => setChecked((s) => { const n = new Set(s); if (n.has(value)) n.delete(value); else n.add(value); return n })
  const flipAll = () => setChecked((s) => { const n = new Set(s); for (const v of listed) { if (allListed) n.delete(v.value); else n.add(v.value) } return n })

  function apply () {
    // With a search, only the checked values it found are kept (as Excel).
    const chosen = all.filter((v) => checked.has(v) && (!q || v.toLowerCase().includes(q)))
    const next = {}
    if (chosen.length !== all.length) next.values = chosen
    if (op) next.cond = op === 'between' ? { op, a, b } : { op, a }
    onApply(next.values || next.cond ? next : null)
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label='Filter'>
        <header>
          <h2>Filter {title}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        {canSort && (
          <div className='row'>
            <button onClick={() => onSort(false)}><SortAscending size={16} /> A to Z</button>
            <button onClick={() => onSort(true)}><SortDescending size={16} /> Z to A</button>
          </div>
        )}
        <input ref={searchRef} type='search' placeholder='Search values' aria-label='Search values' value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') onClose() }} />
        <div className='filter-values'>
          <label className='check'><input type='checkbox' checked={allListed} onChange={flipAll} /> {q ? 'All found' : 'All'}</label>
          {listed.map((v) => (
            <label className='check' key={v.value}>
              <input type='checkbox' checked={checked.has(v.value)} onChange={() => flip(v.value)} />
              <span>{v.value === '' ? '(Blanks)' : v.value}</span>
              <span className='count'>{v.count}</span>
            </label>
          ))}
          {!listed.length && <p className='muted'>No values match.</p>}
        </div>
        <div className='row filter-cond'>
          <select aria-label='Condition' value={op} onChange={(e) => { setOp(e.target.value); if (e.target.value === 'top' && !a) setA('10') }}>
            {CONDITIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {op && <input aria-label={op === 'between' ? 'From' : 'Value'} inputMode={['gt', 'lt', 'between', 'top'].includes(op) ? 'decimal' : undefined} value={a} onChange={(e) => setA(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply() }} />}
          {op === 'between' && <input aria-label='To' inputMode='decimal' value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply() }} />}
        </div>
        <div className='row end'>
          <button onClick={() => onApply(null)}>Clear</button>
          <button className='primary' onClick={apply}>Apply</button>
        </div>
      </section>
    </div>
  )
}
