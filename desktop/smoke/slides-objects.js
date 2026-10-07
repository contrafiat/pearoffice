// Smoke test part "slides-objects": every shape inserted, resized and moved
// with real mouse events, a shape's fill, outline and width changed, text
// typed in a rectangle, a picture inserted from a generated PNG, resized
// (keeping its shape), moved and given alt text, the slide duplicated with
// its picture, the four themes, the show drawing shapes and the picture,
// then the deck reopened.
//
// PEAROFFICE_SMOKE_OBJECTS_SHOTS=<folder> saves a screenshot per theme and
// one of the shape colour menu there.

const fs = require('node:fs')
const path = require('node:path')

module.exports = async function slidesObjects (t) {
  await t.js("window.__slideErrors = []; window.addEventListener('error', (e) => window.__slideErrors.push(String(e.message)))")
  try {
    return await run(t)
  } catch (err) {
    const errors = await t.js('window.__slideErrors').catch(() => null)
    throw new Error(err.message + (errors && errors.length ? ' (page errors: ' + errors.slice(0, 3).join(' | ') + ')' : ''))
  }
}

const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'arrow', 'line']
const SPOTS = [[100, 320], [400, 320], [700, 320], [100, 600], [400, 600], [700, 680]].map(([x, y], i) => ({ x, y, w: 240, h: i === 5 ? 40 : 200 }))
const THEMES = { plain: 'rgb(255, 255, 255)', midnight: 'rgb(22, 26, 38)', paper: 'rgb(246, 239, 226)', vivid: 'rgb(55, 48, 163)' }

