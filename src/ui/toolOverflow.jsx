// Desktop toolbars keep to one row: tools that do not fit are hidden and a
// More tools button at the end shows them all, wrapping onto more rows.
// An item with the class `tool-keep` (Present) always stays. Phones keep
// their one scrolling row; there the bar gets `data-fade-start` and
// `data-fade-end` while more tools lie past that edge, for a fade.
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'

const HIDDEN = 'data-tool-hidden' // an attribute React leaves alone, unlike className

// A phone's scrolling row: which edges have tools hidden past them.
function fades (el) {
  if (!el.dataset.fadeWatch) {
    el.dataset.fadeWatch = ''
    el.addEventListener('scroll', () => fades(el), { passive: true })
  }
  const max = el.scrollWidth - el.clientWidth
  el.toggleAttribute('data-fade-start', max > 1 && el.scrollLeft > 1)
  el.toggleAttribute('data-fade-end', max > 1 && el.scrollLeft < max - 1)
}

export function useToolOverflow (enabled = true) {
  const bar = useRef(null)
  const watch = useRef(null) // the ResizeObserver on the bar
  const [open, setOpen] = useState(false)
  const openRef = useRef(open)
  openRef.current = open

  const measure = useCallback(() => {
    const el = bar.current
    if (!el) return
    if (!enabled) { fades(el); return }
    const kids = [...el.children]
    for (const k of kids) k.removeAttribute(HIDDEN)
    const more = kids.find((k) => k.classList.contains('tool-more'))
    if (!enabled || !more || openRef.current) return
    // Read every width first (one layout), then hide.
    const style = getComputedStyle(el)
    const gap = parseFloat(style.columnGap) || 0
    const avail = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 4
    const width = (el) => {
      const s = getComputedStyle(el)
      if (s.display === 'none') return null
      const margins = el.classList.contains('tool-keep') ? 0 : parseFloat(s.marginLeft) + parseFloat(s.marginRight)
      return el.getBoundingClientRect().width + margins
    }
    const items = kids.map((el) => ({ el, w: width(el), keep: el.classList.contains('tool-keep') })).filter((x) => x.w !== null)
    const tools = items.filter((x) => x.el !== more && !x.keep)
    const keepW = items.filter((x) => x.keep).reduce((n, x) => n + x.w + gap, 0)
    const all = tools.reduce((n, x) => n + x.w + gap, 0) + keepW - gap
    if (all <= avail) { more.setAttribute(HIDDEN, ''); return }
    let budget = avail - keepW - (items.find((x) => x.el === more).w + gap)
    let i = 0
    for (; i < tools.length && tools[i].w + gap <= budget; i++) budget -= tools[i].w + gap
    // No divider left dangling before the button.
    while (i > 0 && tools[i - 1].el.classList.contains('sep')) i--
    for (const x of tools.slice(i)) x.el.setAttribute(HIDDEN, '')
  }, [enabled])

  // After every render (tools come and go with the selection) and on resize.
  // The bar may appear after the editor first renders (while it loads), so
  // the resize watch starts when the bar itself does.
  useLayoutEffect(measure)
  const ref = useCallback((el) => {
    if (watch.current) { watch.current.disconnect(); watch.current = null }
    bar.current = el
    if (el) {
      watch.current = new ResizeObserver(() => measure())
      watch.current.observe(el)
    }
  }, [enabled, measure])

  const moreButton = enabled
    ? (
      <button
        type='button'
        className={'tool-more' + (open ? ' open' : '')}
        aria-label={open ? 'Fewer tools' : 'More tools'}
        title={open ? 'Fewer tools' : 'More tools'}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <CaretDown size={16} weight='bold' aria-hidden='true' />
      </button>
      )
    : null
  return { ref, moreButton }
}
