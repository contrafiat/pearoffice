// Version history (proposals/2026-10-26-version-history.md) for documents,
// sheets and decks: the versions, newest first; the one picked shown
// read-only with what it changed marked; Restore and Copy. Takes the
// editor's place while open.

import React, { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { ArrowCounterClockwise, Copy, X, CaretLeft } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { MemberAvatar } from './Avatar.jsx'
import { fromB64 } from './doc/pictures.js'
import { docToJson } from './doc/docFiles.js'
import { diffVersions } from './doc/versionDiff.js'
import { colName } from './sheet/a1.js'
import slidesModel from '../slides/slidesModel.js'
import { themeFor } from './slides/themes.js'
import { boxesOf } from './slides/deck.js'
import { FitSlide } from './slides/Present.jsx'
import { PicturesContext, usePictureCache } from './slides/objects.jsx'

const START = {
  compact: 'Earlier versions were cleared when this document was tidied up.',
  remove: 'Earlier versions were cleared when someone was removed.',
  recovered: 'Earlier versions were cleared when this document was brought back.'
}

function when (t) {
  if (t === null) return 'Earlier'
  const d = new Date(t)
  const today = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return 'Today, ' + time
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ', ' + time
}

// A version's Yjs document.
async function docAt (sheetId, end) {
  const r = await call('file:version', { sheetId, end })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, fromB64(r.state))
  return doc
}
// A version's document as the editor's JSON.
async function jsonAt (sheetId, end) {
  const doc = await docAt(sheetId, end)
  try { return docToJson(doc) } finally { doc.destroy() }
}

// A deck as drawn (deck.js), and each slide's content to compare.
function deckOf (doc) {
  return {
    size: slidesModel.size(doc),
    theme: themeFor(slidesModel.theme(doc)),
    slides: slidesModel.slides(doc).map((s) => ({ id: s.id, layout: s.map.get('layout'), els: boxesOf(doc, s.id), key: JSON.stringify([s.map.get('layout'), s.map.get('els') ? s.map.get('els').toJSON() : null]) }))
  }
}

// What the picked version shows, by kind of file. Each gives { text } for
// Copy (null: no Copy) and what its view needs; `close` frees it.
async function load (kind, sheetId, v, prev, tabId) {
  if (kind === 'sheet') {
    const r = await call('sheet:versionCells', { sheetId, end: v.end, prevEnd: prev ? prev.end : null, tabId })
    const rows = Math.max(0, ...r.cells.map((c) => c.row))
    const cols = Math.max(0, ...r.cells.map((c) => c.col))
    const at = new Map(r.cells.map((c) => [c.row + ',' + c.col, c]))
    const text = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (at.get((i + 1) + ',' + (j + 1)) || {}).display || '').join('\t')).join('\n')
    return { ...r, text }
  }
  if (kind === 'slides') {
    const doc = await docAt(sheetId, v.end)
    const before = prev ? await docAt(sheetId, prev.end) : null
    const deck = deckOf(doc)
    const old = before ? deckOf(before) : null
    const marks = new Map()
    for (const s of deck.slides) {
      const was = old && old.slides.find((x) => x.id === s.id)
      if (!old || !was) marks.set(s.id, 'new')
      else if (was.key !== s.key) marks.set(s.id, 'changed')
    }
    const gone = old ? old.slides.filter((x) => !deck.slides.some((s) => s.id === x.id)) : []
    return { deck, oldDeck: old, marks, gone, text: null, close: () => { doc.destroy(); if (before) before.destroy() } }
  }
  const [json, before] = await Promise.all([jsonAt(sheetId, v.end), prev ? jsonAt(sheetId, prev.end) : null])
  const rows = diffVersions(before, json)
  const text = rows.filter((r) => r.op !== 'del').map((r) => r.parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).join('\n\n')
  return { json, rows, text }
}

