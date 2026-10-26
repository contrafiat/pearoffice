// Links to another file or one of your folders
// (proposals/2026-10-22-links-to-files.md), for sheets, documents and slides.

import { useState } from 'react'
import { call } from './bridge.js'
import { untitled } from './Files.jsx'

const PEAR = /^pearoffice:\/\/(file|folder)\/([A-Za-z0-9_-]+)$/
export const fileLink = (id) => 'pearoffice://file/' + id
export const folderLink = (id) => 'pearoffice://folder/' + id

// { file } or { folder } with the id, or null for any other address.
export function pearLink (href) {
  const m = PEAR.exec(href || '')
  return m ? { [m[1]]: m[2] } : null
}

// placeOf gives a file or folder link its name, or `missing` when this
// person does not have it. A file that moved to fresh keys is found through
// file:follow. open opens a web or email link in the browser and a file or
// folder here.
export function usePearLinks ({ files = [], folders = [], onOpenFile, onOpenFolder }) {
  const [followed, setFollowed] = useState({}) // a file's old id -> its id now, or null
  const usable = files.filter((f) => !f.removed && !f.waiting)
  function placeOf (l, moved = followed) {
    if (!l || !(l.file || l.folder)) return l
    if (l.folder) {
      const d = folders.find((x) => x.id === l.folder)
      return d ? { ...l, name: d.name } : { ...l, missing: 'This folder is not one of yours, or it was deleted.' }
    }
    const f = usable.find((x) => x.sheetId === l.file) || usable.find((x) => x.sheetId === moved[l.file])
    return f ? { ...l, at: f.sheetId, name: f.title || untitled(f.kind) } : { ...l, missing: "You don't have this file. Ask someone who has it to share it with you." }
  }
  async function follow (id) {
    if (id in followed || usable.some((x) => x.sheetId === id)) return followed
    const r = await call('file:follow', { sheetId: id }).catch(() => null)
    const next = { ...followed, [id]: (r && r.sheetId) || null }
    setFollowed(next)
    return next
  }
  async function open (l) {
    if (!l) return
    if (l.url) { call('app:openUrl', { url: l.url }).catch(() => {}); return }
    if (l.folder) { if (!placeOf(l).missing && onOpenFolder) onOpenFolder(l.folder); return }
    if (l.file) {
      const p = placeOf(l, await follow(l.file))
      if (!p.missing && onOpenFile) onOpenFile(p.at)
    }
  }
  return { usable, placeOf, follow, open }
}
