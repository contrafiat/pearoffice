// Smoke test part "sheet-links": links in cells
// (proposals/2026-10-18-sheet-links.md). A web link from the toolbar on an
// empty cell, a link to a cell from the cell menu, Ctrl+click, the card's
// Open and Remove, a typed web address drawn as a link, a HYPERLINK formula,
// then the .xlsx round trip.

const fs = require('node:fs')
const path = require('node:path')
const gridHelpers = require('./grid')

module.exports = async function sheetLinks (t) {
  const { wc, js, step, waitFor, type, key, sendMod, more, downloads, dataDir, result, sleep } = t
  const { enter, cellNode } = gridHelpers(t)
  const opened = () => { try { return fs.readFileSync(path.join(dataDir, 'opened.txt'), 'utf8') } catch { return '' } }
  const address = () => js("document.querySelector('.formula-bar .address').textContent")
  const isLink = (r, c) => `(() => { const n = ${cellNode(r, c)}; return !!n && n.classList.contains('link') })()`
  const card = "document.querySelector('.link-card')"
  const center = (r, c) => js(`(() => { const b = ${cellNode(r, c)}.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)] })()`)

  await t.newSheet()
  step('sheet created')

  // A1 is empty: the Link button puts the address in as its text too.
  await js("document.querySelector('.tools [aria-label=\"Link\"]').click()")
  await waitFor('link bar', "!!document.querySelector('.sheet-link-bar input')")
  await type('pears.com')
  await key('Enter')
  await waitFor('A1 is a link', isLink(1, 1) + ' && ' + cellNode(1, 1) + ".textContent === 'https://pears.com'")
  await waitFor('card shows the address', `!!${card} && ${card}.textContent.includes('https://pears.com')`)
  await js(card + ".querySelector('[aria-label=\"Open link\"]').click()")
  for (const t0 = Date.now(); !opened().includes('https://pears.com') && Date.now() - t0 < 5000;) await sleep(100)
  result.webLink = opened().includes('https://pears.com')
  step('web link')

  // A2: a link to D20 from the cell menu, then Ctrl+click goes there.
  await js("document.querySelector('.grid .body').focus()")
  await key('Down')
  await enter('Go to D20', 'Enter')
  await key('Up')
  await js(`${cellNode(2, 1)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 120 }))`)
  await waitFor('cell menu', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Insert link...')")
  await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Insert link...').click()")
  await waitFor('link bar', "!!document.querySelector('.sheet-link-bar input')")
  await type('D20')
  await key('Enter')
  await waitFor('A2 is a link', isLink(2, 1))
  await waitFor('card names the cell', `!!${card} && /!D20$/.test(${card}.querySelector('.link-card-address').textContent)`)
  await key('Down')
  const [x, y] = await center(2, 1)
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1, modifiers: [mod] })
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1, modifiers: [mod] })
  await waitFor('went to D20', "document.querySelector('.formula-bar .address').textContent === 'D20'")
  result.innerLink = (await address()) === 'D20'
  step('link to a cell')

  // A3: a typed web address is drawn as a link, with no card buttons to
  // edit it. A4: a link added, then removed from the card.
  await sendMod('Home', ['control'])
  await key('Down'); await key('Down')
  await enter('https://example.org/x', 'Enter')
  await waitFor('typed address is a link', isLink(3, 1))
  await enter('temp', 'Enter')
  await key('Up')
  await sendMod('K', ['control'])
  await waitFor('link bar', "!!document.querySelector('.sheet-link-bar input')")
  await type('mailto:a@b.c')
  await key('Enter')
  await waitFor('A4 is a link', isLink(4, 1))
  await waitFor('card', `!!${card} && !!${card}.querySelector('[aria-label="Remove link"]')`)
  await js(card + ".querySelector('[aria-label=\"Remove link\"]').click()")
  await waitFor('A4 link removed', `!${isLink(4, 1)} && ${cellNode(4, 1)}.textContent === 'temp'`)
  step('typed address and remove')

  // A5: a HYPERLINK formula shows its label and opens from the card, which
  // has no Edit or Remove (the formula holds the link).
  await key('Down')
  await enter('=HYPERLINK("https://pears.com/f", "Pears")', 'Enter', 'Pears')
  await key('Up')
  await waitFor('formula link', isLink(5, 1) + ` && !!${card} && !${card}.querySelector('[aria-label="Edit link"]')`)
  await js(card + ".querySelector('[aria-label=\"Open link\"]').click()")
  for (const t0 = Date.now(); !opened().includes('https://pears.com/f') && Date.now() - t0 < 5000;) await sleep(100)
  result.formulaLink = opened().includes('https://pears.com/f')
  step('HYPERLINK')

  // Save as .xlsx and open it again: the links come back.
  await more('Save as an Excel file')
  const files = fs.existsSync(downloads) ? fs.readdirSync(downloads) : []
  let file = files.find((f) => f.endsWith('.xlsx'))
  for (const t0 = Date.now(); !file && Date.now() - t0 < 15000;) { await sleep(200); file = (fs.existsSync(downloads) ? fs.readdirSync(downloads) : []).find((f) => f.endsWith('.xlsx')) }
  await sleep(500)
  const b64 = fs.readFileSync(path.join(downloads, file)).toString('base64')
  await js(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'Links back.xlsx'))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('imported sheet open', "document.querySelector('.title').value === 'Links back'")
  await waitFor('links came back', isLink(1, 1) + ' && ' + isLink(2, 1) + ' && !' + isLink(4, 1))
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Down')
  await waitFor('cell link came back', `!!${card} && /!D20$/.test(${card}.querySelector('.link-card-address').textContent)`)
  result.roundTrip = true
  step('xlsx round trip')

  return result.webLink && result.innerLink && result.formulaLink && result.roundTrip
}
