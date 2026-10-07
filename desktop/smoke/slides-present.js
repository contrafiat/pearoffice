// Smoke test part "slides-present": presenting a deck of three slides.
// With one display: F5 starts from the first slide, which fills the screen;
// keys, click and right-click move through it; B and W blank the screen;
// a number then Enter jumps; an edit and a deleted slide in the replica show
// during the show; Esc ends it on the slide shown. Then with a pretend
// second display (PEAROFFICE_FAKE_DISPLAYS=2): the audience window opens and
// follows the presenter view (notes and a timer) and keys in
// the audience window reach the presenter; Esc closes both.

const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')

module.exports = async function slidesPresent (t) {
  await t.js("window.__slideErrors = []; window.addEventListener('error', (e) => window.__slideErrors.push(String(e.message)))")
  try {
    return await run(t)
  } catch (err) {
    const errors = await t.js('window.__slideErrors').catch(() => null)
    throw new Error(err.message + (errors && errors.length ? ' (page errors: ' + errors.slice(0, 3).join(' | ') + ')' : ''))
  }
}

async function run (t) {
  const { wc, win, js, step, waitFor, type, key, result, sleep } = t

  const ids = "[...document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]')].map((x) => x.dataset.id)"
  const count = "document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]').length"
  const shown = "(document.querySelector('.show .show-screen .slide') || {}).dataset?.id"
  const onSlide = (id) => `${shown} === ${JSON.stringify(id)}`
  const centre = async (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const click = (p, button = 'left') => {
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button, clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button, clickCount: 1 })
  }
  async function editTitle (text) {
    const p = await centre('.slide-stage .slide-el[data-role=title]')
    click(p)
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 2 })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 2 })
    await waitFor('title editor', "document.activeElement && document.activeElement.matches('.slide-el[data-role=title] .ProseMirror[contenteditable=true]')")
    await type(text, 20)
    await key('Escape')
    await waitFor('title typed: ' + text, `!document.querySelector('.slide-stage .ProseMirror') && (document.querySelector('.slide-stage .slide-el[data-role=title] .slide-static') || {}).textContent === ${JSON.stringify(text)}`)
  }
  const pick = (id) => js(`[...document.querySelectorAll('.slide-thumbs .slide-thumb')].find((x) => x.dataset.id === ${JSON.stringify(id)}).click()`)

  // A deck of three slides with titles, and notes on the third.
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-slides:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-slides').click()")
  await waitFor('slides editor', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 1 && document.querySelectorAll('.slide-stage .slide-el').length === 2`)
  if (process.env.PEAROFFICE_SMOKE_SHOW_SHOT) await js("document.documentElement.dataset.theme = 'light'")
  await editTitle('Present one')
  for (const title of ['Two', 'Three']) {
    const n = await js(count)
    await js("document.querySelector('.slide-add .add-slide').click()")
    await waitFor('slide ' + title, `${count} === ${n + 1} && document.querySelectorAll('.slide-stage .slide-el').length === 2`)
    await editTitle(title)
  }
  await js("document.querySelector('.slide-notes .notes-body').focus()")
  await waitFor('notes focus', "document.activeElement === document.querySelector('.slide-notes .notes-body')")
  await type('Note three', 20)
  await waitFor('notes typed', "document.querySelector('.slide-notes .notes-body').textContent === 'Note three'")
  const [s1, s2, s3] = await js(ids)
  step('deck made')

  // One display, whatever this computer has.
  process.env.PEAROFFICE_FAKE_DISPLAYS = '1'
  // F5 from the third slide starts at the first, drawn as large as fits.
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'F5' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'F5' })
  await waitFor('show started', onSlide(s1))
  result.showFills = await js(`(() => {
    const r = document.querySelector('.show .fit-holder').getBoundingClientRect()
    const w = window.innerWidth, h = window.innerHeight
    const wide = Math.abs(r.width - w) <= 1 && r.height <= h + 1
    const tall = Math.abs(r.height - h) <= 1 && r.width <= w + 1
    return (wide || tall) && Math.abs(r.left + r.width / 2 - w / 2) <= 1 && Math.abs(r.top + r.height / 2 - h / 2) <= 1
  })()`)
  result.showText = await js("(document.querySelector('.show .slide-el[data-role=title]') || {}).textContent === 'Present one' && !document.querySelector('.show .ProseMirror')")
  result.showMain = await js("window.pearoffice.call('app:presentState').then((s) => s.presenting && !s.audience)")
  await t.shot('PEAROFFICE_SMOKE_SHOW_SHOT', 200)
  step('show started')

  // Keys forward and back.
  const moves = [['Right', s2], ['Space', s3], ['Backspace', s2], ['PageUp', s1], ['PageDown', s2], ['Left', s1], ['End', s3], ['Home', s1], ['Down', s2], ['Up', s1]]
  for (const [k, to] of moves) {
    await key(k)
    await waitFor(k + ' to ' + to, onSlide(to), 3000)
  }
  await type('n', 0)
  await waitFor('N to next', onSlide(s2), 3000)
  await type('p', 0)
  await waitFor('P to previous', onSlide(s1), 3000)
  step('keys')

  // Click for the next, right-click for the previous, with no menu.
  const mid = { x: Math.round(await js('window.innerWidth') / 2), y: Math.round(await js('window.innerHeight') / 2) }
  click(mid)
  await waitFor('click to next', onSlide(s2), 3000)
  click(mid, 'right')
  await waitFor('right-click to previous', onSlide(s1), 3000)
  step('click and right-click')

  // B blanks to black and any key brings the same slide back; W to white,
  // and a click brings it back.
  await type('b', 0)
  await waitFor('black screen', "!!document.querySelector('.show .show-blank.black')", 3000)
  await key('Right')
  await waitFor('black gone', `!document.querySelector('.show .show-blank') && ${onSlide(s1)}`, 3000)
  await type('w', 0)
  await waitFor('white screen', "!!document.querySelector('.show .show-blank.white')", 3000)
  click(mid)
  await waitFor('white gone', `!document.querySelector('.show .show-blank') && ${onSlide(s1)}`, 3000)
  step('black and white')

  // A number then Enter jumps to that slide.
  await type('3', 0)
  await waitFor('typed number shows', "(document.querySelector('.show .show-number') || {}).textContent === '3'", 3000)
  await key('Enter')
  await waitFor('jumped to 3', onSlide(s3), 3000)
  await type('1', 0)
  await key('Enter')
  await waitFor('jumped to 1', onSlide(s1), 3000)
  step('jump by number')

  // Someone's edit to the slide on screen shows at once. The edit is made in
  // the page's copy of the deck (found through React's props on the slide),
  // with the origin the editor gives edits from others.
  await js(`(() => {
    const el = document.querySelector('.show .slide-el[data-role=title] .slide-static')
    let f = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))]
    while (f && !(f.memoizedProps && f.memoizedProps.fragment)) f = f.return
    const fragment = f.memoizedProps.fragment
    const text = fragment.get(0).get(0)
    fragment.doc.transact(() => text.insert(text.length, ' live'), 'remote')
  })()`)
  await waitFor('edit shows in the show', "(document.querySelector('.show .slide-el[data-role=title]') || {}).textContent === 'Present one live'", 3000)
  // The slide on screen deleted by someone: the next one takes its place.
  await key('Right')
  await waitFor('on slide 2', onSlide(s2), 3000)
  await js(`(() => {
    let f = document.querySelector('.show')[Object.keys(document.querySelector('.show')).find((k) => k.startsWith('__reactFiber'))]
    while (f && !(f.memoizedProps && f.memoizedProps.ydoc)) f = f.return
    const ydoc = f.memoizedProps.ydoc
    ydoc.transact(() => ydoc.getMap('slides').get(${JSON.stringify(s2)}).set('gone', true), 'remote')
  })()`)
  await waitFor('deleted slide skipped', onSlide(s3), 3000)
  step('live edit and deleted slide')

  // The cursor hides once the mouse is still.
  await waitFor('cursor hidden', "!!document.querySelector('.show.idle')", 4000)
  // Esc ends the show on the slide it ended on.
  await key('Escape')
  await waitFor('show ended', `!document.querySelector('.show') && document.querySelector('.slide-thumb.current').dataset.id === ${JSON.stringify(s3)}`, 3000)
  result.showEnded = await js("window.pearoffice.call('app:presentState').then((s) => !s.presenting && !s.fullScreen)")
  step('esc ends the show')

  // Presenter view, with a pretend second display. Present starts from the
  // slide in the editor.
  process.env.PEAROFFICE_FAKE_DISPLAYS = '2'
  await pick(s1)
  await waitFor('first slide', `document.querySelector('.slide-thumb.current').dataset.id === ${JSON.stringify(s1)}`)
  await js("document.querySelector('.slides-tools .present-button').click()")
  await waitFor('presenter view', "!!document.querySelector('.presenter .presenter-current .slide')", 5000)
  let audience = null
  for (let i = 0; i < 50 && !audience; i++) {
    audience = BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed() && w.webContents.getURL().includes('audience='))
    if (!audience) await sleep(100)
  }
  if (!audience) throw new Error('no audience window')
  const ajs = (code) => audience.webContents.executeJavaScript(code, true)
  const audienceOn = async (label, id) => {
    for (let i = 0; i < 80; i++) {
      if (await ajs(`${shown} === ${JSON.stringify(id)}`).catch(() => false)) return
      await sleep(100)
    }
    throw new Error('audience window not on ' + label)
  }
  await audienceOn('slide 1', s1)
  result.presenterStart = await js("document.querySelector('.presenter-count').textContent === 'Slide 1 of 2' && (document.querySelector('.presenter-next .slide-el[data-role=title]') || {}).textContent === 'Three'")
  await key('Right')
  await waitFor('presenter on slide 2', "document.querySelector('.presenter-count').textContent === 'Slide 2 of 2'", 3000)
  await audienceOn('slide 3 after Right', s3)
  await waitFor('notes in presenter view', "(document.querySelector('.presenter .present-notes-text') || {}).textContent === 'Note three' && document.querySelector('.presenter-end').textContent === 'End of the show'", 3000)
  result.presenterTimer = await js("/^\\d\\d:\\d\\d$/.test(document.querySelector('.presenter-elapsed').textContent) && /\\d/.test(document.querySelector('.presenter-clock').textContent)")
  await js("document.querySelector('.timer-pause').click()")
  await waitFor('timer paused', "document.querySelector('.timer-pause').getAttribute('aria-label') === 'Resume the timer'", 3000)
  await t.shot('PEAROFFICE_SMOKE_PRESENTER_SHOT', 200)
  // Black from the presenter view blanks the audience window too.
  await js("document.querySelector('.presenter-black').click()")
  for (let i = 0; i < 30 && !(await ajs("!!document.querySelector('.show-blank.black')")); i++) await sleep(100)
  result.presenterBlack = await ajs("!!document.querySelector('.show-blank.black')")
  await js("document.querySelector('.presenter-black').click()")
  // A key pressed in the audience window moves the presenter view.
  audience.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' })
  audience.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' })
  await waitFor('audience key reached presenter', "document.querySelector('.presenter-count').textContent === 'Slide 1 of 2'", 3000)
  await audienceOn('slide 1 after Left', s1)
  step('presenter view')

  await key('Escape')
  await waitFor('presenter ended', "!document.querySelector('.presenter')", 3000)
  for (let i = 0; i < 30 && !audience.isDestroyed(); i++) await sleep(100)
  result.audienceClosed = audience.isDestroyed()
  result.presenterEnded = await js("window.pearoffice.call('app:presentState').then((s) => !s.presenting && !s.audience)")
  step('esc closes both')

  // A phone in portrait and then landscape, for screenshots only: a phone
  // sized window whose bridge says it is the phone app.
  if (process.env.PEAROFFICE_SMOKE_PHONE_SHOT) {
    process.env.PEAROFFICE_FAKE_DISPLAYS = '1'
    const phone = new BrowserWindow({ width: 390, height: 800, show: false, webPreferences: { preload: path.join(__dirname, 'phone-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true } })
    try {
      const pjs = (code) => phone.webContents.executeJavaScript(code, true)
      const pwait = async (label, code) => {
        for (let i = 0; i < 100; i++) { if (await pjs(code).catch(() => false)) return; await sleep(100) }
        throw new Error('phone: timed out waiting for ' + label)
      }
      await phone.loadURL(wc.getURL())
      await pjs("document.documentElement.dataset.theme = 'light'; true")
      await pwait('deck in the list', "[...document.querySelectorAll('.file-card')].some((c) => !!c.querySelector('.kind-icon.kind-slides'))")
      await pjs("[...document.querySelectorAll('.file-card')].find((c) => !!c.querySelector('.kind-icon.kind-slides')).click()")
      await pwait('phone deck', `!!document.querySelector('.slides.phone .present-button') && !!document.querySelector('.slide-thumbs .slide-thumb[data-id=${JSON.stringify(s3)}]')`)
      await pjs(`document.querySelector('.slide-thumbs .slide-thumb[data-id=${JSON.stringify(s3)}]').click(); true`)
      await sleep(200)
      await pjs("document.querySelector('.slides-tools .present-button').click(); true")
      await pwait('show with notes', "!!document.querySelector('.show.phone.with-notes .present-notes-text')")
      await sleep(300)
      fs.writeFileSync(process.env.PEAROFFICE_SMOKE_PHONE_SHOT, (await phone.webContents.capturePage()).toPNG())
      phone.setContentSize(800, 390)
      await pwait('landscape', "!!document.querySelector('.show.phone:not(.with-notes)')")
      await sleep(300)
      fs.writeFileSync(process.env.PEAROFFICE_SMOKE_PHONE_SHOT.replace(/\.png$/, '-landscape.png'), (await phone.webContents.capturePage()).toPNG())
    } finally {
      phone.destroy()
    }
  }

  return result.showFills && result.showText && result.showMain && result.showEnded && result.presenterStart && result.presenterTimer && result.presenterBlack && result.audienceClosed && result.presenterEnded
}
