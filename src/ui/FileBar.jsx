import React, { useCallback, useEffect, useState } from 'react'
import { call, on } from './bridge.js'
import { SharePanel } from './SharePanel.jsx'
import { PeopleStack } from './Avatar.jsx'
import { DeletePanel } from './DeletePanel.jsx'
import { TidyPanel } from './TidyPanel.jsx'
import { DotsThree, UserPlus } from '@phosphor-icons/react'

// Everyone in a file, for the pictures next to Share.
export function useMembers (sheetId) {
  const [members, setMembers] = useState([])
  const loadMembers = useCallback(() => {
    call('file:members', { sheetId }).then((d) => setMembers(d.members)).catch(() => {})
  }, [sheetId])
  useEffect(() => { loadMembers() }, [loadMembers])
  useEffect(() => on('sheet:members', (d) => { if (d.sheetId === sheetId) loadMembers() }), [sheetId, loadMembers])
  return members
}

// The toolbar parts any kind of file has (proposals/2026-10-06-documents.md):
// the title, who is in it, Share and the More menu's file items, plus the
// panels they open. The editor's own tools go in as children, and its own
// More items as menuItems(close).
export function FileBar ({ sheetId, noun, title, myRole, frozen, canEdit, badge, phone, members, present, menuItems, onTitleChange, onError, onGone, children }) {
  const [sharing, setSharing] = useState(false)
  const [more, setMore] = useState(false) // the ⋯ menu
  const [deleting, setDeleting] = useState(null) // 'local' | 'everyone' | null
  const [tidying, setTidying] = useState(false)
  const ICON = phone ? 20 : 18 // toolbar icon size
  const close = () => setMore(false)

  async function rename (value) {
    try { await call('file:setTitle', { sheetId, title: value }) } catch (err) { onError(err.message) }
    onTitleChange()
  }

  return (
    <>
      <header className='toolbar'>
        <input
          className='title'
          aria-label={noun[0].toUpperCase() + noun.slice(1) + ' title'}
          defaultValue={title}
          key={title}
          readOnly={!canEdit}
          onBlur={(e) => { if (e.target.value !== title) rename(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
        />
        {badge}
        {children}
        {members.length > 1 && <PeopleStack sheetId={sheetId} members={members} present={present} max={phone ? 2 : 3} size={26} onClick={() => setSharing(true)} />}
        {!phone && <button className='share' onClick={() => setSharing(true)}>Share</button>}
        {phone && members.length <= 1 && <button className='share-icon icon-button' aria-label='Share' title='Share' onClick={() => setSharing(true)}><UserPlus size={ICON} /></button>}
        <span className='more'>
          <button className='more-button icon-button' aria-label='More' title='More' onClick={() => setMore(!more)}><DotsThree size={ICON} weight='bold' /></button>
          {more && (
            <ul className='menu more-menu' role='menu' onClick={close}>
              {menuItems && menuItems(close)}
              <li role='menuitem' onClick={() => setDeleting('local')}>Remove from this device</li>
              {myRole === 'owner' && !frozen && <li role='menuitem' onClick={() => setTidying(true)}>Tidy up this {noun}...</li>}
              {myRole === 'owner' && <li role='menuitem' className='danger' onClick={() => setDeleting('everyone')}>Delete for everyone</li>}
            </ul>
          )}
        </span>
      </header>
      {sharing && <SharePanel sheetId={sheetId} onClose={() => setSharing(false)} onError={onError} />}
      {tidying && <TidyPanel sheetId={sheetId} title={title} onClose={() => setTidying(false)} onError={onError} onDone={() => setTidying(false)} />}
      {deleting && <DeletePanel sheetId={sheetId} title={title} kind={deleting} onClose={() => setDeleting(null)} onError={onError} onDone={() => { setDeleting(null); onGone() }} />}
    </>
  )
}
