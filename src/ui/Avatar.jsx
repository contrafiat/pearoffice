// Profile pictures (proposals/2026-10-04-profiles-with-avatars.md): a round
// picture, or initials on a colour picked from the person's identity so they
// look the same on every device.

import React, { useEffect, useState } from 'react'
import { call } from './bridge.js'

const EDGE = 128
const MAX_BYTES = 16 * 1024 // the worklet's cap
const COLOURS = ['#5b8c3a', '#2f7d8c', '#8c5b3a', '#6a4c93', '#a23e48', '#3a5f8c', '#8c7a2f', '#3a8c6e']

export function initials (name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return words.slice(0, 2).map((w) => Array.from(w)[0].toUpperCase()).join('')
}

function colourFor (seed) {
  let h = 0
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLOURS[h % COLOURS.length]
}

export function Avatar ({ name, src, seed, size = 28 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) }
  if (src) return <img className='avatar' src={src} alt='' style={style} />
  return <span className='avatar initials' aria-hidden='true' style={{ ...style, background: colourFor(seed || name) }}>{initials(name)}</span>
}

// Pictures by hash, shared by every list on the page.
const cache = new Map()

// A member's picture as a data URL, or null while loading or when they have none.
export function useMemberAvatar (sheetId, identity, hash) {
  const [src, setSrc] = useState(hash ? cache.get(hash) || null : null)
  useEffect(() => {
    if (!hash) { setSrc(null); return }
    if (cache.has(hash)) { setSrc(cache.get(hash)); return }
    let live = true
    call('sheet:avatar', { sheetId, identity }).then((pic) => {
      if (!pic || pic.hash !== hash) return
      const url = 'data:' + pic.mime + ';base64,' + pic.data
      cache.set(hash, url)
      if (live) setSrc(url)
    }).catch(() => {})
    return () => { live = false }
  }, [sheetId, identity, hash])
  return src
}

export function MemberAvatar ({ sheetId, member, size }) {
  const src = useMemberAvatar(sheetId, member.identity, member.avatarHash)
  return <Avatar name={member.name} src={src} seed={member.identity} size={size} />
}

// A picked image file, cropped to a square from the middle and scaled to
// 128 x 128 JPEG. Drawing through a canvas applies the EXIF orientation and
// drops the EXIF itself, location included. JPEG because WKWebView cannot
// encode WebP.
export async function shrinkPicture (file) {
  // A data: URL, since the page's content policy allows no blob: images.
  const url = await new Promise((resolve, reject) => {
    const r = new window.FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('Could not read that file'))
    r.readAsDataURL(file)
  })
  const img = await new Promise((resolve, reject) => {
    const i = new window.Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('That file is not a picture PearSheet can read'))
    i.src = url
  })
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = EDGE
  canvas.height = EDGE
  const g = canvas.getContext('2d')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, EDGE, EDGE)
  g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, EDGE, EDGE)
  for (const q of [0.8, 0.65, 0.5, 0.35]) {
    const data = canvas.toDataURL('image/jpeg', q).split(',')[1]
    if (data.length * 3 / 4 <= MAX_BYTES) return { data, mime: 'image/jpeg' }
  }
  throw new Error('That picture is too detailed to shrink. Try another one.')
}
