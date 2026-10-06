// Sort a range by up to three of its columns.

import React, { useState } from 'react'
import { X, Plus } from '@phosphor-icons/react'
import { colName } from './a1.js'

export function SortPanel ({ range, headerGuess, headerNames, firstKey, onSort, onClose }) {
  const [header, setHeader] = useState(headerGuess)
  const [keys, setKeys] = useState([{ col: firstKey, desc: false }])
  const cols = []
  for (let c = range.c1; c <= range.c2; c++) cols.push(c)
  const label = (c) => (header && headerNames[c] ? headerNames[c] + ' (' + colName(c) + ')' : 'Column ' + colName(c))
  const setKey = (i, patch) => setKeys((ks) => ks.map((k, j) => (j === i ? { ...k, ...patch } : k)))

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label='Sort'>
        <header>
          <h2>Sort {colName(range.c1) + range.r1}:{colName(range.c2) + range.r2}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <label className='check'><input type='checkbox' checked={header} onChange={(e) => setHeader(e.target.checked)} /> The first row is a header</label>
        {keys.map((k, i) => (
          <div className='row sort-key' key={i}>
            <span className='small'>{i === 0 ? 'Sort by' : 'Then by'}</span>
            <select aria-label={(i === 0 ? 'Sort by' : 'Then by') + ' column'} value={k.col} onChange={(e) => setKey(i, { col: Number(e.target.value) })}>
              {cols.map((c) => <option key={c} value={c}>{label(c)}</option>)}
            </select>
            <select aria-label='Order' value={k.desc ? 'desc' : 'asc'} onChange={(e) => setKey(i, { desc: e.target.value === 'desc' })}>
              <option value='asc'>A to Z, smallest first</option>
              <option value='desc'>Z to A, largest first</option>
            </select>
          </div>
        ))}
        {keys.length < 3 && cols.length > keys.length && (
          <div className='row'>
            <button onClick={() => setKeys((ks) => [...ks, { col: cols.find((c) => !ks.some((k) => k.col === c)), desc: false }])}><Plus size={16} /> Add another column</button>
          </div>
        )}
        <div className='row end'>
          <button onClick={onClose}>Cancel</button>
          <button className='primary' onClick={() => onSort({ keys, header })}>Sort</button>
        </div>
      </section>
    </div>
  )
}
