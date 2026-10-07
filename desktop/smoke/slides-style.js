// Smoke test part "slides-style" (proposals/2026-10-06-slides-followups.md):
// a rectangle's fill and outline made see-through from their menus, text
// put at the bottom of the rectangle and of a text box, the text box set
// not to wrap from the right-click menu, a centred box that does not wrap
// (its line grows both ways), a rounded rectangle's corners, arrowheads on
// two lines, a picture
// cropped with its handles (then undone and redone) and all of it kept
// after the deck is reopened.
//
// PEAROFFICE_SMOKE_STYLE_SHOTS=<folder> saves a screenshot of the slide
// there.

const fs = require('node:fs')
const path = require('node:path')

module.exports = async function slidesStyle (t) {
  await t.js("window.__slideErrors = []; window.addEventListener('error', (e) => window.__slideErrors.push(String(e.message)))")
  try {
    return await run(t)
  } catch (err) {
    const errors = await t.js('window.__slideErrors').catch(() => null)
    throw new Error(err.message + (errors && errors.length ? ' (page errors: ' + errors.slice(0, 3).join(' | ') + ')' : ''))
  }
}

async function run (t) {
  const { wc, js, step, waitFor, type, key, sendMod, result, sleep } = t
  const shots = process.env.PEAROFFICE_SMOKE_STYLE_SHOTS
  const count = "document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]').length"
  const elSel = (id) => `.slide-stage .slide-el[data-id="${id}"]`
  const frameOf = (id) => js(`(() => { const el = document.querySelector('${elSel(id)}'); return el ? { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) } : null })()`)
  const centre = async (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const stage = () => js("(() => { const r = document.querySelector('.slide-stage .slide-holder').getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / 1920 } })()")
  const ids = () => js("[...document.querySelectorAll('.slide-stage .slide-el')].map((e) => e.dataset.id)")
  const newId = async (before) => (await ids()).find((x) => !before.includes(x))
  const select = (sel, value) => js(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  async function drag (from, to, { steps = 6, modifiers = [] } = {}) {
    wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= steps; i++) {
      wc.sendInputEvent({ type: 'mouseMove', x: from.x + Math.round((to.x - from.x) * i / steps), y: from.y + Math.round((to.y - from.y) * i / steps), button: 'left', modifiers: ['leftButtonDown', ...modifiers] })
      await sleep(25)
    }
    wc.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 })
    await sleep(120)
  }
  const click = (p, clickCount = 1, button = 'left') => {
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button, clickCount })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button, clickCount })
  }
  // Move a box (by a point a quarter of the way across) to x, y in slide units.
  async function moveTo (id, x, y) {
    const s = await stage()
    const f = await frameOf(id)
    const from = await js(`(() => { const r = document.querySelector('${elSel(id)}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 4), y: Math.round(r.top + r.height / 2) } })()`)
    await drag(from, { x: Math.round(from.x + (x - f.x) * s.k), y: Math.round(from.y + (y - f.y) * s.k) }, { modifiers: ['alt'] })
    await waitFor('moved ' + id, `(() => { const el = document.querySelector('${elSel(id)}'); return Math.abs(parseFloat(el.style.left) - ${x}) < 8 && Math.abs(parseFloat(el.style.top) - ${y}) < 8 })()`, 3000)
  }
  async function insertShape (shape) {
    const before = await ids()
    await js("document.querySelector('.slides-tools .add-shape').click()")
    await waitFor('shape menu', `!!document.querySelector('.shape-menu .shape-${shape}')`)
    result.styleNoCustomInMenu = await js("!document.querySelector('.shape-menu .shape-custom')")
    await js(`document.querySelector('.shape-menu .shape-${shape}').click()`)
    await waitFor('shape ' + shape, `!!document.querySelector('.slide-stage .slide-el[data-type=shape] svg[data-shape=${shape}]') && !!document.querySelector('.sel-frame .handle.h-e')`)
    return newId(before)
  }

  // A blank deck.
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-slides:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-slides').click()")
  await waitFor('slides editor', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 1`)
  if (shots) await js("document.documentElement.dataset.theme = 'light'")
  await select('.slides-tools .layout-select', 'blank')
  await waitFor('blank', "document.querySelectorAll('.slide-stage .slide-el').length === 0")
  step('deck created')

  // A rectangle at half fill opacity and three quarters outline opacity,
  // its text at the bottom.
  const rect = await insertShape('rect')
  await moveTo(rect, 100, 100)
  await js("document.querySelector('.slides-tools .shape-fill').click()")
  await waitFor('fill palette', "!!document.querySelector('.fill-palette .opacity-50')")
  await js("document.querySelector('.fill-palette .opacity-50').click()")
  await waitFor('fill opacity', `document.querySelector('${elSel(rect)} svg g').getAttribute('fill-opacity') === '0.5'`)
  await js("document.querySelector('.slides-tools .shape-line').click()")
  await waitFor('outline palette', "!!document.querySelector('.line-palette .swatch[title=\"#d32f2f\"]')")
  await js("document.querySelector('.line-palette .swatch[title=\"#d32f2f\"]').click()")
  await waitFor('outline set', `document.querySelector('${elSel(rect)} svg g').getAttribute('stroke') === '#d32f2f'`)
  await js("document.querySelector('.slides-tools .shape-line').click()")
  await waitFor('outline palette again', "!!document.querySelector('.line-palette .opacity-75')")
  await js("document.querySelector('.line-palette .opacity-75').click()")
  await waitFor('outline opacity', `document.querySelector('${elSel(rect)} svg g').getAttribute('stroke-opacity') === '0.75'`)
  result.styleOpacity = true
  await waitFor('anchor buttons', "!!document.querySelector('.slides-tools .anchor-bottom:not(:disabled)')")
  result.styleShapeAnchorDefault = await js(`document.querySelector('${elSel(rect)} .slide-text').dataset.anchor === 'middle'`)
  await js("document.querySelector('.slides-tools .anchor-bottom').click()")
  await waitFor('shape text at the bottom', `document.querySelector('${elSel(rect)} .slide-text').dataset.anchor === 'bottom' && document.querySelector('.slides-tools .anchor-bottom').getAttribute('aria-pressed') === 'true'`)
  const rc = await centre(elSel(rect))
  click(rc, 2)
  await waitFor('shape text editor', `document.activeElement && document.activeElement.matches('${elSel(rect)} .ProseMirror')`)
  await type('Low', 30)
  await key('Escape')
  step('opacity, shape text at the bottom')

  // A text box: put at the bottom while typing in it, then set not to wrap
  // from the right-click menu.
  const before = await ids()
  await js("document.querySelector('.slides-tools .add-box').click()")
  await waitFor('box editor', "document.activeElement && document.activeElement.matches('.slide-el[data-type=text] .ProseMirror')")
  const box = await newId(before)
  await type('This line of text runs on and does not wrap', 10)
  await waitFor('anchor while editing', "!!document.querySelector('.slides-tools .anchor-bottom:not(:disabled)')")
  await js("document.querySelector('.slides-tools .anchor-bottom').click()")
  await waitFor('box text at the bottom', `document.querySelector('${elSel(box)} .slide-text').dataset.anchor === 'bottom' && document.activeElement && document.activeElement.matches('${elSel(box)} .ProseMirror')`)
  // The live editor sits at the bottom too.
  const live = await js(`(() => { const box = document.querySelector('${elSel(box)}').getBoundingClientRect(); const p = document.querySelector('${elSel(box)} .ProseMirror p').getBoundingClientRect(); return { box: [box.top, box.bottom, box.height], p: [p.top, p.bottom], css: getComputedStyle(document.querySelector('${elSel(box)} .ProseMirror')).justifyContent } })()`)
  result.styleLiveAnchor = live.box[1] - live.p[1] < live.box[2] * 0.15 && live.css === 'flex-end'
  if (!result.styleLiveAnchor) result.styleLiveAnchorAt = live
  await key('Escape')
  await waitFor('box done', `!document.querySelector('${elSel(box)} .ProseMirror') && (document.querySelector('${elSel(box)} .slide-static') || {}).textContent === 'This line of text runs on and does not wrap'`)
  await js("document.querySelector('.slide-stage').focus()")
  await moveTo(box, 300, 330)
  const bc = await centre(elSel(box))
  click(bc, 1, 'right')
  await waitFor('box menu', "!!document.querySelector('.box-menu .wrap-text')")
  result.styleWrapOnFirst = await js("document.querySelector('.box-menu .wrap-text').getAttribute('aria-checked') === 'true'")
  await js("document.querySelector('.box-menu .wrap-text').click()")
  await waitFor('no wrap', `document.querySelector('${elSel(box)} .slide-text').dataset.wrap === 'false'`)
  // One line, wider than the box.
  result.styleOneLine = await js(`(() => { const p = document.querySelector('${elSel(box)} .slide-static p'); const r = document.createRange(); r.selectNodeContents(p); return r.getClientRects().length === 1 })()`)
  step('text box at the bottom, not wrapping')

  // A second box, centred and not wrapping: its line runs out of both
  // sides of the box evenly.
  const before2 = await ids()
  await js("document.querySelector('.slides-tools .add-box').click()")
  await waitFor('second box editor', "document.activeElement && document.activeElement.matches('.slide-el[data-type=text] .ProseMirror')")
  const cbox = await newId(before2)
  await type('Centred words that run out past both sides of this box and keep going', 5)
  await js("document.querySelector('.slides-tools .align-button').click()")
  await waitFor('align menu', "!!document.querySelector('.menu .align-center')")
  await js("document.querySelector('.menu .align-center').click()")
  await waitFor('centred', `(document.querySelector('${elSel(cbox)} .ProseMirror p') || {}).style?.textAlign === 'center'`)
  await key('Escape')
  await waitFor('second box done', `!document.querySelector('${elSel(cbox)} .ProseMirror') && !!document.querySelector('${elSel(cbox)} .slide-static p')`)
  await js("document.querySelector('.slide-stage').focus()")
  await moveTo(cbox, 560, 760)
  click(await centre(elSel(cbox)), 1, 'right')
  await waitFor('second box menu', "!!document.querySelector('.box-menu .wrap-text')")
  await js("document.querySelector('.box-menu .wrap-text').click()")
  await waitFor('second box no wrap', `document.querySelector('${elSel(cbox)} .slide-text').dataset.wrap === 'false'`)
  // The line's middle is the box's middle, and it is wider than the box.
  const centredLine = () => js(`(() => { const b = document.querySelector('${elSel(cbox)}').getBoundingClientRect(); const p = document.querySelector('${elSel(cbox)} .slide-static p').getBoundingClientRect(); return p.left < b.left && p.right > b.right && Math.abs((p.left + p.right) / 2 - (b.left + b.right) / 2) < b.width * 0.02 })()`)
  result.styleCentredUnwrapped = await centredLine()
  if (!result.styleCentredUnwrapped) throw new Error('centred unwrapped text is not centred on its box')
  step('centred text grows both ways')

  // A rounded rectangle: medium corners at first, then large.
  const rr = await insertShape('roundRect')
  await moveTo(rr, 100, 560)
  await waitFor('corner select', "!!document.querySelector('.slides-tools .corner-radius')")
  result.styleCornerDefault = await js("document.querySelector('.slides-tools .corner-radius').value === '0.16667'")
  await select('.slides-tools .corner-radius', '0.25')
  const corner = (k) => `(() => { const r = document.querySelector('${elSel(rr)} svg rect'); const w = parseFloat(r.getAttribute('width')); const h = parseFloat(r.getAttribute('height')); return Math.abs(parseFloat(r.getAttribute('rx')) - Math.min(w, h) * ${k}) < 0.5 })()`
  await waitFor('large corners', corner(0.25))
  result.styleCorners = true
  step('corners')

  // Two lines: an arrow and a triangle, then a circle.
  const line1 = await insertShape('line')
  await moveTo(line1, 1000, 120)
  await waitFor('line tools', "!!document.querySelector('.slides-tools .line-head') && !!document.querySelector('.slides-tools .line-tail')")
  await select('.slides-tools .line-head', 'arrow')
  await select('.slides-tools .line-tail', 'triangle')
  await waitFor('arrowheads', `(() => { const s = document.querySelector('${elSel(line1)} svg'); return s.dataset.head === 'arrow' && s.dataset.tail === 'triangle' && !!s.querySelector('polyline') && !!s.querySelector('polygon') })()`)
  const line2 = await insertShape('line')
  await moveTo(line2, 1000, 220)
  await select('.slides-tools .line-tail', 'oval')
  await waitFor('circle end', `(() => { const s = document.querySelector('${elSel(line2)} svg'); return s.dataset.tail === 'oval' && !!s.querySelector('ellipse') })()`)
  result.styleArrows = true
  step('arrowheads')

  // A picture, cropped from the right by a quarter with its handle.
  await js(`(async () => {
    const c = document.createElement('canvas')
    c.width = 320; c.height = 160
    const g = c.getContext('2d')
    g.fillStyle = '#3b6e22'; g.fillRect(0, 0, 320, 160)
    g.fillStyle = '#f0c040'; g.fillRect(80, 40, 160, 80)
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'box.png', { type: 'image/png' }))
    const input = document.querySelector('.slides-tools .slide-picture-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('picture shown', "(() => { const i = document.querySelector('.slide-stage .slide-el[data-type=picture] img.slide-picture'); return !!i && i.complete && i.naturalWidth === 320 })()")
  const pic = await js("document.querySelector('.slide-stage .slide-el[data-type=picture]').dataset.id")
  await moveTo(pic, 1000, 420)
  const f0 = await frameOf(pic)
  await waitFor('crop button', "!!document.querySelector('.slides-tools .crop-button')")
  await js("document.querySelector('.slides-tools .crop-button').click()")
  await waitFor('crop handles', "!!document.querySelector('.sel-frame.cropping .crop-handle.h-e') && !!document.querySelector('.crop-ghost img')")
  const s = await stage()
  const e = await centre('.sel-frame.cropping .crop-handle.h-e')
  await drag(e, { x: Math.round(e.x - f0.w * 0.25 * s.k), y: e.y }, { modifiers: ['alt'] })
  await waitFor('crop drawn', `!!document.querySelector('${elSel(pic)} img.slide-picture.cropped')`)
  await key('Return')
  await waitFor('crop written', `!document.querySelector('.crop-ghost') && !!document.querySelector('${elSel(pic)} img.slide-picture.cropped')`)
  const cropped = async () => js(`(() => { const el = document.querySelector('${elSel(pic)}'); const i = el.querySelector('img.slide-picture'); return { w: parseFloat(el.style.width), left: parseFloat(el.style.left), cropped: i.classList.contains('cropped'), iw: parseFloat(i.style.width || '100') } })()`)
  const c1 = await cropped()
  // A quarter off the right: the frame is three quarters as wide, the
  // picture inside drawn a third wider than it.
  result.styleCrop = Math.abs(c1.w - f0.w * 0.75) < f0.w * 0.04 && c1.left === f0.x && Math.abs(c1.iw - 133.33) < 6
  if (!result.styleCrop) throw new Error('crop: ' + JSON.stringify({ f0, c1 }))
  // Undo and redo the crop.
  await js("document.querySelector('.slide-stage').focus()")
  await sendMod('Z', ['control'])
  await waitFor('crop undone', `(() => { const el = document.querySelector('${elSel(pic)}'); return !el.querySelector('img.cropped') && Math.abs(parseFloat(el.style.width) - ${f0.w}) < 2 })()`)
  await sendMod('Y', ['control'])
  await waitFor('crop redone', `!!document.querySelector('${elSel(pic)} img.slide-picture.cropped')`)
  result.styleCropUndo = true
  step('picture cropped, undone, redone')

  if (shots) {
    await js("document.querySelector('.slide-stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
    await sleep(400)
    fs.mkdirSync(shots, { recursive: true })
    const r = await js("(() => { const b = document.querySelector('.slide-stage .slide').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) } })()")
    fs.writeFileSync(path.join(shots, 'style.png'), (await wc.capturePage(r)).toPNG())
  }

  // Reopen: every setting is kept.
  await sleep(700)
  await js("document.querySelector('.sheet-link.all-files').click()")
  await waitFor('deck in all files', "[...document.querySelectorAll('.file-card')].some((c) => !!c.querySelector('.kind-icon.kind-slides'))")
  await js("[...document.querySelectorAll('.file-card')].find((c) => !!c.querySelector('.kind-icon.kind-slides')).click()")
  await waitFor('deck reopened', `!!document.querySelector('${elSel(rect)}') && !!document.querySelector('${elSel(pic)} img.slide-picture')`)
  result.stylePersisted = await js(`(() => {
    const g = document.querySelector('${elSel(rect)} svg g')
    const l1 = document.querySelector('${elSel(line1)} svg')
    const l2 = document.querySelector('${elSel(line2)} svg')
    const p = document.querySelector('${elSel(pic)}')
    return g.getAttribute('fill-opacity') === '0.5' && g.getAttribute('stroke-opacity') === '0.75' &&
      document.querySelector('${elSel(rect)} .slide-text').dataset.anchor === 'bottom' &&
      document.querySelector('${elSel(box)} .slide-text').dataset.anchor === 'bottom' &&
      document.querySelector('${elSel(box)} .slide-text').dataset.wrap === 'false' &&
      l1.dataset.head === 'arrow' && l1.dataset.tail === 'triangle' && l2.dataset.tail === 'oval' &&
      !!p.querySelector('img.slide-picture.cropped') && Math.abs(parseFloat(p.style.width) - ${c1.w}) < 2 &&
      document.querySelector('${elSel(cbox)} .slide-text').dataset.wrap === 'false' && ${corner(0.25)}
  })()`) && await centredLine()
  if (!result.stylePersisted) throw new Error('not kept after reopening')
  step('deck reopened')

  return result.styleNoCustomInMenu && result.styleOpacity && result.styleShapeAnchorDefault && result.styleLiveAnchor && result.styleWrapOnFirst && result.styleOneLine && result.styleCentredUnwrapped && result.styleCornerDefault && result.styleCorners && result.styleArrows && result.styleCrop && result.styleCropUndo && result.stylePersisted
}
