import React, { useCallback, useEffect, useRef, useState } from 'react'
import { call, on } from './bridge.js'
import { SharePanel } from './SharePanel.jsx'
import { PeopleStack } from './Avatar.jsx'
import { DeletePanel } from './DeletePanel.jsx'
import { TidyPanel } from './TidyPanel.jsx'
import { MoveToFolderPanel } from './Folders.jsx'
import { TagsPanel } from './Tags.jsx'
import { DotsThree, UserPlus } from '@phosphor-icons/react'
import { Menu, menuItems as menuList } from './Menu.jsx'

// Open in new window (proposals/2026-10-26-file-windows.md): on desktop, and
// not in a window that already holds just this file.
const OWN_WINDOWS = typeof window !== 'undefined' && !!(window.pearoffice && window.pearoffice.platform === 'desktop') && !new URLSearchParams(window.location.search).has('file')

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
// More items as menuItems(): a list of Menu.jsx items, before File ▸.
// `tidy`: offer Tidy up (not for PDFs and pictures, which have no history to tidy).
export function FileBar ({ sheetId, noun, title, myRole, frozen, canEdit, badge, phone, members, present, menuItems, tidy = true, onTitleChange, onError, onGone, children }) {
  const [sharing, setSharing] = useState(false)
  const [more, setMore] = useState(null) // the ⋯ menu: { anchor } while open
  const [deleting, setDeleting] = useState(null) // 'local' | 'everyone' | null
  const [tidying, setTidying] = useState(false)
  const [moving, setMoving] = useState(false) // Move to folder
  const [tagging, setTagging] = useState(false) // Tags...
  const ICON = phone ? 20 : 18 // toolbar icon size
  const close = () => setMore(null)
  // A press anywhere outside the menu, or Esc, closes it.
  const moreRef = useRef(null)
  useEffect(() => {
    if (!more) return
    const away = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMore(null) }
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setMore(null) } }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', esc, true)
    }
  }, [more])

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
        {members.length > 1 && <PeopleStack sheetId={sheetId} members={members} present={present} max={phone ? 2 : 3} size={26} noun={noun} onClick={() => setSharing(true)} />}
        {!phone && <button className='share' onClick={() => setSharing(true)}>Share</button>}
        {phone && members.length <= 1 && <button className='share-icon icon-button' aria-label='Share' title='Share' onClick={() => setSharing(true)}><UserPlus size={ICON} /></button>}
        <span className='more' ref={moreRef}>
          <button className='more-button icon-button' aria-label='More' title='More' onClick={(e) => setMore(more ? null : { anchor: e.currentTarget.getBoundingClientRect() })}><DotsThree size={ICON} weight='bold' /></button>
          {more && (
            <Menu
              className='more-menu'
              label='More'
              where={more}
              onClose={close}
              items={menuList([
                ...(menuItems ? menuItems() : []),
                '-',
                {
                  label: 'File',
                  className: 'file-sub',
                  items: [
                    OWN_WINDOWS && { label: 'Open in new window', className: 'open-window', onSelect: () => call('app:openWindow', { sheetId }).catch((err) => onError(err.message)) },
                    { label: 'Move to folder...', onSelect: () => setMoving(true) },
                    { label: 'Tags...', onSelect: () => setTagging(true) },
                    tidy && myRole === 'owner' && !frozen && { label: 'Tidy up this ' + noun + '...', onSelect: () => setTidying(true) },
                    '-',
                    { label: 'Remove from this device', onSelect: () => setDeleting('local') },
                    myRole === 'owner' && { label: 'Delete for everyone', danger: true, onSelect: () => setDeleting('everyone') }
                  ]
                }
              ])}
            />
          )}
        </span>
      </header>
      {sharing && <SharePanel sheetId={sheetId} noun={noun} onClose={() => setSharing(false)} onError={onError} />}
      {moving && <MoveToFolderPanel sheetId={sheetId} title={title} onClose={() => setMoving(false)} onError={onError} />}
      {tagging && <TagsPanel sheetId={sheetId} title={title} onClose={() => setTagging(false)} onError={onError} />}
      {tidying && <TidyPanel sheetId={sheetId} title={title} noun={noun} onClose={() => setTidying(false)} onError={onError} onDone={() => setTidying(false)} />}
      {deleting && <DeletePanel sheetId={sheetId} title={title} noun={noun} kind={deleting} onClose={() => setDeleting(null)} onError={onError} onDone={() => { setDeleting(null); onGone() }} />}
    </>
  )
}
