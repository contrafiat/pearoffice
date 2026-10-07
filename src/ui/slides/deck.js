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

// Each element as drawn: { id, type, role, frame, text }, plus `style` for
// shapes (slidesModel.style), `layout` for text boxes and shapes
// (slidesModel.textLayout), `pic` and `crop` for pictures and `chart` for
// charts (slidesModel.chartOf: { chart, data }).
export function boxesOf (ydoc, slideId) {
  return slidesModel.elements(ydoc, slideId).map((e) => {
    const role = e.map.get('role')
    const type = e.map.get('type')
    const el = { id: e.id, type, role: type === 'text' && ROLES.includes(role) ? role : null, frame: slidesModel.frame(e.map), text: e.map.get('text') }
    if (type === 'shape') el.style = slidesModel.style(e.map)
    if (type === 'shape' || type === 'text') el.layout = slidesModel.textLayout(e.map)
    if (type === 'picture') {
      el.crop = slidesModel.crop(e.map)
      const str = (k) => String(e.map.get(k) || '')
      el.pic = { ref: str('ref'), hash: str('hash'), mime: str('mime'), w: e.map.get('pw') || 1, h: e.map.get('ph') || 1, alt: str('alt').slice(0, 500) }
      el.text = null
    }
    if (type === 'chart') {
      el.chart = slidesModel.chartOf(e.map)
      el.text = null
    }
    return el
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
