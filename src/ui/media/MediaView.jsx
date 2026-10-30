// The viewer for PDF and picture files
// (proposals/2026-10-29-pdf-and-picture-files.md): the file bar any file has,
// and the picture or the PDF's pages. Nothing here edits the file; editors
// can rename it.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MagnifyingGlassMinus, MagnifyingGlassPlus, ArrowsIn } from '@phosphor-icons/react'
import { call, on } from '../bridge.js'
import { FileBar, useMembers } from '../FileBar.jsx'
import { nounOf } from '../Files.jsx'
import { fileName, saveFile, isMobile } from '../save.js'
import { toB64 } from '../doc/pictures.js'
import { readMedia } from './mediaFiles.js'

const MIN = 1
const MAX = 8
const clamp = (v) => Math.min(MAX, Math.max(MIN, v))

export function MediaView ({ sheetId, kind, onTitleChange, onError, onGone }) {
  const phone = isMobile()
  const members = useMembers(sheetId)
  const [info, setInfo] = useState(null)
  const [bytes, setBytes] = useState(null)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [attempt, setAttempt] = useState(0)

  const load = useCallback(() => call('media:info', { sheetId }).then(setInfo).catch((err) => onError(err.message)), [sheetId, onError])
  useEffect(() => { load() }, [load])
  useEffect(() => on('sheet:changed', (d) => { if (d.sheetId === sheetId) load() }), [sheetId, load])

  const ready = !!(info && info.media)
  useEffect(() => {
    if (!ready) return
    let live = true
    setFailed(null)
    readMedia(sheetId, (f) => { if (live) setProgress(f) })
      .then((b) => { if (live) setBytes(b) })
      .catch((err) => { if (live) setFailed(err.message) })
    return () => { live = false }
  }, [sheetId, ready, attempt])

  if (!info) return <div className='media'><p className='muted media-wait'>Loading...</p></div>
  const media = info.media
  const title = info.title
  const canEdit = info.myRole === 'owner' || info.myRole === 'editor'
  const name = (media && media.name) || fileName(title) + (kind === 'pdf' ? '.pdf' : '')
  const saveCopy = () => saveFile(fileName(name), media.mime, bytes).catch((err) => onError(err.message))
  const print = () => printMedia(kind, bytes, media.mime, title).catch((err) => onError(err.message))

  return (
    <div className={'media media-' + kind}>
      <FileBar
        sheetId={sheetId}
        noun={nounOf(kind)}
        title={title}
        myRole={info.myRole}
        canEdit={canEdit}
        tidy={false}
        badge={!canEdit && <span className='badge view-only'>View only</span>}
        phone={phone}
        members={members}
        onTitleChange={onTitleChange}
        onError={onError}
        onGone={onGone}
        menuItems={() => [
          bytes && { label: phone ? 'Save or open in another app' : 'Save a copy', className: 'media-save', onSelect: saveCopy },
          bytes && !phone && { label: 'Print...', className: 'media-print', onSelect: print }
        ]}
      >
        {!phone && bytes && (
          <span className='media-zoom'>
            <button className='icon-button' title='Zoom out' aria-label='Zoom out' disabled={zoom <= MIN} onClick={() => setZoom((z) => clamp(z / 1.25))}><MagnifyingGlassMinus size={18} /></button>
            <span className='media-zoom-level'>{Math.round(zoom * 100)}%</span>
            <button className='icon-button' title='Zoom in' aria-label='Zoom in' disabled={zoom >= MAX} onClick={() => setZoom((z) => clamp(z * 1.25))}><MagnifyingGlassPlus size={18} /></button>
            <button className='icon-button' title='Fit' aria-label='Fit' disabled={zoom === 1} onClick={() => setZoom(1)}><ArrowsIn size={18} /></button>
          </span>
        )}
      </FileBar>
      {!media && <p className='muted media-wait'>Getting the file...</p>}
      {media && !bytes && !failed && <p className='muted media-wait'>Getting the file... {Math.round(progress * 100)}%</p>}
      {failed && (
        <div className='empty media-failed'>
          <p>{failed}</p>
          <p className='muted'>Someone else in this file, or a seeder, needs to be online.</p>
          <div className='empty-actions'><button onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>
        </div>
      )}
      {bytes && kind === 'picture' && <PictureStage bytes={bytes} mime={media.mime} alt={title} zoom={zoom} setZoom={setZoom} />}
      {bytes && kind === 'pdf' && <PdfPages bytes={bytes} zoom={zoom} setZoom={setZoom} onError={onError} />}
    </div>
  )
}