export function History ({ kind = 'doc', sheetId, members, canEdit, editor, phone, onClose, onError }) {
  const [versions, setVersions] = useState(null)
  const [pick, setPick] = useState(0)
  const [shown, setShown] = useState(null) // what load() gave for the picked version
  const [tabId, setTabId] = useState(null) // a sheet's tab
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState(null)
  const [listOpen, setListOpen] = useState(true) // phones: the list, or the version

  useEffect(() => {
    let live = true
    // The smoke test shortens the pause that ends a version.
    const pauseMs = window.__historyPauseMs
    call('file:versions', { sheetId, ...(pauseMs ? { pauseMs } : {}) })
      .then((r) => { if (live) setVersions(r.versions) })
      .catch((err) => onError(err.message))
    return () => { live = false }
  }, [sheetId]) // eslint-disable-line react-hooks/exhaustive-deps

  const v = versions && versions[pick]
  useEffect(() => {
    if (!v) return
    let live = true
    setShown(null)
    setAsking(false)
    const prev = !v.start ? versions[pick + 1] : null
    let got = null
    load(kind, sheetId, v, prev, tabId)
      .then((r) => { got = r; if (live) setShown(r); else if (r.close) r.close() })
      .catch((err) => onError(err.message))
    return () => { live = false; if (got && got.close) got.close() }
  }, [v, tabId]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id) => { const m = members.find((x) => x.identity === id); return !m ? 'Someone' : m.isMe ? 'You' : m.name || 'Unnamed' }
  const memberOf = (id) => members.find((x) => x.identity === id) || null
  const people = (list) => list.map(nameOf).filter((x, i, a) => a.indexOf(x) === i).join(', ')

  async function restore () {
    if (!shown) return
    const msg = 'Restored the version from ' + when(v.to) + '.'
    if (kind === 'doc') {
      if (!editor) return
      editor.chain().setContent(shown.json, { emitUpdate: true }).run()
      onClose(msg)
      return
    }
    try { await call('file:restore', { sheetId, end: v.end }); onClose(msg) } catch (err) { onError(err.message) }
  }
  async function copy () {
    const text = shown.text
    try { await navigator.clipboard.writeText(text) } catch { await call('app:setClipboard', { text }).catch(() => {}) }
    setNote('Copied this version')
    setTimeout(() => setNote(null), 2500)
  }

  const list = (
    <ol className='history-list' aria-label='Versions'>
      {(versions || []).map((x, i) => (
        <li key={i}>
          <button className={'history-item' + (i === pick ? ' on' : '')} aria-current={i === pick} onClick={() => { setPick(i); setListOpen(false) }}>
            <span className='history-when'>{i === 0 ? 'Current version' : when(x.to)}</span>
            {i === 0 && x.to !== null && <span className='history-sub'>{when(x.to)}</span>}
            <span className='history-people'>
              {x.people.slice(0, 3).map((id) => memberOf(id) ? <MemberAvatar key={id} sheetId={sheetId} member={memberOf(id)} size={18} /> : null)}
              <span>{people(x.people)}</span>
            </span>
            {x.start && <span className='history-sub'>{START[x.start]}</span>}
          </button>
        </li>
      ))}
    </ol>
  )

  return (
    <div className={'history' + (phone ? ' phone' : '')}>
      <div className='history-bar'>
        {phone && !listOpen && <button className='icon-button' aria-label='Versions' title='Versions' onClick={() => setListOpen(true)}><CaretLeft size={20} /></button>}
        <h2>Version history</h2>
        {v && pick > 0 && canEdit && !asking && <button className='primary history-restore' onClick={() => setAsking(true)} disabled={!shown}><ArrowCounterClockwise size={16} /> Restore this version</button>}
        {asking && (
          <span className='history-ask' role='alertdialog' aria-label='Restore this version?'>
            Replace the {kind === 'sheet' ? 'sheet' : kind === 'slides' ? 'slides' : 'document'} with this version? Everyone sees the change, and you can restore another version afterwards.
            <button className='primary history-restore-yes' onClick={restore}>Restore</button>
            <button onClick={() => setAsking(false)}>Cancel</button>
          </span>
        )}
        {v && shown && shown.text !== null && <button className='icon-button history-copy' aria-label='Copy this version' title='Copy this version' onClick={copy}><Copy size={18} /></button>}
        <button className='icon-button close history-close' aria-label='Close version history' title='Close' onClick={() => onClose(null)}><X size={18} /></button>
      </div>
      {note && <div className='toast' role='status'>{note}</div>}
      <div className='history-row'>
        {(!phone || !listOpen) && (
          <div className='doc-scroll history-scroll'>
            <div className='doc-page history-page'>
              {!versions
                ? <p className='muted'>Finding the versions...</p>
                : !shown
                    ? <p className='muted'>Opening this version...</p>
                    : kind === 'sheet'
                      ? <SheetVersion shown={shown} onTab={setTabId} />
                      : kind === 'slides'
                        ? <DeckVersion shown={shown} sheetId={sheetId} />
                        : <VersionText rows={shown.rows} />}
            </div>
          </div>
        )}
        {(!phone || listOpen) && <aside className='history-side'>{versions ? list : null}</aside>}
      </div>
    </div>
  )
}

