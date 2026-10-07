import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { CaretLeft, CaretRight, X, Pause, Play, ArrowCounterClockwise, Square } from '@phosphor-icons/react'
import { call, on } from '../bridge.js'
import { fromB64 } from '../doc/pictures.js'
import slidesModel from '../../slides/slidesModel.js'
import { StaticSlide } from './StaticSlide.jsx'
import { fragmentDom } from './text.js'
import { useDeck } from './deck.js'

// Presenting a deck (proposals/2026-10-06-slides.md, Presenting). Slides are
// drawn with the same static DOM as the thumbnails, scaled to fill the screen
// with black around them. Three ways to show:
//
// - Show: the slides alone, full screen. Desktop with one display (the main
//   window goes full screen) and phones (in portrait, with the notes under
//   the slide).
// - Presenter: desktop with two displays. The main window shows the current
//   and next slide, the notes and a timer; the main process opens a second
//   window on the other display (Audience) and keeps it on the same slide.
// - Audience: that second window. It loads the UI with ?audience=<id>, keeps
//   its own copy of the deck and sends its keys and clicks to the presenter.
//
// Keys, as in PowerPoint: Right, Down, Space, Page Down, Enter and N go to
// the next slide; Left, Up, Page Up, Backspace and P the previous; Home and
// End; B (or .) a black screen and W (or ,) a white one, which any key or
// click takes away; a number then Enter jumps to that slide; Esc ends.
// Clickers send Page Up and Page Down.

const NEXT = new Set(['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'PageDown', 'Enter', 'n', 'N'])
const PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'])
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Fn', 'Unidentified'])
const IDLE_MS = 2000 // the mouse cursor hides after this long still
const SWIPE_PX = 40

function useLatest (value) { const ref = useRef(value); ref.current = value; return ref }

// Which slide is on screen, by id, so edits by others (slides added, moved
// or deleted) keep it in place. A slide deleted while on screen gives way to
// the one that took its place.
export function useShow (slides, startId) {
  const [id, setId] = useState(() => startId || (slides[0] ? slides[0].id : null))
  const [blank, setBlank] = useState(null) // 'black', 'white' or null
  const [typed, setTypedRaw] = useState('')
  const typedRef = useRef('')
  const setTyped = (t) => { typedRef.current = t; setTypedRaw(t) }
  const last = useRef(0)
  const at = slides.findIndex((s) => s.id === id)
  if (at >= 0) last.current = at
  const index = at >= 0 ? at : Math.max(0, Math.min(last.current, slides.length - 1))
  const slide = slides[index] || null
  useEffect(() => { if (at < 0 && slide) setId(slide.id) }, [at, slide])

  const go = (i) => {
    const s = slides[Math.max(0, Math.min(slides.length - 1, i))]
    if (s) setId(s.id)
    setBlank(null)
  }
  // True when the key did something.
  const key = (k) => {
    if (MODIFIERS.has(k)) return false
    if (blank) { setBlank(null); setTyped(''); return true }
    if (/^[0-9]$/.test(k)) { setTyped((typedRef.current + k).slice(-4)); return true }
    if (k === 'Enter' && typedRef.current) { go(Number(typedRef.current) - 1); setTyped(''); return true }
    if (typedRef.current) setTyped('')
    if (NEXT.has(k)) { go(index + 1); return true }
    if (PREV.has(k)) { go(index - 1); return true }
    if (k === 'Home') { go(0); return true }
    if (k === 'End') { go(slides.length - 1); return true }
    if (k === 'b' || k === 'B' || k === '.') { setBlank('black'); return true }
    if (k === 'w' || k === 'W' || k === ',') { setBlank('white'); return true }
    return false
  }
  return { slide, index, count: slides.length, blank, setBlank, typed, go, goId: setId, key, next: () => go(index + 1), prev: () => go(index - 1) }
}

// Every key goes to the show while it is on, so nothing reaches the editor
// underneath. onKey gets the key's name.
function useShowKeys (onKey) {
  const ref = useLatest(onKey)
  useEffect(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
    const down = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      ref.current(e.key)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [])
}

// Click for the next slide, right-click for the previous. On a touch screen,
// tap the right half for the next and the left half for the previous, or
// swipe. While the screen is blank any click brings the slide back.
function useTaps (nav) {
  const ref = useLatest(nav)
  const start = useRef(null)
  return {
    onPointerDown: (e) => { start.current = { x: e.clientX, y: e.clientY, type: e.pointerType, button: e.button } },
    onPointerUp: (e) => {
      const s = start.current
      start.current = null
      const n = ref.current
      if (!s) return
      if (n.blank) { n.unblank(); return }
      if (s.button === 2) { n.prev(); return }
      if (s.button !== 0) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) n.next(); else n.prev(); return }
      if (s.type === 'touch') {
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX < r.left + r.width / 2) n.prev(); else n.next()
        return
      }
      n.next()
    },
    onPointerCancel: () => { start.current = null },
    onContextMenu: (e) => e.preventDefault()
  }
}

