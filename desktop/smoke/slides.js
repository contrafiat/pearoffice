// Smoke test part "slides": a deck made from New, slides added with two
// layouts, a title typed with real keys, a box moved, resized and rotated
// with real mouse events, slides reordered by keys and by drag, duplicated,
// deleted and undone, speaker notes typed, then the deck reopened.

module.exports = async function slides (t) {
  // Errors in the page go with a failure, to tell why.
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

  const ids = "[...document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]')].map((x) => x.dataset.id).join(',')"
  const count = "document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]').length"
  const box = (sel) => `(() => { const el = document.querySelector('.slide-stage ${sel}'); return el ? { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height, transform: el.style.transform } : null })()`
  const centre = async (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  async function drag (from, to, { steps = 8, modifiers = [], shot = null } = {}) {
    wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= steps; i++) {
      wc.sendInputEvent({ type: 'mouseMove', x: from.x + Math.round((to.x - from.x) * i / steps), y: from.y + Math.round((to.y - from.y) * i / steps), button: 'left', modifiers: ['leftButtonDown', ...modifiers] })
      await sleep(30)
    }
    if (shot) await t.shot(shot, 200)
    wc.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 })
    await sleep(150)
  }

  async function editTitle () {
    const p = await centre('.slide-stage .slide-el[data-role=title]')
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 2 })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 2 })
    await waitFor('title editor', "document.activeElement && document.activeElement.matches('.slide-el[data-role=title] .ProseMirror[contenteditable=true]')")
  }

  // A new deck starts with one title slide.
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-slides:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-slides').click()")
  await waitFor('slides editor', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 1 && document.querySelectorAll('.slide-stage .slide-el').length === 2`)
  if (process.env.PEAROFFICE_SMOKE_SLIDES_SHOT) await js("document.documentElement.dataset.theme = 'light'")
  const undoOff = "document.querySelector('.slides-tools .undo-button').disabled"
  result.slidesPlaceholder = await js("(document.querySelector('.slide-stage .slide-el[data-role=title] .slide-placeholder') || {}).textContent === 'Click to add title'")
  // Opening a box's editor changes nothing, so there is nothing to undo.
  await editTitle()
  await sleep(300)
  result.slidesCleanOpen = await js(undoOff)
  await key('Escape')
  await waitFor('editor closed', "!document.querySelector('.slide-stage .ProseMirror')")
  step('deck created')

  // New slide (title and content), then two columns from the layout menu.
  await js("document.querySelector('.slide-add .add-slide').click()")
  await waitFor('second slide', `${count} === 2 && document.querySelectorAll('.slide-stage .slide-el').length === 2`)
  await js("document.querySelector('.slide-add .add-layout').click()")
  await waitFor('layout menu', "!!document.querySelector('.layout-menu li.layout-twoColumns')")
  await js("document.querySelector('.layout-menu li.layout-twoColumns').click()")
  await waitFor('two columns slide', `${count} === 3 && !!document.querySelector('.slide-stage .slide-el[data-role=body2]')`)
  result.slidesLayout = await js("document.querySelector('.slides-tools .layout-select').value === 'twoColumns'")
  step('slides added')

  // Back to the first slide; a double click on the title opens its editor.
  await js("document.querySelector('.slide-thumbs .slide-thumb').click()")
  await waitFor('first slide', "document.querySelectorAll('.slide-stage .slide-el').length === 2 && !!document.querySelector('.slide-stage .slide-el[data-role=title]')")
  await editTitle()
  await type('Smoke deck')
  await waitFor('title typed', "document.querySelector('.slide-el[data-role=title] .ProseMirror').textContent === 'Smoke deck'")
  await t.shot('PEAROFFICE_SMOKE_SLIDES_EDIT_SHOT', 200)
  // Undo and redo inside the box use the deck's history.
  await sendMod('Z', ['control'])
  await waitFor('typing undone', "document.querySelector('.slide-el[data-role=title] .ProseMirror').textContent === ''")
  await sendMod('Y', ['control'])
  await waitFor('typing redone', "document.querySelector('.slide-el[data-role=title] .ProseMirror').textContent === 'Smoke deck'")
  await key('Escape')
  await waitFor('editing ended', "!document.querySelector('.slide-stage .ProseMirror') && document.querySelector('.slide-stage .slide-el[data-role=title] .slide-static').textContent === 'Smoke deck'")
  result.slidesThumbText = await js("document.querySelector('.slide-thumbs .slide-thumb .thumb').textContent.includes('Smoke deck')")
  step('title typed')

  // The body box: resized by its corner, rotated in steps of 15 degrees
  // with Shift, then moved back to the middle. The move snaps to the slide's
  // centre line, which shows a guide.
  const body = '.slide-el[data-role=body]'
  const before = await js(box(body))
  const b = await centre('.slide-stage ' + body)
  wc.sendInputEvent({ type: 'mouseDown', x: b.x, y: b.y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 })
  await waitFor('box selected', "!!document.querySelector('.sel-frame .handle.h-se')")
  const se = await centre('.sel-frame .handle.h-se')
  await drag(se, { x: se.x - 120, y: se.y + 40 }, { modifiers: ['alt'] })
  await waitFor('box resized', `(${box(body)}).width !== ${JSON.stringify(before.width)}`)
  const sized = await js(box(body))
  const rh = await centre('.sel-frame .rotate-handle')
  const bc = await centre('.slide-stage ' + body)
  await drag(rh, { x: bc.x + 52, y: bc.y - 194 }, { modifiers: ['shift'] })
  await waitFor('box rotated', `(${box(body)}).transform === 'rotate(15deg)'`)
  const c2 = await centre('.slide-stage ' + body)
  await drag(c2, { x: c2.x + 60, y: c2.y - 60 }, { shot: 'PEAROFFICE_SMOKE_SLIDES_SHOT' })
  await waitFor('box moved', `(${box(body)}).top !== ${JSON.stringify(sized.top)}`)
  const after = await js(box(body))
  // The toolbar's undo puts the move back; redo makes it again.
  await js("document.querySelector('.slides-tools .undo-button').click()")
  await waitFor('move undone', `(${box(body)}).top === ${JSON.stringify(sized.top)}`)
  await js("document.querySelector('.slides-tools .redo-button').click()")
  await waitFor('move redone', `(${box(body)}).top === ${JSON.stringify(after.top)}`)
  // Someone else on this slide with the box selected: outlined in their
  // colour, and their face on the slide in the list.
  const deckId = await js("window.pearoffice.call('sheet:list', {}).then((l) => l.find((x) => x.kind === 'slides').sheetId)")
  const bodyId = await js(`document.querySelector('.slide-stage ${body}').dataset.id`)
  const slideId = await js("document.querySelector('.slide-thumb.current').dataset.id")
  const someone = { identity: 'ab'.repeat(32), device: 'cd'.repeat(32), tab: null, row: null, col: null, editing: false, cursor: null, slide: slideId, sel: [bodyId], box: null }
  wc.send('worklet:event', { name: 'sheet:presence', data: { sheetId: deckId, people: [someone] } })
  await waitFor('remote selection', "(document.querySelector('.slide-overlay .remote-sel .presence-tag') || {}).textContent === 'Someone' && !!document.querySelector('.slide-thumb.current .thumb-person')")
  await t.shot('PEAROFFICE_SMOKE_SLIDES_PRESENCE_SHOT', 200)
  wc.send('worklet:event', { name: 'sheet:presence', data: { sheetId: deckId, people: [] } })
  await waitFor('remote selection gone', "!document.querySelector('.remote-sel')")
  // Arrow keys nudge the selected box.
  const nudged = parseInt(after.left) + 5 + 'px'
  await key('Right')
  await waitFor('nudged', `(${box(body)}).left === ${JSON.stringify(nudged)}`)
  await key('Left')
  await waitFor('nudged back', `(${box(body)}).left === ${JSON.stringify(after.left)}`)
  // A new text box, typed in, then deleted with the Delete key.
  await js("document.querySelector('.slides-tools .add-box').click()")
  await waitFor('text box editor', "document.querySelectorAll('.slide-stage .slide-el').length === 3 && document.activeElement && document.activeElement.matches('.slide-el:not([data-role]) .ProseMirror')")
  await type('Hi')
  await key('Escape')
  await waitFor('text box typed', "(document.querySelector('.slide-stage .slide-el:not([data-role]) .slide-static') || {}).textContent === 'Hi' && !!document.querySelector('.sel-frame')")
  await key('Delete')
  await waitFor('text box deleted', "document.querySelectorAll('.slide-stage .slide-el').length === 2")
  result.slidesBox = after.width !== before.width && after.top !== before.top && after.transform === 'rotate(15deg)'
  result.slidesBoxFrame = after
  step('box resized, rotated and moved')

  // Reorder: Ctrl+Down moves the first slide down one; then the last slide
  // is dragged to the top.
  const order0 = (await js(ids)).split(',')
  await js("document.querySelector('.slide-thumbs').focus()")
  await sendMod('Down', ['control'])
  await waitFor('moved down by keys', `${ids} === ${JSON.stringify([order0[1], order0[0], order0[2]].join(','))}`)
  const last = await centre('.slide-thumbs .slide-thumb:last-child .thumb-frame')
  const first = await js("(() => { const r = document.querySelector('.slide-thumbs .slide-thumb .thumb-frame').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 6) } })()")
  await drag(last, first, { steps: 10 })
  const order1 = [order0[2], order0[1], order0[0]]
  await waitFor('moved by drag', `${ids} === ${JSON.stringify(order1.join(','))}`)
  step('slides reordered')

  // Duplicate the title slide with Ctrl+D, delete the copy from its menu,
  // then undo the delete.
  await js(`[...document.querySelectorAll('.slide-thumbs .slide-thumb')].find((x) => x.dataset.id === ${JSON.stringify(order0[0])}).click()`)
  await waitFor('title slide shown', "(document.querySelector('.slide-stage .slide-el[data-role=title] .slide-static') || {}).textContent === 'Smoke deck'")
  await js("document.querySelector('.slide-thumbs').focus()")
  await sendMod('D', ['control'])
  await waitFor('duplicated', `${count} === 4 && document.querySelectorAll('.slide-thumbs .slide-thumb .thumb')[3].textContent.includes('Smoke deck')`)
  const copy = (await js(ids)).split(',')[3]
  result.slidesCopyCurrent = await js(`document.querySelector('.slide-thumb.current').dataset.id === ${JSON.stringify(copy)}`)
  await js(`(() => { const el = [...document.querySelectorAll('.slide-thumbs .slide-thumb')].find((x) => x.dataset.id === ${JSON.stringify(copy)}); el.querySelector('.thumb-more').click() })()`)
  await waitFor('slide menu', "!!document.querySelector('.slide-menu .slide-delete')")
  await js("document.querySelector('.slide-menu .slide-delete').click()")
  await waitFor('deleted', `${count} === 3 && ${ids} === ${JSON.stringify(order1.join(','))}`)
  await js("document.querySelector('.slide-thumbs').focus()")
  await sendMod('Z', ['control'])
  await waitFor('delete undone', `${count} === 4 && (${ids}).split(',')[3] === ${JSON.stringify(copy)}`)
  await sendMod('Z', ['control'])
  await waitFor('duplicate undone', `${ids} === ${JSON.stringify(order1.join(','))}`)
  step('duplicate, delete and undo')

  // Speaker notes on the title slide.
  await js(`[...document.querySelectorAll('.slide-thumbs .slide-thumb')].find((x) => x.dataset.id === ${JSON.stringify(order0[0])}).click()`)
  await waitFor('notes', "!!document.querySelector('.slide-notes .notes-body')")
  await js("document.querySelector('.slide-notes .notes-body').focus()")
  await waitFor('notes focus', "document.activeElement === document.querySelector('.slide-notes .notes-body')")
  await type('Say hello')
  await waitFor('notes typed', "document.querySelector('.slide-notes .notes-body').textContent === 'Say hello'")
  step('speaker notes')

  // Reopen: order, title, box and notes are all still there.
  await sleep(700) // the editor sends its edits a moment later
  await t.sendMod('W', ['control']) // close its tab, so it loads again (src/ui/tabs.jsx)
  await js("document.querySelector('.sheet-link.all-files').click()")
  await waitFor('deck in all files', "[...document.querySelectorAll('.file-card')].some((c) => !!c.querySelector('.kind-icon.kind-slides'))")
  await js("[...document.querySelectorAll('.file-card')].find((c) => !!c.querySelector('.kind-icon.kind-slides')).click()")
  await waitFor('deck reopened', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 3`)
  result.slidesOrder = (await js(ids)) === order1.join(',')
  await js(`[...document.querySelectorAll('.slide-thumbs .slide-thumb')].find((x) => x.dataset.id === ${JSON.stringify(order0[0])}).click()`)
  await waitFor('title slide again', "(document.querySelector('.slide-stage .slide-el[data-role=title] .slide-static') || {}).textContent === 'Smoke deck'")
  await waitFor('notes again', "(document.querySelector('.slide-notes .notes-body') || {}).textContent === 'Say hello'")
  const again = await js(box(body))
  result.slidesPersisted = JSON.stringify(again) === JSON.stringify(after)
  if (!result.slidesPersisted) throw new Error('box frame after reopening: ' + JSON.stringify({ again, after }))
  step('deck reopened')

  return result.slidesPlaceholder && result.slidesCleanOpen && result.slidesLayout && result.slidesThumbText && result.slidesBox && result.slidesCopyCurrent && result.slidesOrder && result.slidesPersisted
}