// Zoom with the wheel, a pinch or a double click or tap; drag to pan.
function usePinchZoom (zoom, setZoom, { wheelNeedsCtrl = false } = {}) {
  const ref = useRef(null)
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const lastTap = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wheel = (e) => {
      if (wheelNeedsCtrl && !e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.002)))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [setZoom, wheelNeedsCtrl])
  const distance = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const handlers = {
    onPointerDown: (e) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 2) pinch.current = { d: distance(), z: zoom }
      if (e.pointerType === 'touch' && pointers.current.size === 1) {
        const now = Date.now()
        if (now - lastTap.current < 300) setZoom((z) => (z > 1 ? 1 : 2.5))
        lastTap.current = now
      }
    },
    onPointerMove: (e) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch.current && pointers.current.size === 2) setZoom(clamp(pinch.current.z * distance() / pinch.current.d))
    },
    onPointerUp: (e) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null },
    onPointerCancel: (e) => { pointers.current.delete(e.pointerId); pinch.current = null },
    onDoubleClick: () => setZoom((z) => (z > 1 ? 1 : 2.5))
  }
  return { ref, handlers }
}

function PictureStage ({ bytes, mime, alt, zoom, setZoom }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([bytes], { type: mime }))
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [bytes, mime])
  const { ref, handlers } = usePinchZoom(zoom, setZoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef(null)
  useEffect(() => { if (zoom === 1) setPan({ x: 0, y: 0 }) }, [zoom])
  return (
    <div
      ref={ref}
      className={'media-stage picture-stage' + (zoom > 1 ? ' zoomed' : '')}
      {...handlers}
      onPointerDown={(e) => { handlers.onPointerDown(e); if (zoom > 1 && e.isPrimary) drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y } }}
      onPointerMove={(e) => { handlers.onPointerMove(e); if (drag.current && e.isPrimary) setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }) }}
      onPointerUp={(e) => { handlers.onPointerUp(e); drag.current = null }}
    >
      {url && <img className='media-image' src={url} alt={alt} draggable={false} style={{ transform: 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')' }} />}
    </div>
  )
}

