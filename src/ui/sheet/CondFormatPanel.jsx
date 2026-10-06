// Conditional formatting (proposals/2026-10-04-sheet-tools.md and
// 2026-10-05-formula-rules-icon-sets.md): the tab's rules, in priority
// order, and a form to add or change one.

import React, { useState } from 'react'
import { X, ArrowUp, ArrowDown, PencilSimple, Trash, Plus } from '@phosphor-icons/react'
import { describe } from '../../sheet/condFormat.js'
import { CfIcon, ICON_SETS } from './cfIcons.jsx'

// Excel's own presets, so files look the same there.
export const STYLES = [
  ['Light red fill, dark red text', { fill: '#ffc7ce', color: '#9c0006' }],
  ['Yellow fill, dark yellow text', { fill: '#ffeb9c', color: '#9c5700' }],
  ['Green fill, dark green text', { fill: '#c6efce', color: '#006100' }],
  ['Light red fill', { fill: '#ffc7ce' }],
  ['Red text', { color: '#c00000' }],
  ['Bold', { b: true }],
  ['Grey, struck through', { color: '#808080', s: true }]
]
const SCALES = [
  ['Green, yellow, red', ['#63be7b', '#ffeb84', '#f8696b']],
  ['Red, yellow, green', ['#f8696b', '#ffeb84', '#63be7b']],
  ['White to green', ['#ffffff', '#63be7b']],
  ['White to red', ['#ffffff', '#f8696b']],
  ['Blue, white, red', ['#5a8ac6', '#fcfcff', '#f8696b']]
]
const BARS = [['Blue', '#638ec6'], ['Green', '#63c384'], ['Red', '#ff555a'], ['Orange', '#ffb628'], ['Light blue', '#008aef'], ['Purple', '#d6007b']]
const KINDS = [
  ['gt', 'Greater than'], ['lt', 'Less than'], ['between', 'Between'], ['eq', 'Equal to'],
  ['text', 'Text that'], ['date', 'A date'], ['dup', 'Duplicate values'], ['unique', 'Unique values'],
  ['top', 'Top'], ['bottom', 'Bottom'], ['above', 'Above average'], ['below', 'Below average'],
  ['blank', 'Blank'], ['notBlank', 'Not blank'], ['scale', 'Colour scale'], ['bar', 'Data bars'],
  ['icons', 'Icon set'], ['formula', 'A formula is true']
]
const TEXT_OPS = [['contains', 'contains'], ['notContains', 'does not contain'], ['begins', 'starts with'], ['ends', 'ends with']]
const PERIODS = [['yesterday', 'yesterday'], ['today', 'today'], ['tomorrow', 'tomorrow'], ['last7', 'in the last 7 days'], ['lastWeek', 'last week'], ['thisWeek', 'this week'], ['nextWeek', 'next week'], ['lastMonth', 'last month'], ['thisMonth', 'this month'], ['nextMonth', 'next month']]

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// How a rule's matching cells look, as a small sample.
export function Sample ({ rule }) {
  if (rule.kind === 'icons') return <span className='cf-sample icons'>{(ICON_SETS[rule.set] || ICON_SETS['3arrows'])[1].map((_, i) => <CfIcon key={i} set={rule.set} index={rule.reverse ? (ICON_SETS[rule.set] || ICON_SETS['3arrows'])[1].length - 1 - i : i} size={12} />)}</span>
  if (rule.kind === 'scale') return <span className='cf-sample' style={{ background: 'linear-gradient(90deg, ' + rule.colors.join(', ') + ')' }} />
  if (rule.kind === 'bar') return <span className='cf-sample' style={{ background: 'linear-gradient(90deg, ' + rule.color + ' 60%, transparent 60%)' }} />
  const s = rule.style || {}
  return <span className='cf-sample' style={{ background: s.fill, color: s.color, fontWeight: s.b ? 700 : undefined, fontStyle: s.i ? 'italic' : undefined, textDecoration: s.s ? 'line-through' : undefined }}>Aa</span>
}

