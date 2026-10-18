// Smoke test part "templates" (proposals/2026-10-18-templates.md): a sheet
// marked as a template from its card's menu, the badge, New listing it, a
// file made from it (the content comes along, the badge does not), New from
// this template on the card, unmarking, a long list (search, kind buttons,
// the built-in ones folded), then each built-in template. With
// PEAROFFICE_SMOKE_TEMPLATES_SHOTS=<folder> it saves New and each built-in.

const fs = require('node:fs')
const path = require('node:path')
const gridHelpers = require('./grid')

module.exports = async function templates (t) {
  const { js, step, waitFor, newSheet, result, sleep, wc } = t
  // With PEAROFFICE_SMOKE_TEMPLATES_SHOTS=<folder>: New and each built-in.
  const shots = process.env.PEAROFFICE_SMOKE_TEMPLATES_SHOTS
  const snap = async (name) => {
    if (!shots) return
    await sleep(400)
    fs.mkdirSync(shots, { recursive: true })
    fs.writeFileSync(path.join(shots, name + '.png'), (await wc.capturePage()).toPNG())
  }
  const { enter } = gridHelpers(t)
  const home = async () => {
    await js("document.querySelector('.sheet-link.all-files').click()")
    await waitFor('the start screen', "!!document.querySelector('.files-home')")
  }
  const cards = (title) => `[...document.querySelectorAll('.file-cell')].filter((c) => (c.querySelector('.file-title') || {}).textContent === ${JSON.stringify(title)})`
  const cardMenu = async (title, item) => {
    await js(`${cards(title)}[0].querySelector('.card-more').click()`)
    await waitFor('card menu: ' + item, `[...document.querySelectorAll('.card-menu li')].some((l) => l.textContent === ${JSON.stringify(item)})`)
    await js(`[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === ${JSON.stringify(item)}).click()`)
  }
  const rename = async (title) => js(`(() => {
    const el = document.querySelector('.toolbar .title')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus(); set.call(el, ${JSON.stringify(title)}); el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })()`)
  const openNew = async () => {
    await js("document.querySelector('.sidebar .new-sheet').click()")
    await waitFor('New', "!!document.querySelector('.panel.new-file .template-list')")
  }
  const pickTemplate = async (title) => {
    // The built-in ones may be folded away.
    await js("(() => { const g = document.querySelector('.template-group'); if (g && g.getAttribute('aria-expanded') === 'false') g.click() })()")
    await waitFor('template ' + title, `[...document.querySelectorAll('.template-choice .template-title')].some((x) => x.textContent === ${JSON.stringify(title)})`)
    await js(`[...document.querySelectorAll('.template-choice')].find((b) => b.querySelector('.template-title').textContent === ${JSON.stringify(title)}).click()`)
  }

  // A sheet to use as a template.
  await newSheet()
  await enter('Flour', 'Tab')
  await enter('200', 'Enter')
  await rename('Recipe card')
  await waitFor('renamed', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent === 'Recipe card')")
  await home()

  // New with no templates of your own: the hint and the built-in ones.
  await openNew()
  await waitFor('hint and built-ins', "!!document.querySelector('.template-hint') && document.querySelectorAll('.template-choice.built-in').length === 4")
  await js("document.querySelector('.panel.new-file .close').click()")

  await cardMenu('Recipe card', 'Use as a template')
  await waitFor('badge', `${cards('Recipe card')}[0].querySelector('.template-badge') !== null`)
  step('marked')

  // New lists it; picking it opens a copy with the content.
  await openNew()
  await waitFor('no hint', "!document.querySelector('.template-hint')")
  await snap('new')
  await pickTemplate('Recipe card')
  await waitFor('copy open', "document.querySelector('.toolbar .title').value === 'Recipe card' && [...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Flour') && [...document.querySelectorAll('.cell')].some((c) => c.textContent === '200')")
  await home()
  await waitFor('two cards, one badge', `${cards('Recipe card')}.length === 2 && ${cards('Recipe card')}.filter((c) => c.querySelector('.template-badge')).length === 1`)
  step('made from it')

  // A long list: six more templates (one a document) bring the search box
  // and kind buttons, and fold the built-in ones away.
  await js(`(async () => {
    for (let i = 1; i <= 6; i++) {
      const { sheetId } = await window.pearoffice.call(i === 3 ? 'doc:create' : 'sheet:create', { title: 'Plan ' + i })
      await window.pearoffice.call('file:setTemplate', { sheetId, template: true })
    }
  })()`)
  await waitFor('six more', "[...document.querySelectorAll('.template-badge')].length >= 7")
  await openNew()
  const titles = "[...document.querySelectorAll('.template-choice .template-title')].map((x) => x.textContent).join('|')"
  await waitFor('search and folded built-ins', "!!document.querySelector('.template-search input') && !document.querySelector('.template-choice.built-in') && /Built-in \\(4\\)/.test(document.querySelector('.template-group').textContent)")
  await js(`(() => { const el = document.querySelector('.template-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, 'plan 3'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await waitFor('search narrows', titles + " === 'Plan 3'")
  await js(`(() => { const el = document.querySelector('.template-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await js("[...document.querySelectorAll('.template-kinds button')].find((b) => b.textContent === 'Documents').click()")
  await waitFor('kind filter', titles + " === 'Plan 3'")
  await js("[...document.querySelectorAll('.template-kinds button')].find((b) => b.textContent === 'All').click()")
  await js("document.querySelector('.template-group').click()")
  await waitFor('built-ins open', "document.querySelectorAll('.template-choice.built-in').length === 4")
  await snap('new-long')
  await js("document.querySelector('.panel.new-file .close').click()")
  step('long list')

  // From the card's menu too, then unmark.
  await js(`${cards('Recipe card')}.find((c) => c.querySelector('.template-badge')).querySelector('.card-more').click()`)
  await waitFor('menu', "[...document.querySelectorAll('.card-menu li')].some((l) => l.textContent === 'New from this template')")
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'New from this template').click()")
  await waitFor('second copy open', "document.querySelector('.toolbar .title').value === 'Recipe card' && [...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Flour')")
  await home()
  await waitFor('three cards', `${cards('Recipe card')}.length === 3`)
  await js(`${cards('Recipe card')}.find((c) => c.querySelector('.template-badge')).querySelector('.card-more').click()`)
  await waitFor('menu', "[...document.querySelectorAll('.card-menu li')].some((l) => l.textContent === 'Stop using as a template')")
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'Stop using as a template').click()")
  await waitFor('no badge', `${cards('Recipe card')}.every((c) => !c.querySelector('.template-badge'))`)
  step('new from card and unmarked')

  // Each built-in template makes its file.
  const builtIns = [
    ['Budget', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Monthly budget') && [...document.querySelectorAll('.cell')].some((c) => c.textContent === '3,200.00')"],
    ['Recipe', "!!document.querySelector('.doc-body h2') && document.querySelector('.doc-body').textContent.includes('Ingredients')"],
    ['Meeting notes', "!!document.querySelector('.doc-body') && document.querySelector('.doc-body').textContent.includes('Decisions')"],
    ['Simple deck', "document.querySelectorAll('.slide-list .slide-thumb, .slide-list li').length >= 4 && document.body.textContent.includes('Your title')"]
  ]
  for (const [title, check] of builtIns) {
    await home()
    await openNew()
    await pickTemplate(title)
    await waitFor(title + ' made', check)
    await snap(title.toLowerCase().replace(/ /g, '-'))
  }
  result.builtIns = true
  step('built-in templates')
  return true
}