// The PDF's pages one under the other, each drawn when it comes on screen,
// "Page 3 of 12" and links that open. Ctrl+wheel or a pinch zooms.
function PdfPages ({ bytes, zoom, setZoom, onError }) {
  const [pdf, setPdf] = useState(null)
  const [sizes, setSizes] = useState(null) // [{ w, h }] at scale 1
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState(1)
  const { ref, handlers } = usePinchZoom(zoom, setZoom, { wheelNeedsCtrl: true })

  useEffect(() => {
    let live = true
    let doc = null
    import('./pdf.js').then(({ openPdf }) => openPdf(bytes)).then(async (d) => {
      doc = d
      const first = (await d.getPage(1)).getViewport({ scale: 1 })
      if (!live) return
      setSizes(Array.from({ length: d.numPages }, () => ({ w: first.width, h: first.height })))
      setPdf(d)
    }).catch((err) => onError('This PDF could not be shown: ' + err.message))
    return () => { live = false; if (doc) doc.close() }
  }, [bytes]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  // At 100% a page fills the width, up to a reading width on a wide window.
  const fit = (s) => (width ? Math.max(1, Math.min(width - 32, 900)) / s.w : 1) * zoom
  const onScroll = (e) => {
    const el = e.currentTarget
    const pages = [...el.querySelectorAll('.pdf-page')]
    const mid = el.scrollTop + el.clientHeight / 3
    const i = pages.findIndex((p) => p.offsetTop + p.offsetHeight > mid)
    setCurrent(i < 0 ? pages.length : i + 1)
  }
  const sized = (i, s) => setSizes((all) => (all[i].w === s.w && all[i].h === s.h ? all : all.map((x, j) => (j === i ? s : x))))
  return (
    <div ref={ref} className='media-stage pdf-stage' {...handlers} onScroll={onScroll}>
      {!pdf && <p className='muted media-wait'>Opening the PDF...</p>}
      {pdf && sizes && width > 0 && sizes.map((s, i) => <PdfPage key={i} pdf={pdf} index={i} scale={fit(s)} size={s} onSize={sized} />)}
      {pdf && <span className='pdf-count' aria-live='polite'>Page {current} of {pdf.numPages}</span>}
    </div>
  )
}

function PdfPage ({ pdf, index, scale, size, onSize }) {
  const box = useRef(null)
  const canvas = useRef(null)
  const [seen, setSeen] = useState(false)
  const [links, setLinks] = useState([])
  useEffect(() => {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setSeen(true) }, { rootMargin: '400px 0px' })
    io.observe(box.current)
    return () => io.disconnect()
  }, [])
  // One drawing at a time on the canvas: a new one (after a zoom) waits for
  // the last to stop.
  const drawing = useRef(Promise.resolve())
  const running = useRef(null)
  useEffect(() => {
    if (!seen) return
    let live = true
    if (running.current) running.current.cancel()
    drawing.current = drawing.current.then(async () => {
      if (!live) return
      const page = await pdf.getPage(index + 1)
      const base = page.getViewport({ scale: 1 })
      onSize(index, { w: base.width, h: base.height })
      const vp = page.getViewport({ scale })
      const notes = await page.getAnnotations().catch(() => [])
      if (!live) return
      setLinks(notes.filter((a) => a.subtype === 'Link' && /^(https?:|mailto:)/i.test(a.url || '')).map((a) => {
        // PDF points to the page on screen, by the viewport's transform.
        const [ta, tb, tc, td, te, tf] = vp.transform
        const at = (x, y) => [ta * x + tc * y + te, tb * x + td * y + tf]
        const [x1, y1] = at(a.rect[0], a.rect[1])
        const [x2, y2] = at(a.rect[2], a.rect[3])
        return { url: a.url, left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
      }))
      // Sharp on high-density screens, but no bigger than about 16 million pixels.
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(16e6 / Math.max(1, vp.width * vp.height)))
      const c = canvas.current
      if (!c) return
      c.width = Math.floor(vp.width * ratio)
      c.height = Math.floor(vp.height * ratio)
      const task = page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] })
      running.current = task
      await task.promise.catch(() => {})
      if (running.current === task) running.current = null
    }).catch(() => {})
    return () => { live = false }
  }, [seen, pdf, index, scale]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className='pdf-page' style={{ width: size.w * scale, height: size.h * scale }}>
      {seen && <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />}
      {links.map((l, i) => <a key={i} className='pdf-link' href={l.url} title={l.url} style={{ left: l.left, top: l.top, width: l.width, height: l.height }} onClick={(e) => { e.preventDefault(); call('app:openUrl', { url: l.url }).catch(() => {}) }} />)}
    </div>
  )
}

// Print on desktop: the picture, or each page drawn as a picture.
async function printMedia (kind, bytes, mime, title) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
  const css = '@page{margin:0}body{margin:0}img{display:block;max-width:100%;max-height:100vh;margin:0 auto;break-after:page;page-break-after:always}'
  let imgs = ''
  if (kind === 'picture') {
    imgs = '<img src="data:' + mime + ';base64,' + toB64(bytes) + '">'
  } else {
    const { openPdf } = await import('./pdf.js')
    const pdf = await openPdf(bytes)
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const vp = page.getViewport({ scale: 2 })
        const c = document.createElement('canvas')
        c.width = Math.floor(vp.width)
        c.height = Math.floor(vp.height)
        await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise
        imgs += '<img src="' + c.toDataURL('image/png') + '">'
      }
    } finally {
      await pdf.close()
    }
  }
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + '</style></head><body>' + imgs + '</body></html>'
  return call('app:print', { html, name: fileName(title) + '.pdf' })
}