// True once the pointer has been still for IDLE_MS.
function useIdle () {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), IDLE_MS)
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), IDLE_MS) }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => { clearTimeout(t); window.removeEventListener('pointermove', wake); window.removeEventListener('pointerdown', wake) }
  }, [])
  return idle
}

function usePortrait () {
  const read = () => window.innerHeight > window.innerWidth
  const [portrait, setPortrait] = useState(read)
  useEffect(() => {
    const size = () => setPortrait(read())
    window.addEventListener('resize', size)
    return () => window.removeEventListener('resize', size)
  }, [])
  return portrait
}

// True for a moment each time `value` changes (not at the start).
function useFlash (value, ms = 1200) {
  const [shown, setShown] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setShown(true)
    const t = setTimeout(() => setShown(false), ms)
    return () => clearTimeout(t)
  }, [value])
  return shown
}

// A slide as large as fits in its box, keeping its shape.
export function FitSlide ({ slide, size, theme, className }) {
  const ref = useRef(null)
  const [box, setBox] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (!window.ResizeObserver) return
    const ro = new window.ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = box ? Math.min(box.w / size[0], box.h / size[1]) : 0
  return (
    <div className={'fit-slide' + (className ? ' ' + className : '')} ref={ref}>
      {slide && scale > 0 && (
        <div className='fit-holder' style={{ width: Math.round(size[0] * scale), height: Math.round(size[1] * scale) }}>
          <StaticSlide slide={slide} size={size} theme={theme} scale={scale} />
        </div>
      )}
    </div>
  )
}

const notesOf = (ydoc, id) => {
  const map = id && slidesModel.slide(ydoc, id)
  const notes = map && map.get('notes')
  return notes instanceof Y.XmlFragment ? notes : null
}

// Speaker notes to read, not edit, redrawn as they change.
function StaticNotes ({ fragment }) {
  const ref = useRef(null)
  const [empty, setEmpty] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!fragment) { el.replaceChildren(); setEmpty(true); return }
    const draw = () => {
      const dom = fragmentDom(fragment)
      if (dom) el.replaceChildren(dom)
      else el.replaceChildren()
      setEmpty(!dom)
    }
    draw()
    fragment.observeDeep(draw)
    return () => fragment.unobserveDeep(draw)
  }, [fragment])
  return (
    <div className='present-notes'>
      <div className='present-notes-text' ref={ref} />
      {empty && <p className='present-notes-none'>No speaker notes.</p>}
    </div>
  )
}

