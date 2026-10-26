// Version history in a document (proposals/2026-10-26-version-history.md):
// the versions, newest first; the one picked shown read-only with what it
// changed marked; Restore and Copy. Takes the editor's place while open.

import React, { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { ArrowCounterClockwise, Copy, X, CaretLeft } from '@phosphor-icons/react'
import { call } from '../bridge.js'
import { MemberAvatar } from '../Avatar.jsx'
import { fromB64 } from './pictures.js'
import { docToJson } from './docFiles.js'
import { diffVersions } from './versionDiff.js'

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

// A version's document as the editor's JSON.
async function jsonAt (sheetId, end) {
  const r = await call('doc:version', { sheetId, end })
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, fromB64(r.state))
    return docToJson(doc)
  } finally { doc.destroy() }
}

export function History ({ sheetId, members, canEdit, editor, phone, onClose, onError }) {
  const [versions, setVersions] = useState(null)
  const [pick, setPick] = useState(0)
  const [shown, setShown] = useState(null) // { json, rows } for the picked version
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState(null)
  const [listOpen, setListOpen] = useState(true) // phones: the list, or the version

  useEffect(() => {
    let live = true
    // The smoke test shortens the pause that ends a version.
    const pauseMs = window.__historyPauseMs
    call('doc:versions', { sheetId, ...(pauseMs ? { pauseMs } : {}) })
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
    const prev = versions[pick + 1]
    Promise.all([jsonAt(sheetId, v.end), prev && !v.start ? jsonAt(sheetId, prev.end) : null])
      .then(([json, before]) => { if (live) setShown({ json, rows: diffVersions(before, json) }) })
      .catch((err) => onError(err.message))
    return () => { live = false }
  }, [v]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id) => { const m = members.find((x) => x.identity === id); return !m ? 'Someone' : m.isMe ? 'You' : m.name || 'Unnamed' }
  const memberOf = (id) => members.find((x) => x.identity === id) || null
  const people = (list) => list.map(nameOf).filter((x, i, a) => a.indexOf(x) === i).join(', ')

  function restore () {
    if (!shown || !editor) return
    editor.chain().setContent(shown.json, { emitUpdate: true }).run()
    onClose('Restored the version from ' + when(v.to) + '.')
  }
  async function copy () {
    const text = shown.rows.filter((r) => r.op !== 'del').map((r) => r.parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).join('\n\n')
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
            Replace the document with this version? Everyone sees the change, and you can restore another version afterwards.
            <button className='primary history-restore-yes' onClick={restore}>Restore</button>
            <button onClick={() => setAsking(false)}>Cancel</button>
          </span>
        )}
        {v && shown && <button className='icon-button history-copy' aria-label='Copy this version' title='Copy this version' onClick={copy}><Copy size={18} /></button>}
        <button className='icon-button close history-close' aria-label='Close version history' title='Close' onClick={() => onClose(null)}><X size={18} /></button>
      </div>
      {note && <div className='toast' role='status'>{note}</div>}
      <div className='history-row'>
        {(!phone || !listOpen) && (
          <div className='doc-scroll history-scroll'>
            <div className='doc-page history-page'>
              {!versions ? <p className='muted'>Finding the versions...</p> : !shown ? <p className='muted'>Opening this version...</p> : <VersionText rows={shown.rows} />}
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
