// Find and replace (Ctrl+F, Ctrl+H). Finds in what cells show or in what was
// typed; replaces in what was typed, formulas included.

import React, { useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { colName } from './a1.js'

export function FindPanel ({ sheetId, tabId, tabs, canEdit, startWithReplace, onGo, onClose, onError }) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(!!startWithReplace)
  const [matchCase, setMatchCase] = useState(false)
  const [wholeCell, setWholeCell] = useState(false)
  const [allTabs, setAllTabs] = useState(false)
  const [lookIn, setLookIn] = useState('values')
  const [matches, setMatches] = useState(null)
  const [at, setAt] = useState(-1)
  const [note, setNote] = useState('')
  const input = useRef(null)
  useEffect(() => { if (input.current) input.current.focus() }, [])
  // A change to the search starts it again.
  useEffect(() => { setMatches(null); setAt(-1); setNote('') }, [query, matchCase, wholeCell, allTabs, lookIn])

  const options = () => ({ sheetId, tabId, query, matchCase, wholeCell, allTabs, lookIn: showReplace ? 'formulas' : lookIn })

  async function search () {
    const { matches: found } = await call('sheet:find', options())
    setMatches(found)
    return found
  }

  async function next () {
    try {
      const found = matches || await search()
      if (!found.length) { setNote('Not found'); return }
      const i = (at + 1) % found.length
      setAt(i)
      setNote('')
      onGo(found[i])
    } catch (err) { onError(err.message) }
  }

  async function replaceOne () {
    try {
      const found = matches || await search()
      if (!found.length) { setNote('Not found'); return }
      const i = at < 0 ? 0 : at
      await call('sheet:replace', { ...options(), replacement, at: found[i] })
      const fresh = await search()
      if (!fresh.length) { setAt(-1); setNote('No more matches'); return }
      const j = Math.min(i, fresh.length - 1)
      setAt(j)
      onGo(fresh[j])
    } catch (err) { onError(err.message) }
  }

  async function replaceAll () {
    try {
      const { count } = await call('sheet:replace', { ...options(), replacement })
      setMatches(null)
      setAt(-1)
      setNote(count === 1 ? 'Replaced 1 cell' : 'Replaced ' + count + ' cells')
    } catch (err) { onError(err.message) }
  }

  const where = matches && at >= 0 && matches[at]
  const tabName = (id) => (tabs.find((t) => t.id === id) || {}).name || ''

  return (
    <div className='panel-backdrop find-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel find-panel' role='dialog' aria-label='Find and replace'>
        <header>
          <h2>{showReplace ? 'Find and replace' : 'Find'}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <form onSubmit={(e) => { e.preventDefault(); next() }} className='find-form'>
          <input ref={input} aria-label='Find' placeholder='Find' value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') { e.preventDefault(); if (query) next() } }} />
          {showReplace && <input aria-label='Replace with' placeholder='Replace with' value={replacement} onChange={(e) => setReplacement(e.target.value)} />}
          <div className='find-options'>
            <label className='check'><input type='checkbox' checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
            <label className='check'><input type='checkbox' checked={wholeCell} onChange={(e) => setWholeCell(e.target.checked)} /> Whole cell</label>
            {tabs.length > 1 && <label className='check'><input type='checkbox' checked={allTabs} onChange={(e) => setAllTabs(e.target.checked)} /> All tabs</label>}
            {!showReplace && <label className='check'><input type='checkbox' checked={lookIn === 'formulas'} onChange={(e) => setLookIn(e.target.checked ? 'formulas' : 'values')} /> In formulas</label>}
          </div>
          <p className='small find-status' aria-live='polite'>
            {note || (where ? 'Match ' + (at + 1) + ' of ' + matches.length + ': ' + (allTabs ? tabName(where.tabId) + ' ' : '') + colName(where.col) + where.row : showReplace ? 'Replacing works on what was typed, formulas included.' : ' ')}
          </p>
          <div className='row'>
            <button type='submit' className='primary' disabled={!query}>Find next</button>
            {showReplace && <button type='button' disabled={!query || !canEdit} onClick={replaceOne}>Replace</button>}
            {showReplace && <button type='button' disabled={!query || !canEdit} onClick={replaceAll}>Replace all</button>}
          </div>
          {!showReplace && canEdit && <button type='button' className='link-button' onClick={() => setShowReplace(true)}>Replace...</button>}
        </form>
      </section>
    </div>
  )
}