// The slides alone, full screen: one display, or a phone.
export function Show ({ deck, ydoc, startId, phone, onEnd }) {
  const show = useShow(deck.slides, startId)
  const end = useLatest(() => onEnd(show.slide ? show.slide.id : null))
  useShowKeys((k) => { if (k === 'Escape') end.current(); else show.key(k) })
  // Android's Back button (mobile/App.js) ends the show.
  useEffect(() => on('app:presentBack', () => end.current()), [])
  const taps = useTaps({ blank: show.blank, unblank: () => show.setBlank(null), next: show.next, prev: show.prev })
  const idle = useIdle()
  const portrait = usePortrait()
  const flash = useFlash(show.index)
  const notes = phone && portrait
  const close = <button className='show-close' aria-label='End the show' title='End the show (Esc)' onClick={() => end.current()}><X size={22} /></button>

  return (
    <div className={'show' + (idle ? ' idle' : '') + (phone ? ' phone' : '') + (notes ? ' with-notes' : '')} role='dialog' aria-label='Slide show'>
      <div className='show-screen' {...taps}>
        <FitSlide slide={show.slide} size={deck.size} theme={deck.theme} />
        {show.blank && <div className={'show-blank ' + show.blank} />}
        {!notes && (flash || show.typed) && !show.blank && <div className='show-number'>{show.typed || (show.index + 1) + ' / ' + show.count}</div>}
      </div>
      {phone && (notes || !idle) && close}
      {notes && (
        <>
          <div className='show-bar'>
            <button className='show-prev' aria-label='Previous slide' title='Previous slide' disabled={show.index === 0} onClick={() => show.prev()}><CaretLeft size={22} /></button>
            <span className='show-count'>Slide {show.index + 1} of {show.count}</span>
            <button className='show-next' aria-label='Next slide' title='Next slide' disabled={show.index >= show.count - 1} onClick={() => show.next()}><CaretRight size={22} /></button>
          </div>
          <StaticNotes key={show.slide ? show.slide.id : ''} fragment={show.slide && notesOf(ydoc, show.slide.id)} />
        </>
      )}
    </div>
  )
}

const pad = (n) => String(n).padStart(2, '0')
function elapsedText (ms) {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(s / 3600)
  return (h ? h + ':' + pad(Math.floor(s / 60) % 60) : pad(Math.floor(s / 60))) + ':' + pad(s % 60)
}