async function run (t) {
  const { wc, js, step, waitFor, type, key, sendMod, result, sleep } = t
  const shots = process.env.PEAROFFICE_SMOKE_OBJECTS_SHOTS
  const shot = async (name) => {
    if (!shots) return
    await sleep(300)
    fs.mkdirSync(shots, { recursive: true })
    fs.writeFileSync(path.join(shots, name + '.png'), (await wc.capturePage()).toPNG())
  }

  const count = "document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]').length"
  const elSel = (id) => `.slide-stage .slide-el[data-id="${id}"]`
  const frameOf = (id) => js(`(() => { const el = document.querySelector('${elSel(id)}'); return el ? { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) } : null })()`)
  const centre = async (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  // Where the slide's corner is on screen, with screen pixels per slide unit.
  const stage = () => js("(() => { const r = document.querySelector('.slide-stage .slide-holder').getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / 1920 } })()")
  async function drag (from, to, { steps = 6, modifiers = [] } = {}) {
    wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= steps; i++) {
      wc.sendInputEvent({ type: 'mouseMove', x: from.x + Math.round((to.x - from.x) * i / steps), y: from.y + Math.round((to.y - from.y) * i / steps), button: 'left', modifiers: ['leftButtonDown', ...modifiers] })
      await sleep(25)
    }
    wc.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 })
    await sleep(120)
  }
  const click = (p, clickCount = 1) => {
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount })
  }
  // Resize from the bottom right corner, then move, to a frame in slide units.
  async function place (id, target, { resize = true } = {}) {
    const s = await stage()
    // Drags land to the nearest screen pixel: allow 3 of them, in slide units
    // (a small window, as on the Windows build VM, has bigger ones).
    const tol = Math.max(8, Math.ceil(3 / s.k))
    if (resize) {
      const f = await frameOf(id)
      const se = await centre((await js("!!document.querySelector('.sel-frame .handle.h-se')")) ? '.sel-frame .handle.h-se' : '.sel-frame .handle.h-e')
      await drag(se, { x: Math.round(se.x + (target.w - f.w) * s.k), y: Math.round(se.y + (target.h - f.h) * s.k) }, { modifiers: ['alt'] })
      await waitFor('resized ' + id, `(() => { const el = document.querySelector('${elSel(id)}'); return Math.abs(parseFloat(el.style.width) - ${target.w}) < ${tol} })()`, 5000)
        .catch(async (err) => { throw new Error(err.message + ' ' + JSON.stringify({ f, se, target, now: await frameOf(id), s })) })
    }
    const f = await frameOf(id)
    // A quarter of the way across: a thin line's middle is under its handles.
    const from = await js(`(() => { const r = document.querySelector('${elSel(id)}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 4), y: Math.round(r.top + r.height / 2) } })()`)
    const dx = (target.x - f.x) * s.k
    const dy = (target.y - f.y) * s.k
    await drag(from, { x: Math.round(from.x + dx), y: Math.round(from.y + dy) }, { modifiers: ['alt'] })
    await waitFor('moved ' + id, `(() => { const el = document.querySelector('${elSel(id)}'); return Math.abs(parseFloat(el.style.left) - ${target.x}) < ${tol} && Math.abs(parseFloat(el.style.top) - ${target.y}) < ${tol} })()`, 3000)
      .catch(async (err) => { throw new Error(err.message + ' ' + JSON.stringify({ f, from, dx, dy, now: await frameOf(id), s })) })
  }

  // A deck, its first slide made Title only, with a title.
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-slides:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-slides').click()")
  await waitFor('slides editor', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 1`)
  if (shots) await js("document.documentElement.dataset.theme = 'light'")
  result.objectsThemePicker = await js("(() => { const s = document.querySelector('.slides-tools .theme-select'); return !!s && !s.disabled && [...s.options].map((o) => o.value).join(',') === 'plain,midnight,paper,vivid' })()")
  await js("(() => { const s = document.querySelector('.slides-tools .layout-select'); s.value = 'titleOnly'; s.dispatchEvent(new Event('change', { bubbles: true })) })()")
  await waitFor('title only', "document.querySelectorAll('.slide-stage .slide-el').length === 1")
  const title = await centre('.slide-stage .slide-el[data-role=title]')
  click(title)
  click(title, 2)
  await waitFor('title editor', "document.activeElement && document.activeElement.matches('.slide-el[data-role=title] .ProseMirror')")
  await type('Shapes and pictures', 20)
  await key('Escape')
  await waitFor('title typed', "(document.querySelector('.slide-stage .slide-el[data-role=title] .slide-static') || {}).textContent === 'Shapes and pictures'")
  step('deck created')

  // Each shape from the Insert shape menu: drawn as its SVG, selected, then
  // sized and placed in a grid.
  const shapeIds = {}
  const drew = {}
  for (const [i, shape] of SHAPES.entries()) {
    const before = await js("[...document.querySelectorAll('.slide-stage .slide-el')].map((e) => e.dataset.id).join(',')")
    await js("document.querySelector('.slides-tools .add-shape').click()")
    await waitFor('shape menu', `!!document.querySelector('.shape-menu .shape-${shape}')`)
    await js(`document.querySelector('.shape-menu .shape-${shape}').click()`)
    await waitFor('shape ' + shape, `!!document.querySelector('.slide-stage .slide-el[data-type=shape] svg[data-shape=${shape}] g > *') && !!document.querySelector('.sel-frame .handle.h-e')`)
    const id = await js(`(() => { const old = ${JSON.stringify(before)}.split(','); return [...document.querySelectorAll('.slide-stage .slide-el')].map((e) => e.dataset.id).find((x) => !old.includes(x)) })()`)
    shapeIds[shape] = id
    drew[shape] = await js(`(() => { const g = document.querySelector('${elSel(id)} svg g'); return g.getAttribute(${JSON.stringify(shape === 'line' ? 'stroke' : 'fill')}) })()`)
    await place(id, SPOTS[i])
  }
  result.objectsShapes = SHAPES.every((s) => drew[s] === (s === 'line' ? 'var(--slide-ink)' : 'var(--accent1)'))
  if (!result.objectsShapes) throw new Error('shapes drawn: ' + JSON.stringify(drew))
  step('shapes inserted')

  // Fill, outline and width on the rectangle, through the shape tools.
  const rect = shapeIds.rect
  click(await centre(elSel(rect)))
  await waitFor('rect selected', "!!document.querySelector('.slides-tools .shape-fill')")
  await js("document.querySelector('.slides-tools .shape-fill').click()")
  await waitFor('fill palette', "!!document.querySelector('.fill-palette .slot-accent2')")
  await shot('shape-tools')
  await js("document.querySelector('.fill-palette .slot-accent2').click()")
  await waitFor('fill set', `document.querySelector('${elSel(rect)} svg g').getAttribute('fill') === 'var(--accent2)'`)
  await js("document.querySelector('.slides-tools .shape-line').click()")
  await waitFor('outline palette', "!!document.querySelector('.line-palette .swatch[title=\"#d32f2f\"]')")
  await js("document.querySelector('.line-palette .swatch[title=\"#d32f2f\"]').click()")
  await waitFor('outline set', `(() => { const g = document.querySelector('${elSel(rect)} svg g'); return g.getAttribute('stroke') === '#d32f2f' && g.getAttribute('stroke-width') === '4' })()`)
  await js("(() => { const s = document.querySelector('.slides-tools .line-width'); s.value = '8'; s.dispatchEvent(new Event('change', { bubbles: true })) })()")
  await waitFor('width set', `document.querySelector('${elSel(rect)} svg g').getAttribute('stroke-width') === '8'`)
  // Text in the rectangle, typed after a double click.
  const rc = await centre(elSel(rect))
  click(rc, 2)
  await waitFor('shape text editor', `document.activeElement && document.activeElement.matches('${elSel(rect)} .ProseMirror')`)
  await type('Hi', 30)
  await key('Escape')
  await waitFor('shape text', `(document.querySelector('${elSel(rect)} .slide-static') || {}).textContent === 'Hi'`)
  result.objectsStyle = true
  step('shape styled, text typed')

  // A picture from a generated PNG (320 by 160, green with a yellow box).
  await js(`(async () => {
    const c = document.createElement('canvas')
    c.width = 320; c.height = 160
    const g = c.getContext('2d')
    g.fillStyle = '#3b6e22'; g.fillRect(0, 0, 320, 160)
    g.fillStyle = '#f0c040'; g.fillRect(40, 40, 120, 80)
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'box.png', { type: 'image/png' }))
    const input = document.querySelector('.slides-tools .slide-picture-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('picture shown', "(() => { const i = document.querySelector('.slide-stage .slide-el[data-type=picture] img.slide-picture'); return !!i && i.src.startsWith('blob:') && i.complete && i.naturalWidth === 320 })()")
  const pic = await js("document.querySelector('.slide-stage .slide-el[data-type=picture]').dataset.id")
  const deckId = await js("window.pearoffice.call('sheet:list', {}).then((l) => l.find((x) => x.kind === 'slides').sheetId)")
  // The deck reaches the worklet a moment after the edit.
  await waitFor('picture in the worklet\'s deck', `window.pearoffice.call('slides:picture', { sheetId: ${JSON.stringify(deckId)}, ref: document.querySelector('${elSel(pic)} img').dataset.ref }).then(() => true, () => false)`)
  // The picture shown is the one the worklet stored (slides:picture): the
  // stored bytes, drawn, give the same pixels, and those are the PNG's
  // colours. (The page's security policy keeps fetch away from blob: URLs.)
  const bytes = await js(`(async () => {
    const img = document.querySelector('${elSel(pic)} img')
    const stored = await window.pearoffice.call('slides:picture', { sheetId: ${JSON.stringify(deckId)}, ref: img.dataset.ref })
    const back = new Image()
    await new Promise((resolve, reject) => { back.onload = resolve; back.onerror = reject; back.src = 'data:image/png;base64,' + stored.data })
    const pixels = (i) => { const c = document.createElement('canvas'); c.width = 320; c.height = 160; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, 320, 160).data }
    const a = pixels(img)
    const b = pixels(back)
    let same = a.length === b.length
    for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false
    const at = (x, y) => [...a.slice((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)]
    const near = (p, q) => p.every((v, i) => Math.abs(v - q[i]) < 24)
    return { same, colours: near(at(10, 10), [0x3b, 0x6e, 0x22]) && near(at(100, 80), [0xf0, 0xc0, 0x40]), ref: /^[0-9a-f]{64}:/.test(img.dataset.ref || '') }
  })()`)
  result.objectsPictureBytes = bytes.same && bytes.colours && bytes.ref
  if (!result.objectsPictureBytes) throw new Error('picture bytes: ' + JSON.stringify(bytes))
  step('picture inserted')

  // Resize by the corner: the picture keeps its 2:1 shape. Then move it.
  const s0 = await stage()
  const f0 = await frameOf(pic)
  const se = await centre('.sel-frame .handle.h-se')
  await drag(se, { x: Math.round(se.x + 400 * s0.k), y: Math.round(se.y + 40 * s0.k) }, { modifiers: ['alt'] })
  await waitFor('picture resized', `(() => { const el = document.querySelector('${elSel(pic)}'); return parseFloat(el.style.width) > ${f0.w + 100} })()`)
  const f1 = await frameOf(pic)
  result.objectsPictureAspect = Math.abs(f1.w / f1.h - 2) < 0.05
  await place(pic, { x: 1040, y: 320, w: f1.w, h: f1.h }, { resize: false })
  const f2 = await frameOf(pic)
  const tol = Math.max(8, Math.ceil(3 / (await stage()).k)) // as in place()
  result.objectsPictureMoved = Math.abs(f2.x - 1040) < tol && Math.abs(f2.y - 320) < tol
  if (!result.objectsPictureAspect || !result.objectsPictureMoved) throw new Error('picture frames: ' + JSON.stringify({ f0, f1, f2 }))
  // Alt text from the right-click menu.
  const pc = await centre(elSel(pic))
  wc.sendInputEvent({ type: 'mouseDown', x: pc.x, y: pc.y, button: 'right', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: pc.x, y: pc.y, button: 'right', clickCount: 1 })
  await waitFor('box menu', "!!document.querySelector('.box-menu .alt-text')")
  await js("document.querySelector('.box-menu .alt-text').click()")
  await waitFor('alt field', "document.activeElement && document.activeElement.id === 'slide-alt'")
  await type('Green box', 20)
  await key('Return')
  await waitFor('alt saved', `document.querySelector('${elSel(pic)} img').alt === 'Green box' && !document.querySelector('.alt-edit')`)
  step('picture resized, moved, alt text')

  // Thumbnails draw shapes and the picture.
  await waitFor('thumbnail objects', "!!document.querySelector('.slide-thumb .thumb svg[data-shape=arrow]') && (() => { const i = document.querySelector('.slide-thumb .thumb img.slide-picture'); return !!i && i.complete && i.naturalWidth === 320 })()")
  const firstSlide = await js("document.querySelector('.slide-thumb.current').dataset.id")
  // The four themes: the stage and the thumbnail take each background.
  const bg = "[getComputedStyle(document.querySelector('.slide-stage .slide')).backgroundColor, getComputedStyle(document.querySelector('.slide-thumb .thumb .slide')).backgroundColor].join('|')"
  const seen = {}
  for (const id of ['plain', 'midnight', 'paper', 'vivid']) {
    await js(`(() => { const s = document.querySelector('.slides-tools .theme-select'); s.value = '${id}'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await waitFor('theme ' + id, `${bg} === ${JSON.stringify(THEMES[id] + '|' + THEMES[id])}`)
    seen[id] = true
    // Nothing selected, for the picture.
    await js("document.querySelector('.slide-stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
    await shot('theme-' + id)
  }
  result.objectsThemes = Object.keys(seen).length === 4
  step('four themes')

  // Duplicate the slide: the copy shows the same picture.
  await js("document.querySelector('.slide-thumbs').focus()")
  await sendMod('D', ['control'])
  await waitFor('duplicated', `${count} === 2 && document.querySelector('.slide-thumb.current').dataset.id !== ${JSON.stringify(firstSlide)}`)
  await waitFor('copy shows the picture', "(() => { const i = document.querySelector('.slide-stage .slide-el[data-type=picture] img.slide-picture'); return !!i && i.complete && i.naturalWidth === 320 && i.alt === 'Green box' })() && document.querySelectorAll('.slide-stage .slide-el[data-type=shape]').length === 6")
  result.objectsDuplicate = true
  step('slide duplicated')

  // The show draws the shapes and the picture.
  process.env.PEAROFFICE_FAKE_DISPLAYS = '1' // one display, whatever this computer has
  await js("document.querySelector('.present-button').click()")
  await waitFor('show', "!!document.querySelector('.show .slide svg[data-shape=rect]') && (() => { const i = document.querySelector('.show .slide img.slide-picture'); return !!i && i.complete && i.naturalWidth === 320 })()")
  result.objectsShow = await js("getComputedStyle(document.querySelector('.show .slide')).backgroundColor === " + JSON.stringify(THEMES.vivid))
  await key('Escape')
  await waitFor('show ended', "!document.querySelector('.show')")
  step('show')

  // Reopen: shapes, style, text, picture, alt text and theme are kept.
  await sleep(700)
  await js("document.querySelector('.sheet-link.all-files').click()")
  await waitFor('deck in all files', "[...document.querySelectorAll('.file-card')].some((c) => !!c.querySelector('.kind-icon.kind-slides'))")
  await js("[...document.querySelectorAll('.file-card')].find((c) => !!c.querySelector('.kind-icon.kind-slides')).click()")
  await waitFor('deck reopened', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 2`)
  await js(`document.querySelector('.slide-thumb[data-id="${firstSlide}"]').click()`)
  await waitFor('first slide again', `document.querySelectorAll('.slide-stage .slide-el[data-type=shape]').length === 6 && !!document.querySelector('${elSel(rect)}')`)
  await waitFor('picture again', `(() => { const i = document.querySelector('${elSel(pic)} img.slide-picture'); return !!i && i.complete && i.naturalWidth === 320 && i.alt === 'Green box' })()`)
  result.objectsPersisted = await js(`(() => {
    const g = document.querySelector('${elSel(rect)} svg g')
    const p = document.querySelector('${elSel(pic)}')
    return g.getAttribute('fill') === 'var(--accent2)' && g.getAttribute('stroke') === '#d32f2f' && g.getAttribute('stroke-width') === '8' &&
      document.querySelector('${elSel(rect)} .slide-static').textContent === 'Hi' &&
      p.style.left === '${f2.x}px' && p.style.top === '${f2.y}px' &&
      document.querySelector('.slides-tools .theme-select').value === 'vivid'
  })()`)
  if (!result.objectsPersisted) throw new Error('not kept after reopening')
  step('deck reopened')

  return result.objectsThemePicker && result.objectsShapes && result.objectsStyle && result.objectsPictureBytes && result.objectsPictureAspect && result.objectsPictureMoved && result.objectsThemes && result.objectsDuplicate && result.objectsShow && result.objectsPersisted
}
