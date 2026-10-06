// Data validation (proposals/2026-10-04-sheet-tools.md): set what a range
// allows, or remove its rules.

import React, { useState } from 'react'
import { X } from '@phosphor-icons/react'

const KINDS = [
  ['list', 'A list of items'],
  ['whole', 'Whole numbers'],
  ['decimal', 'Numbers'],
  ['date', 'Dates'],
  ['time', 'Times'],
  ['length', 'Text of a length']
]
const OPS = [
  ['between', 'between'],
  ['notBetween', 'not between'],
  ['eq', 'equal to'],
  ['ne', 'not equal to'],
  ['gt', 'greater than'],
  ['lt', 'less than'],
  ['ge', 'at least'],
  ['le', 'at most']
]
const HINT = { date: 'yyyy-mm-dd', time: 'hh:mm' }

export function ValidationPanel ({ range, rule, onSave, onRemove, onClose }) {
  const [kind, setKind] = useState((rule && rule.kind) || 'list')
  const [fromRange, setFromRange] = useState(!!(rule && rule.source))
  const [items, setItems] = useState(rule && rule.items && !rule.source ? rule.items.join('\n') : '')
  const [source, setSource] = useState((rule && rule.source) || '')
  const [dropdown, setDropdown] = useState(!rule || rule.dropdown !== false)
  const [op, setOp] = useState((rule && rule.op) || 'between')
  const [a, setA] = useState((rule && rule.a) || '')
  const [b, setB] = useState((rule && rule.b) || '')
  const [onBad, setOnBad] = useState((rule && rule.onBad) || 'stop')
  const [message, setMessage] = useState((rule && rule.message) || '')
  const two = op === 'between' || op === 'notBetween'

  function save () {
    const out = { kind, onBad }
    if (message.trim()) out.message = message.trim()
    if (kind === 'list') {
      if (fromRange) out.source = source
      else out.items = items
      out.dropdown = dropdown
    } else {
      out.op = op
      out.a = a
      if (two) out.b = b
    }
    onSave(out)
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label='Validation'>
        <header>
          <h2>Allowed in {range}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <select aria-label='Allow' value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {kind === 'list' && (
          <>
            <div className='row'>
              <label className='check'><input type='radio' name='list-from' checked={!fromRange} onChange={() => setFromRange(false)} /> Items I type</label>
              <label className='check'><input type='radio' name='list-from' checked={fromRange} onChange={() => setFromRange(true)} /> Items in a range</label>
            </div>
            {fromRange
              ? <input aria-label='Range with the items' placeholder='For example D1:D10' value={source} onChange={(e) => setSource(e.target.value)} />
              : <textarea aria-label='Items' rows={4} placeholder='One item per line' value={items} onChange={(e) => setItems(e.target.value)} />}
            <label className='check'><input type='checkbox' checked={dropdown} onChange={(e) => setDropdown(e.target.checked)} /> Show a dropdown in the cell</label>
          </>
        )}
        {kind !== 'list' && (
          <div className='row'>
            <select aria-label='Comparison' value={op} onChange={(e) => setOp(e.target.value)}>
              {OPS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <input aria-label={two ? 'From' : 'Value'} placeholder={HINT[kind] || ''} inputMode={kind === 'date' || kind === 'time' ? undefined : 'decimal'} value={a} onChange={(e) => setA(e.target.value)} />
            {two && <input aria-label='To' placeholder={HINT[kind] || ''} inputMode={kind === 'date' || kind === 'time' ? undefined : 'decimal'} value={b} onChange={(e) => setB(e.target.value)} />}
          </div>
        )}
        <div className='row'>
          <span className='small'>Other entries</span>
          <select aria-label='Other entries' value={onBad} onChange={(e) => setOnBad(e.target.value)}>
            <option value='stop'>are refused</option>
            <option value='warn'>get a warning</option>
          </select>
        </div>
        <input aria-label='Message' placeholder='Message to show (optional)' value={message} maxLength={255} onChange={(e) => setMessage(e.target.value)} />
        <div className='row end'>
          {rule && <button className='danger' onClick={onRemove}>Remove</button>}
          <button onClick={onClose}>Cancel</button>
          <button className='primary' onClick={save}>Save</button>
        </div>
      </section>
    </div>
  )
}
