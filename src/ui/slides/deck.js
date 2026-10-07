import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import slidesModel from '../../slides/slidesModel.js'
import { ROLES } from '../../slides/layouts.js'
import { themeFor } from './themes.js'

// The deck as drawn, read from a replica of its Yjs doc. Used by the editor
// (SlidesView.jsx) and by the show in a second window (Present.jsx).

// Redrawn when slides, boxes or deck settings change. Typing changes only
// text inside a fragment, which each box draws for itself.
export function useDeckVersion (ydoc) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const slides = ydoc.getMap('slides')
    const deck = ydoc.getMap('deck')
    const isText = (ev) => ev.target instanceof Y.XmlFragment || ev.target instanceof Y.XmlElement || ev.target instanceof Y.XmlText
    const deep = (events) => { if (!events.every(isText)) setVersion((v) => v + 1) }
    const bump = () => setVersion((v) => v + 1)
    slides.observeDeep(deep)
    deck.observe(bump)
    return () => { slides.unobserveDeep(deep); deck.unobserve(bump) }
  }, [ydoc])
  return version
}

export function boxesOf (ydoc, slideId) {
  return slidesModel.elements(ydoc, slideId).map((e) => {
    const role = e.map.get('role')
    return { id: e.id, role: ROLES.includes(role) ? role : null, frame: slidesModel.frame(e.map), text: e.map.get('text') }
  })
}

// { size, theme, slides: [{ id, layout, els }] } and the version it was
// drawn at.
export function useDeck (ydoc) {
  const version = useDeckVersion(ydoc)
  const deck = useMemo(() => ({
    size: slidesModel.size(ydoc),
    theme: themeFor(slidesModel.theme(ydoc)),
    slides: slidesModel.slides(ydoc).map((s) => ({ id: s.id, layout: s.map.get('layout'), els: boxesOf(ydoc, s.id) }))
  }), [ydoc, version])
  return { deck, version }
}
