// Comments (proposals/2026-10-04-sheet-tools.md): one cell's thread, and the
// list of every thread on the tab. Editors and the owner write; everyone
// reads. People change and delete only their own comments.

import React, { useEffect, useRef, useState } from 'react'
import { X, PencilSimple, Trash, CheckCircle, ArrowCounterClockwise } from '@phosphor-icons/react'
import { MemberAvatar, Avatar } from '../Avatar.jsx'

const when = (at) => (at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

// Comments from an imported file carry the name written in it ("xlsx:Name").
const imported = (identity) => (String(identity).startsWith('xlsx:') ? String(identity).slice(5) : null)
function Person ({ sheetId, members, identity, size = 26 }) {
  const m = members.find((x) => x.identity === identity)
  return m ? <MemberAvatar sheetId={sheetId} member={m} size={size} /> : <Avatar name={imported(identity) || '?'} seed={identity} size={size} />
}
const nameOf = (members, identity) => {
  const m = members.find((x) => x.identity === identity)
  return m ? m.name : imported(identity) ? imported(identity) + ' (imported)' : 'Someone who left'
}

// Ctrl+Enter (or Cmd+Enter) sends; Enter alone starts a new line.
function Box ({ label, value, onChange, onSend, autoFocus }) {
  const ref = useRef(null)
  useEffect(() => { if (autoFocus && ref.current && !('ontouchstart' in window)) ref.current.focus() }, [autoFocus])
  return (
    <textarea
      ref={ref}
      rows={2}
      aria-label={label}
      placeholder={label}
      value={value}
      maxLength={2000}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend() } }}
    />
  )
}

function Comment ({ sheetId, members, me, c, canEdit, act }) {
  const [editing, setEditing] = useState(null)
  const mine = canEdit && c.author === me && !c.deleted
  return (
    <li className='comment'>
      <Person sheetId={sheetId} members={members} identity={c.author} />
      <div className='comment-body'>
        <div className='comment-head'>
          <b>{nameOf(members, c.author)}</b>
          <span className='muted'>{when(c.at)}{c.edited ? ' (edited)' : ''}</span>
          {mine && editing === null && (
            <span className='comment-tools'>
              <button className='icon-button' aria-label='Edit comment' title='Edit' onClick={() => setEditing(c.text)}><PencilSimple size={16} /></button>
              <button className='icon-button' aria-label='Delete comment' title='Delete' onClick={() => act('deleteComment', { id: c.id })}><Trash size={16} /></button>
            </span>
          )}
        </div>
        {editing === null
          ? <p className={c.deleted ? 'comment-text muted' : 'comment-text'}>{c.deleted ? 'Comment deleted' : c.text}</p>
          : (
            <>
              <Box label='Edit comment' value={editing} onChange={setEditing} onSend={() => { act('editComment', { id: c.id, text: editing }); setEditing(null) }} autoFocus />
              <div className='row end'>
                <button onClick={() => setEditing(null)}>Cancel</button>
                <button className='primary' disabled={!editing.trim()} onClick={() => { act('editComment', { id: c.id, text: editing }); setEditing(null) }}>Save</button>
              </div>
            </>
            )}
      </div>
    </li>
  )
}

export function CommentPanel ({ sheetId, address, thread, members, canEdit, act, onClose }) {
  const [text, setText] = useState('')
  const me = (members.find((m) => m.isMe) || {}).identity
  const send = () => {
    if (!text.trim()) return
    act('addComment', thread ? { parent: thread.id, text } : { text })
    setText('')
  }
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel comments-panel' role='dialog' aria-label='Comments'>
        <header>
          <h2>Comments on {address}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        {thread && (
          <ul className='comment-list'>
            <Comment sheetId={sheetId} members={members} me={me} c={thread} canEdit={canEdit} act={act} />
            {thread.replies.map((r) => <Comment key={r.id} sheetId={sheetId} members={members} me={me} c={r} canEdit={canEdit} act={act} />)}
          </ul>
        )}
        {thread && thread.resolved && <p className='muted'>Resolved</p>}
        {!thread && !canEdit && <p className='muted'>No comments.</p>}
        {canEdit && (
          <>
            <Box label={thread ? 'Reply' : 'Add a comment'} value={text} onChange={setText} onSend={send} autoFocus={!thread} />
            <div className='row end'>
              {thread && <button onClick={() => act('resolveComment', { id: thread.id, resolved: !thread.resolved })}>{thread.resolved ? <><ArrowCounterClockwise size={16} /> Reopen</> : <><CheckCircle size={16} /> Resolve</>}</button>}
              <button className='primary' disabled={!text.trim()} onClick={send}>{thread ? 'Reply' : 'Comment'}</button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export function CommentsList ({ sheetId, threads, members, addressOf, onOpen, onClose }) {
  const [showResolved, setShowResolved] = useState(false)
  const shown = threads.filter((t) => showResolved || !t.resolved)
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel comments-panel' role='dialog' aria-label='All comments'>
        <header>
          <h2>Comments</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <label className='check'><input type='checkbox' checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
        {!shown.length && <p className='muted'>No open comments on this tab.</p>}
        <ul className='comment-list'>
          {shown.map((t) => (
            <li key={t.id} className='comment pick' role='button' tabIndex={0} onClick={() => onOpen(t)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t) }}>
              <Person sheetId={sheetId} members={members} identity={t.author} />
              <div className='comment-body'>
                <div className='comment-head'>
                  <b>{addressOf(t)}</b>
                  <span className='muted'>{nameOf(members, t.author)}{t.replies.length ? ', ' + t.replies.length + (t.replies.length === 1 ? ' reply' : ' replies') : ''}{t.resolved ? ', resolved' : ''}</span>
                </div>
                <p className='comment-text'>{t.deleted ? 'Comment deleted' : t.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