function RuleForm ({ start, onSave, onCancel }) {
  const [range, setRange] = useState(start.range)
  const [kind, setKind] = useState(start.kind || 'gt')
  const [a, setA] = useState(start.a !== undefined ? String(start.a) : '')
  const [b, setB] = useState(start.b !== undefined ? String(start.b) : '')
  const [op, setOp] = useState(start.op || 'contains')
  const [text, setText] = useState(start.text || '')
  const [period, setPeriod] = useState(start.period || 'today')
  const [n, setN] = useState(start.n !== undefined ? String(start.n) : '10')
  const [percent, setPercent] = useState(!!start.percent)
  const known = STYLES.findIndex(([, s]) => same(s, start.style || STYLES[0][1]))
  const [styleAt, setStyleAt] = useState(known >= 0 ? known : -1)
  const scaleKnown = SCALES.findIndex(([, c]) => same(c, start.colors))
  const [scaleAt, setScaleAt] = useState(start.colors ? scaleKnown : 0)
  const [bar, setBar] = useState(start.color || BARS[0][1])
  const [formula, setFormula] = useState(start.formula ? '=' + start.formula : '')
  const [iconSet, setIconSet] = useState(start.set || '3arrows')
  const [reverse, setReverse] = useState(!!start.reverse)
  const [iconOnly, setIconOnly] = useState(!!start.iconOnly)

  function save () {
    const rule = { kind }
    if (kind === 'gt' || kind === 'lt' || kind === 'eq') rule.a = a
    if (kind === 'between') { rule.a = a; rule.b = b }
    if (kind === 'text') { rule.op = op; rule.text = text }
    if (kind === 'date') rule.period = period
    if (kind === 'top' || kind === 'bottom') { rule.n = n; rule.percent = percent }
    if (kind === 'formula') rule.formula = formula
    if (kind === 'icons') { rule.set = iconSet; rule.reverse = reverse; rule.iconOnly = iconOnly }
    if (kind === 'scale') rule.colors = scaleAt >= 0 ? SCALES[scaleAt][1] : start.colors
    else if (kind === 'bar') rule.color = bar
    else if (kind !== 'icons') rule.style = styleAt >= 0 ? STYLES[styleAt][1] : start.style
    onSave(range, rule)
  }
  const numeric = kind === 'gt' || kind === 'lt' || kind === 'eq' || kind === 'between'

  return (
    <>
      <div className='row'>
        <span className='small'>Cells</span>
        <input aria-label='Cells' value={range} onChange={(e) => setRange(e.target.value)} />
      </div>
      <select aria-label='Colour cells that are' value={kind} onChange={(e) => setKind(e.target.value)}>
        {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {numeric && (
        <div className='row'>
          <input aria-label={kind === 'between' ? 'From' : 'Value'} placeholder={kind === 'between' ? 'From' : 'Value'} inputMode={kind === 'eq' ? undefined : 'decimal'} value={a} onChange={(e) => setA(e.target.value)} />
          {kind === 'between' && <input aria-label='To' placeholder='To' inputMode='decimal' value={b} onChange={(e) => setB(e.target.value)} />}
        </div>
      )}
      {kind === 'text' && (
        <div className='row'>
          <select aria-label='Text test' value={op} onChange={(e) => setOp(e.target.value)}>{TEXT_OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input aria-label='Text' placeholder='Text' value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      {kind === 'date' && <select aria-label='When' value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      {(kind === 'top' || kind === 'bottom') && (
        <div className='row'>
          <input aria-label='How many' inputMode='numeric' value={n} onChange={(e) => setN(e.target.value)} />
          <label className='check'><input type='checkbox' checked={percent} onChange={(e) => setPercent(e.target.checked)} /> percent</label>
        </div>
      )}
      {kind === 'scale' && (
        <select aria-label='Colours' value={scaleAt} onChange={(e) => setScaleAt(Number(e.target.value))}>
          {scaleAt < 0 && <option value={-1}>From the file</option>}
          {SCALES.map(([l], i) => <option key={l} value={i}>{l}</option>)}
        </select>
      )}
      {kind === 'formula' && (
        <>
          <input aria-label='Formula' placeholder='For example =B2>AVERAGE($B$2:$B$20)' value={formula} onChange={(e) => setFormula(e.target.value)} />
          <p className='small'>Write it for the first cell of the range. References without $ move with each cell.</p>
        </>
      )}
      {kind === 'icons' && (
        <>
          <select aria-label='Icons' value={iconSet} onChange={(e) => setIconSet(e.target.value)}>
            {Object.entries(ICON_SETS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <p className='small'>Highest third of the values gets the first icon, the lowest third the last{iconSet === '4arrows' || iconSet === '5ratings' ? ' (split evenly for this set)' : ''}.</p>
          <label className='check'><input type='checkbox' checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> Reverse the order</label>
          <label className='check'><input type='checkbox' checked={iconOnly} onChange={(e) => setIconOnly(e.target.checked)} /> Show the icon only</label>
        </>
      )}
      {kind === 'bar' && <select aria-label='Bar colour' value={bar} onChange={(e) => setBar(e.target.value)}>{!BARS.some(([, c]) => c === bar) && <option value={bar}>From the file</option>}{BARS.map(([l, c]) => <option key={c} value={c}>{l}</option>)}</select>}
      {kind !== 'scale' && kind !== 'bar' && kind !== 'icons' && (
        <select aria-label='Look' value={styleAt} onChange={(e) => setStyleAt(Number(e.target.value))}>
          {styleAt < 0 && <option value={-1}>From the file</option>}
          {STYLES.map(([l], i) => <option key={l} value={i}>{l}</option>)}
        </select>
      )}
      <div className='row end'>
        <button onClick={onCancel}>Cancel</button>
        <button className='primary' onClick={save}>Save</button>
      </div>
    </>
  )
}

export function CondFormatPanel ({ rules, matches = {}, selection, canEdit, act, onClose }) {
  const [editing, setEditing] = useState(rules.length ? null : { range: selection })
  const [error, setError] = useState('')
  async function saveRule (range, rule) {
    setError('')
    const r = editing.id ? await act('setCondFormat', { id: editing.id, range, rule }) : await act('addCondFormat', { range, rule })
    if (r && r.error) setError(r.error)
    else setEditing(null)
  }
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel cf-panel' role='dialog' aria-label='Conditional formatting'>
        <header>
          <h2>{editing ? (editing.id ? 'Change rule' : 'New rule') : 'Conditional formatting'}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        {editing
          ? <RuleForm start={editing} onSave={saveRule} onCancel={() => { setError(''); if (rules.length) setEditing(null); else onClose() }} />
          : (
            <>
              {!rules.length && <p className='muted'>No conditional formatting on this tab.</p>}
              <ul className='cf-list'>
                {rules.map((r, i) => (
                  <li key={r.id}>
                    <Sample rule={r} />
                    <span className='cf-what'><b>{describe(r)}</b><span className='muted'>{r.range}{r.kind === 'formula' && matches[r.id] === null ? ', too many cells: not applied' : ''}</span></span>
                    {canEdit && (
                      <span className='cf-tools'>
                        <button className='icon-button' aria-label='Move up' title='Move up' disabled={i === 0} onClick={() => act('moveCondFormat', { id: r.id, dir: -1 })}><ArrowUp size={16} /></button>
                        <button className='icon-button' aria-label='Move down' title='Move down' disabled={i === rules.length - 1} onClick={() => act('moveCondFormat', { id: r.id, dir: 1 })}><ArrowDown size={16} /></button>
                        <button className='icon-button' aria-label='Change rule' title='Change' onClick={() => setEditing(r)}><PencilSimple size={16} /></button>
                        <button className='icon-button' aria-label='Delete rule' title='Delete' onClick={() => act('deleteCondFormat', { id: r.id })}><Trash size={16} /></button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {rules.length > 1 && <p className='muted small'>Rules higher in the list win where two set the same thing on a cell.</p>}
              {canEdit && <div className='row'><button onClick={() => setEditing({ range: selection })}><Plus size={16} /> Add a rule</button></div>}
            </>
            )}
        {error && <p className='error'>{error}</p>}
      </section>
    </div>
  )
}
