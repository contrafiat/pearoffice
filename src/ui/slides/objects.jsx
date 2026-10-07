import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { call } from '../bridge.js'
import { pictureCache, fromB64 } from '../doc/pictures.js'

// Shapes and pictures on a slide (proposals/2026-10-06-slides.md, part 3),
// drawn the same way in the editor's stage, the slide list and the show.
//
// A shape is an inline SVG that fills its frame. A line runs across the
// middle of its frame from left to right; rotate it for any other angle. A
// picture is an <img> of bytes fetched with slides:picture, stretched to
// its frame, with a grey box and its alt text until they arrive.

const RETRY_MS = 15000

export const SHAPE_LABELS = {
  rect: 'Rectangle',
  roundRect: 'Rounded rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  arrow: 'Arrow',
  line: 'Line'
}

// The pictures fetched for one open deck. The editor and the audience
// window each make one (usePictureCache) and hand it down.
export const PicturesContext = createContext(null)

export function usePictureCache (sheetId) {
  const cache = useMemo(() => pictureCache(async (a) => fromB64((await call('slides:picture', { sheetId, ref: a.ref, hash: a.hash })).data)), [sheetId])
  useEffect(() => () => cache.clear(), [cache])
  return cache
}

// A stored colour as CSS: a theme slot reads the slide's variables
// (themes.js, themeStyle), so a new theme recolours every shape.
export function colourCss (c) {
  if (!c || c === 'none') return 'none'
  if (c === 'text') return 'var(--slide-ink)'
  if (c === 'background') return 'var(--slide-bg)'
  if (/^accent[1-6]$/.test(c)) return 'var(--' + c + ')'
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : 'none'
}

// The SVG outline of a shape in a w by h box, kept inside the box by half
// the outline width.
function shapePath (shape, w, h, s) {
  const x0 = s
  const y0 = s
  const x1 = Math.max(x0, w - s)
  const y1 = Math.max(y0, h - s)
  const iw = x1 - x0
  const ih = y1 - y0
  switch (shape) {
    case 'roundRect': {
      const r = Math.min(iw, ih) * 0.16
      return <rect x={x0} y={y0} width={iw} height={ih} rx={r} ry={r} />
    }
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={iw / 2} ry={ih / 2} />
    case 'triangle':
      return <polygon points={[w / 2, y0, x1, y1, x0, y1].join(' ')} />
    case 'arrow': {
      // A block arrow pointing right: the shaft is the middle 40 percent.
      const head = Math.min(iw * 0.5, ih * 0.8)
      const t = y0 + ih * 0.3
      const b = y0 + ih * 0.7
      const hx = x1 - head
      return <polygon points={[x0, t, hx, t, hx, y0, x1, h / 2, hx, y1, hx, b, x0, b].join(' ')} />
    }
    case 'line':
      return <line x1={0} y1={h / 2} x2={w} y2={h / 2} />
    default:
      return <rect x={x0} y={y0} width={iw} height={ih} />
  }
}

// A shape drawn to fill its frame. `style` is slidesModel.style's answer.
export function ShapeSvg ({ style, w, h, className }) {
  const line = style.lineW > 0 ? colourCss(style.line) : 'none'
  const sw = line === 'none' ? 0 : style.lineW
  const fill = style.shape === 'line' ? 'none' : colourCss(style.fill)
  return (
    <svg className={'slide-shape' + (className ? ' ' + className : '')} data-shape={style.shape} width='100%' height='100%' viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio='none' aria-hidden='true'>
      <g fill={fill} stroke={line} strokeWidth={sw} strokeLinejoin='round' strokeLinecap={style.shape === 'line' ? 'round' : 'butt'}>
        {shapePath(style.shape, w, h, style.shape === 'line' ? 0 : sw / 2)}
      </g>
    </svg>
  )
}

// A shape as a small icon for menus, in the text colour.
export function ShapeIcon ({ shape, size = 20 }) {
  const w = 24
  const h = shape === 'line' ? 24 : shape === 'arrow' || shape === 'rect' || shape === 'roundRect' ? 16 : 20
  return (
    <svg width={size} height={size * h / w} viewBox={'0 0 ' + w + ' ' + h} aria-hidden='true' style={shape === 'line' ? { transform: 'rotate(-45deg)' } : undefined}>
      <g fill={shape === 'line' ? 'none' : 'currentColor'} stroke='currentColor' strokeWidth={shape === 'line' ? 2 : 0}>
        {shapePath(shape, w, h, 0)}
      </g>
    </svg>
  )
}

// A picture from the deck's picture cache. While its bytes are missing, a
// grey box with its alt text; a failed fetch is tried again later.
export function SlidePicture ({ pic }) {
  const cache = useContext(PicturesContext)
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!cache || !pic.ref) return
    let live = true
    let retry = null
    const load = () => {
      cache.get(pic).then((u) => { if (live) { setUrl(u); setFailed(false) } }, () => {
        if (!live) return
        setFailed(true)
        retry = setTimeout(load, RETRY_MS)
      })
    }
    setUrl(null)
    load()
    return () => { live = false; clearTimeout(retry) }
  }, [cache, pic.ref, pic.hash])
  if (url) return <img className='slide-picture' src={url} alt={pic.alt} data-ref={pic.ref} draggable={false} />
  return (
    <div className='slide-picture-wait' role='img' aria-label={pic.alt || 'Picture'}>
      <span>{pic.alt || (failed ? 'This picture is not available yet' : 'Picture loading')}</span>
    </div>
  )
}

// The text colour that reads on a shape's fill: the slide's background
// colour on theme colours and dark fills, the text colour otherwise.
function inkOn (fill) {
  if (fill === 'none' || fill === 'background') return 'var(--slide-ink)'
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill)
  if (!m) return 'var(--slide-bg)'
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#000000' : '#ffffff'
}

// What a slide element draws inside its frame div: `text` is the element's
// text, drawn by the caller (static or live).
export function ElementBody ({ el, frame, text }) {
  if (el.type === 'picture') return <SlidePicture pic={el.pic} />
  if (el.type === 'shape') {
    return (
      <>
        <ShapeSvg style={el.style} w={frame.w} h={frame.h} />
        {el.style.shape !== 'line' && <div className='shape-ink' style={{ color: inkOn(el.style.fill) }}>{text}</div>}
      </>
    )
  }
  return text
}

// Can this element hold text?
export const hasText = (el) => el.type === 'text' || (el.type === 'shape' && el.style.shape !== 'line')
