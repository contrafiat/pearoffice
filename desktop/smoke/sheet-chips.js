// Smoke test part "sheet-chips": @ chips in cells
// (proposals/2026-10-23-multi-select-and-smart-chips.md). @ then a person,
// whose pill follows a rename; @ then a document; @ then Tomorrow, with the
// calendar button; Escape leaving a plain @; typing over a person chip.

const gridHelpers = require('./grid')

module.exports = async function sheetChips (t) {
  const { js, step, waitFor, type, key, sendMod, result } = t
  const { cellNode } = gridHelpers(t)
  const chipText = (r, c) => `(() => { const n = ${cellNode(r, c)}; const x = n && n.querySelector('.smart-chip-text'); return x ? x.textContent : null })()`
  const menuHas = (label) => `[...document.querySelectorAll('.at-menu .at-item > span:last-child')].some((x) => x.textContent === ${JSON.stringify(label)})`
  const goTo = async (row) => {
    await js("document.querySelector('.grid .body').focus()")
    await sendMod('Home', ['control'])
    for (let i = 1; i < row; i++) await key('Down')
  }

  await js("window.pearoffice.call('app:setName', { name: 'Ada Pear' })")
  await js("window.pearoffice.call('doc:create', { title: 'Notes' })")
  await t.newSheet()
  step('sheet created')

  // A1: @ then a person, picked with Enter.
  await goTo(1)
  await type('@Ada')
  await waitFor('person offered', menuHas('Ada Pear'))
  await key('Return')
  await waitFor('person chip', chipText(1, 1) + " === 'Ada Pear'")
  await js("window.pearoffice.call('app:setName', { name: 'Ada Lovelace' })")
  await waitFor('chip follows the rename', chipText(1, 1) + " === 'Ada Lovelace'")
  result.person = true
  step('person')

  // A2: @ then a document, clicked; the link card names it.
  await goTo(2)
  await type('@Not')
  await waitFor('file offered', menuHas('Notes'))
  await js("[...document.querySelectorAll('.at-menu .at-item')].find((x) => x.lastElementChild.textContent === 'Notes').click()")
  await waitFor('file chip', chipText(2, 1) + " === 'Notes' && !!" + cellNode(2, 1) + ".querySelector('.smart-chip svg')")
  await goTo(2)
  await waitFor('card names the file', "!!document.querySelector('.link-card') && document.querySelector('.link-card-address').textContent === 'Notes'")
  result.file = true
  step('file')

  // A3: @ then Tomorrow; a date the formulas see, with a calendar button.
  await goTo(3)
  await type('@Tom')
  await waitFor('date offered', menuHas('Tomorrow'))
  await key('Return')
  await waitFor('date chip', chipText(3, 1) + ' !== null')
  await goTo(3)
  await waitFor('calendar button', "!!document.querySelector('[aria-label=\"Pick a date\"]')")
  await goTo(4)
  await type('=A3-TODAY()')
  await key('Return')
  await waitFor('a real date', cellNode(4, 1) + " && " + cellNode(4, 1) + ".textContent === '1'")
  result.date = true
  step('date')

  // A5: Escape hides the menu and a plain @ stays.
  await goTo(5)
  await type('@')
  await waitFor('menu', '!!document.querySelector(".at-menu")')
  await key('Escape')
  await waitFor('menu hidden', '!document.querySelector(".at-menu")')
  await type('x')
  await key('Return')
  await waitFor('plain @x', cellNode(5, 1) + ' && ' + cellNode(5, 1) + ".textContent === '@x' && !" + cellNode(5, 1) + ".querySelector('.smart-chip')")
  // Typing over the person makes A1 plain text.
  await goTo(1)
  await type('Bob')
  await key('Return')
  await waitFor('A1 plain', cellNode(1, 1) + ".textContent === 'Bob' && !" + cellNode(1, 1) + ".querySelector('.smart-chip')")
  result.plain = true
  step('escape and typing over')

  return result.person && result.file && result.date && result.plain
}
