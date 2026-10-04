import React, { useCallback, useEffect, useState } from 'react'
import { call, on } from './bridge.js'
import { QrCode } from './Qr.jsx'
import { MemberAvatar } from './Avatar.jsx'

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' }

function hoursLeft (expiresAt) {
  const h = Math.round((expiresAt - Date.now()) / 3600000)
  return h <= 0 ? 'less than an hour left' : h === 1 ? '1 hour left' : h + ' hours left'
}

export function SharePanel ({ sheetId, onClose, onError }) {
  const [data, setData] = useState(null)
  const [link, setLink] = useState(null) // { link, role }
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(null) // identity being removed
  const [removing, setRemoving] = useState(false)

  const load = useCallback(async () => {
    try { setData(await call('sheet:members', { sheetId })) } catch (err) { onError(err.message) }
  }, [sheetId, onError])

  useEffect(() => { load() }, [load])
  useEffect(() => on('sheet:members', (d) => { if (d.sheetId === sheetId) load() }), [sheetId, load])

  async function invite (role) {
    try {
      const r = await call('sheet:invite', { sheetId, role })
      setLink(r)
      setCopied(false)
      load()
    } catch (err) { onError(err.message) }
  }

  async function copy () {
    try {
      await navigator.clipboard.writeText(link.link)
      setCopied(true)
    } catch {
      const el = document.querySelector('.invite-link input')
      if (el) { el.select(); document.execCommand('copy'); setCopied(true) }
    }
  }

  const isOwner = data && data.myRole === 'owner'

  async function remove (identity) {
    setRemoving(true)
    try {
      await call('sheet:removeMember', { sheetId, identity })
      onClose()
    } catch (err) {
      onError(err.message)
      setRemoving(false)
      setConfirming(null)
    }
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label='Share this sheet'>
        <header>
          <h2>Share</h2>
          <button className='close' aria-label='Close' onClick={onClose}>×</button>
        </header>

        {!data && <p className='muted'>Loading...</p>}

        {data && (
          <>
            {isOwner && (
              <div className='invite-actions'>
                <p>Invite someone. Each link works once and expires after 24 hours.</p>
                <div className='row'>
                  <button className='primary' onClick={() => invite('editor')}>Invite to edit</button>
                  <button onClick={() => invite('viewer')}>Invite to view</button>
                </div>
                {link && (
                  <div className='invite-link'>
                    <label>Send this link to one person ({link.role === 'editor' ? 'can edit' : 'can view'}):</label>
                    <div className='row'>
                      <input readOnly value={link.link} onFocus={(e) => e.target.select()} aria-label='Invite link' />
                      <button className='primary' onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                    </div>
                    <div className='pairing'>
                      <QrCode value={link.link} label='Invite QR code' />
                      <p className='muted small'>Or scan this with PearSheet on their phone.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!isOwner && <p className='muted'>Only the owner can invite people or change roles.</p>}
            {isOwner && confirming && <p className='warn'>Removing someone moves the sheet to new keys. They keep what they already had and see nothing new. Anyone editing the old copy at that moment may lose that last change.</p>}

            <h3>People</h3>
            <ul className='people'>
              {data.members.map((p) => (
                <li key={p.identity}>
                  <span className='who'><MemberAvatar sheetId={sheetId} member={p} size={28} />{p.name || 'Unnamed'}{p.isMe ? ' (you)' : ''}</span>
                  {isOwner && p.role !== 'owner' && confirming === p.identity && (
                    <span className='confirm'>
                      <button className='danger' disabled={removing} onClick={() => remove(p.identity)}>{removing ? 'Removing...' : 'Remove'}</button>
                      <button disabled={removing} onClick={() => setConfirming(null)}>Keep</button>
                    </span>
                  )}
                  {isOwner && p.role !== 'owner' && confirming !== p.identity
                    ? (
                      <span className='member-actions'>
                      <select
                        aria-label={'Role for ' + (p.name || 'this person')}
                        value={p.role}
                        onChange={async (e) => {
                          try { await call('sheet:setRole', { sheetId, identity: p.identity, role: e.target.value }) } catch (err) { onError(err.message) }
                        }}
                      >
                        <option value='editor'>Can edit</option>
                        <option value='viewer'>Can view</option>
                      </select>
                      <button className='link-button' onClick={() => setConfirming(p.identity)}>Remove</button>
                      </span>
                      )
                    : confirming !== p.identity && <span className='role'>{ROLE_LABEL[p.role]}</span>}
                </li>
              ))}
            </ul>

            {isOwner && data.invites.length > 0 && (
              <>
                <h3>Open invites</h3>
                <ul className='people'>
                  {data.invites.map((i) => (
                    <li key={i.inviteId}>
                      <span className='who'>{i.role === 'editor' ? 'Can edit' : 'Can view'} <span className='muted'>{i.expired ? 'expired' : hoursLeft(i.expiresAt)}</span></span>
                      <button
                        className='link-button'
                        onClick={async () => { try { await call('sheet:cancelInvite', { sheetId, inviteId: i.inviteId }) } catch (err) { onError(err.message) } }}
                      >
                        Cancel
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <Backups sheetId={sheetId} members={data.members} onError={onError} />
          </>
        )}
      </section>
    </div>
  )
}

// The seeders this sheet backs up to (proposals/2026-10-04-stop-backing-up.md).
function Backups ({ sheetId, members, onError }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(null) // seeder key being changed

  const load = useCallback(async () => {
    try { setInfo(await call('seeder:sheet', { sheetId })) } catch (err) { onError(err.message) }
  }, [sheetId, onError])
  useEffect(() => { load() }, [load])
  // Seeder listings are membership ops: follow them live.
  useEffect(() => on('sheet:members', (d) => { if (d.sheetId === sheetId) load() }), [sheetId, load])

  async function change (method, seederKey) {
    setBusy(seederKey)
    try { await call(method, { sheetId, seederKey }); await load() } catch (err) { onError(err.message) }
    setBusy(null)
  }

  if (!info || (!info.listed.length && !info.available.length)) return null
  const nameOf = (identity) => {
    const p = members.find((x) => x.identity === identity)
    return p ? (p.isMe ? 'you' : p.name || 'someone') : 'someone'
  }
  return (
    <>
      <h3>Backed up to</h3>
      {!info.listed.length && <p className='muted'>No seeder.</p>}
      <ul className='people backups'>
        {info.listed.map((s) => (
          <li key={s.seederKey}>
            <span className='who'><span className='mono'>{s.seederKey.slice(0, 12)}...</span> <span className='muted'>added by {nameOf(s.addedBy)}</span></span>
            {s.canStop && <button className='link-button' disabled={busy === s.seederKey} onClick={() => change('seeder:removeFromSheet', s.seederKey)}>{busy === s.seederKey ? 'Stopping...' : 'Stop'}</button>}
          </li>
        ))}
        {info.available.map((k) => (
          <li key={k}>
            <span className='who'><span className='mono'>{k.slice(0, 12)}...</span> <span className='muted'>your seeder, not used here</span></span>
            <button className='link-button' disabled={busy === k} onClick={() => change('seeder:addToSheet', k)}>{busy === k ? 'Adding...' : 'Back up here'}</button>
          </li>
        ))}
      </ul>
      {info.listed.some((s) => s.canStop) && <p className='muted small'>Stopping a seeder deletes its copy of this sheet after 7 days.</p>}
    </>
  )
}
