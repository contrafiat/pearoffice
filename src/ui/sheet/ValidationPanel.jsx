// Data validation (proposals/2026-10-04-sheet-tools.md): set what a range
// allows, or remove its rules. A list can show as coloured chips
// (proposals/2026-10-22-dropdown-chips.md).

import React, { useState } from 'react'
import { X } from '@phosphor-icons/react'
import { CHIP_NAMES, chipColorAt } from '../../sheet/validation.js'

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
const LOOKS = [
  ['chips', 'Coloured chips'],
  ['arrow', 'Text with an arrow'],
  ['plain', 'Plain text']
]
const lookOf = (rule) => (!rule || rule.kind !== 'list' ? 'chips' : rule.chips ? 'chips' : rule.dropdown === false ? 'plain' : 'arrow')
const splitItems = (text) => [...new Set(String(text).split(/[\n,]/).map((x) => x.trim()).filter(Boolean))]

// initialItems: the values already in the range, offered for a new list.
export function ValidationPanel ({ range, rule, initialItems = [], onSave, onRemove, onClose }) {
  const [kind, setKind] = useState((rule && rule.kind) || 'list')
  const [fromRange, setFromRange] = useState(!!(rule && rule.source))
  const [items, setItems] = useState(rule && rule.items && !rule.source ? rule.items.join('\n') : rule ? '' : initialItems.join('\n'))
  const [source, setSource] = useState((rule && rule.source) || '')
  const [look, setLook] = useState(lookOf(rule))
  // An item's colour once picked or saved; the others take chipColorAt in
  // turn, or grey on a chip list saved without one.
  const [colors, setColors] = useState(() => ({ ...((rule && rule.colors) || {}) }))
  const [choosing, setChoosing] = useState(null) // the item whose colour is being picked
  const chipItems = fromRange ? (rule && rule.source && rule.source === source ? rule.items || [] : []) : splitItems(items)
  const colorOf = (item, i) => colors[item] || (rule && rule.chips ? 'grey' : chipColorAt(i))
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
      out.dropdown = look !== 'plain'
      if (look === 'chips') {
        out.chips = true
        out.colors = Object.fromEntries(chipItems.map((it, i) => [it, colorOf(it, i)]))
      }
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
            <div className='row'>
              <span className='small'>Show as</span>
              <select aria-label='Show as' value={look} onChange={(e) => setLook(e.target.value)}>
                {LOOKS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            {look === 'chips' && chipItems.length > 0 && (
              <>
                <div className='chip-colors' aria-label='Colours'>
                  {chipItems.map((it, i) => (
                    <button key={it} className={'chip chip-' + colorOf(it, i) + (choosing === it ? ' on' : '')} title='Pick a colour' onClick={() => setChoosing(choosing === it ? null : it)}>{it}</button>
                  ))}
                </div>
                {choosing && chipItems.includes(choosing) && (
                  <div className='chip-swatches' role='radiogroup' aria-label={'Colour for ' + choosing}>
                    {CHIP_NAMES.map((name) => (
                      <button key={name} role='radio' aria-checked={colorOf(choosing, chipItems.indexOf(choosing)) === name} aria-label={name} title={name} className={'chip-' + name + (colorOf(choosing, chipItems.indexOf(choosing)) === name ? ' on' : '')} onClick={() => { setColors((c) => ({ ...c, [choosing]: name })); setChoosing(null) }} />
                    ))}
                  </div>
                )}
              </>
            )}
            {look === 'chips' && fromRange && !chipItems.length && <p className='small'>Save first to pick colours for the items in the range.</p>}
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