const TAGS = { p: 'p', li: 'li', h1: 'h1', h2: 'h2', h3: 'h3', code: 'pre', pic: 'p', row: 'p', hr: 'hr' }

// A version as text, with what it added and removed marked.
function VersionText ({ rows }) {
  const items = useMemo(() => rows.map((r, i) => {
    const Tag = TAGS[r.kind] || 'p'
    if (Tag === 'hr') return <hr key={i} />
    return (
      <Tag key={i} className={'v-' + r.op + (r.kind === 'li' ? ' v-li' : '')}>
        {r.parts.map((p, k) => (p.op === 'add' ? <ins key={k}>{p.text}</ins> : p.op === 'del' ? <del key={k}>{p.text}</del> : <span key={k}>{p.text}</span>))}
      </Tag>
    )
  }), [rows])
  return <div className='doc-body history-text'>{items.length ? items : <p className='muted'>This version is empty.</p>}</div>
}

// An old sheet's tab as a grid of its cells, the changed ones marked: added
// (green), changed (green, with what it was) and emptied (struck through).
function SheetVersion ({ shown, onTab }) {
  const rows = Math.min(500, Math.max(1, ...shown.cells.map((c) => c.row)))
  const cols = Math.min(52, Math.max(1, ...shown.cells.map((c) => c.col)))
  const at = useMemo(() => new Map(shown.cells.map((c) => [c.row + ',' + c.col, c])), [shown])
  return (
    <div className='history-sheet'>
      {shown.tabs.length > 1 && (
        <div className='history-tabs' role='tablist'>
          {shown.tabs.map((t) => <button key={t.id} role='tab' aria-selected={t.id === shown.tabId} className={t.id === shown.tabId ? 'on' : ''} onClick={() => onTab(t.id)}>{t.name}</button>)}
        </div>
      )}
      {!shown.cells.length
        ? <p className='muted'>This tab is empty in this version.</p>
        : (
          <table className='history-grid'>
            <thead><tr><th />{Array.from({ length: cols }, (_, j) => <th key={j}>{colName(j + 1)}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: rows }, (_, i) => (
                <tr key={i}>
                  <th>{i + 1}</th>
                  {Array.from({ length: cols }, (_, j) => {
                    const c = at.get((i + 1) + ',' + (j + 1))
                    if (!c) return <td key={j} />
                    const changed = c.before !== undefined
                    const cls = !changed ? '' : c.display === '' ? 'v-del' : c.before === '' ? 'v-add' : 'v-changed'
                    return (
                      <td key={j} className={cls} title={changed && c.before !== '' ? 'Was: ' + c.before : c.input && c.input[0] === '=' ? c.input : undefined}>
                        {c.display === '' ? <del>{c.before}</del> : c.display}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          )}
    </div>
  )
}

// An old deck: its slides, new and changed ones marked, and the slides this
// version deleted after them.
function DeckVersion ({ shown, sheetId }) {
  const pictures = usePictureCache(sheetId)
  const { deck, oldDeck, marks, gone } = shown
  const label = { new: 'New', changed: 'Changed' }
  return (
    <PicturesContext.Provider value={pictures}>
      <div className='history-deck'>
        {deck.slides.map((s, i) => (
          <figure key={s.id} className={'history-slide' + (marks.has(s.id) ? ' v-' + marks.get(s.id) : '')}>
            <FitSlide slide={s} size={deck.size} theme={deck.theme} />
            <figcaption>{i + 1}{marks.has(s.id) && <span className='history-mark'>{label[marks.get(s.id)]}</span>}</figcaption>
          </figure>
        ))}
        {gone.map((s) => (
          <figure key={'gone' + s.id} className='history-slide v-gone'>
            <FitSlide slide={s} size={oldDeck.size} theme={oldDeck.theme} />
            <figcaption><span className='history-mark'>Deleted</span></figcaption>
          </figure>
        ))}
        {!deck.slides.length && !gone.length && <p className='muted'>No slides in this version.</p>}
      </div>
    </PicturesContext.Provider>
  )
}