// The presenter view in the main window, with the slides on another display.
export function Presenter ({ deck, ydoc, startId, onEnd }) {
  const show = useShow(deck.slides, startId)
  const showRef = useLatest(show)
  const end = useLatest(() => onEnd(show.slide ? show.slide.id : null))
  useShowKeys((k) => { if (k === 'Escape') end.current(); else show.key(k) })
  // Keys and clicks in the audience window, and its closing.
  useEffect(() => on('app:presentInput', (d) => {
    const k = String((d && d.key) || '')
    if (k === 'Escape') end.current(); else showRef.current.key(k)
  }), [])
  useEffect(() => on('app:presentEnded', () => end.current()), [])
  // The audience window follows.
  const slideId = show.slide ? show.slide.id : null
  useEffect(() => { if (slideId) call('app:presentGo', { slideId, blank: show.blank }).catch(() => {}) }, [slideId, show.blank])

  const [now, setNow] = useState(() => Date.now())
  const [t0, setT0] = useState(() => Date.now())
  const [pausedAt, setPausedAt] = useState(null)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [])
  const elapsed = (pausedAt || now) - t0
  const pause = () => { if (pausedAt) { setT0(t0 + Date.now() - pausedAt); setPausedAt(null) } else setPausedAt(Date.now()) }
  const reset = () => { const t = Date.now(); setT0(t); setNow(t); if (pausedAt) setPausedAt(t) }
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const next = deck.slides[show.index + 1] || null
  const taps = useTaps({ blank: show.blank, unblank: () => show.setBlank(null), next: show.next, prev: show.prev })

  return (
    <div className='presenter' role='dialog' aria-label='Presenter view'>
      <header className='presenter-bar'>
        <div className='presenter-timer'>
          <span className='presenter-elapsed' aria-label='Time elapsed'>{elapsedText(elapsed)}</span>
          <button className='timer-pause' aria-label={pausedAt ? 'Resume the timer' : 'Pause the timer'} title={pausedAt ? 'Resume the timer' : 'Pause the timer'} onClick={pause}>{pausedAt ? <Play size={18} /> : <Pause size={18} />}</button>
          <button className='timer-reset' aria-label='Reset the timer' title='Reset the timer' onClick={reset}><ArrowCounterClockwise size={18} /></button>
        </div>
        <div className='presenter-count'>Slide {show.index + 1} of {show.count}{show.typed ? ' (go to ' + show.typed + ')' : ''}</div>
        <div className='presenter-clock' aria-label='Time'>{clock}</div>
      </header>
      <div className='presenter-body'>
        <div className='presenter-current' {...taps}>
          <FitSlide slide={show.slide} size={deck.size} theme={deck.theme} />
          {show.blank && <div className='presenter-blank'>The screen is {show.blank}. Press any key to show the slide.</div>}
        </div>
        <aside className='presenter-side'>
          <h2>Next</h2>
          <div className='presenter-next' onClick={() => show.next()}>
            {next ? <FitSlide slide={next} size={deck.size} theme={deck.theme} /> : <p className='presenter-end'>End of the show</p>}
          </div>
          <h2>Speaker notes</h2>
          <StaticNotes key={slideId || ''} fragment={slideId && notesOf(ydoc, slideId)} />
        </aside>
      </div>
      <footer className='presenter-foot'>
        <button className='presenter-prev' disabled={show.index === 0} onClick={() => show.prev()}><CaretLeft size={18} /> Previous</button>
        <button className='presenter-next-button' disabled={show.index >= show.count - 1} onClick={() => show.next()}>Next <CaretRight size={18} /></button>
        <button className={'presenter-black' + (show.blank === 'black' ? ' on' : '')} aria-pressed={show.blank === 'black'} onClick={() => show.setBlank(show.blank === 'black' ? null : 'black')}><Square size={18} weight='fill' /> Black</button>
        <button className='presenter-stop' onClick={() => end.current()}><X size={18} /> End show</button>
      </footer>
    </div>
  )
}

// The second window, on the audience's display. It keeps its own copy of
// the deck (slides:state, then doc:updated) and shows the slide the
// presenter is on.
export function Audience ({ sheetId, startId }) {
  const ydoc = useMemo(() => new Y.Doc(), [sheetId])
  useEffect(() => () => ydoc.destroy(), [ydoc])
  useEffect(() => {
    const off = on('doc:updated', (d) => {
      if (d.sheetId !== sheetId) return
      try { Y.applyUpdate(ydoc, fromB64(d.update), 'remote') } catch {}
    })
    call('slides:state', { sheetId, withState: true })
      .then((s) => { if (s.state) Y.applyUpdate(ydoc, fromB64(s.state), 'remote') })
      .catch(() => {})
    return off
  }, [sheetId, ydoc])
  const { deck } = useDeck(ydoc)
  const show = useShow(deck.slides, startId)
  const showRef = useLatest(show)
  useEffect(() => on('app:presentGo', (d) => {
    if (d && d.slideId) showRef.current.goId(String(d.slideId))
    showRef.current.setBlank(d && (d.blank === 'black' || d.blank === 'white') ? d.blank : null)
  }), [])
  const input = (key) => call('app:presentInput', { key }).catch(() => {})
  useShowKeys((k) => { if (k === 'Escape') call('app:presentEnd').catch(() => {}); else input(k) })
  const taps = useTaps({ blank: show.blank, unblank: () => input('Unblank'), next: () => input('ArrowRight'), prev: () => input('ArrowLeft') })
  const idle = useIdle()
  return (
    <div className={'show audience' + (idle ? ' idle' : '')} role='main' aria-label='Slide show'>
      <div className='show-screen' {...taps}>
        <FitSlide slide={show.slide} size={deck.size} theme={deck.theme} />
        {show.blank && <div className={'show-blank ' + show.blank} />}
      </div>
    </div>
  )
}
