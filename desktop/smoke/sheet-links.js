// Smoke test part "sheet-links": links in cells
// (proposals/2026-10-18-sheet-links.md). A web link from the toolbar on an
// empty cell, a link to a cell from the cell menu, Ctrl+click, the card's
// Open and Remove, a typed web address drawn as a link, a HYPERLINK formula,
// a link to a block, the .xlsx round trip, then links to another file and a
// folder.

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

  // A6: a link to a block selects the whole block.
  await js("document.querySelector('.grid .body').focus()")
  await key('Down')
  await enter('Block', 'Enter')
  await key('Up')
  await sendMod('K', ['control'])
  await waitFor('link bar', "!!document.querySelector('.sheet-link-bar input')")
  await type('C2:D4')
  await key('Enter')
  await waitFor('card names the block', `!!${card} && /!C2:D4$/.test(${card}.querySelector('.link-card-address').textContent)`)
  await js(card + ".querySelector('[aria-label=\"Open link\"]').click()")
  await waitFor('block selected', "document.querySelector('.formula-bar .address').textContent === 'C2' && !!document.querySelector('.range')")
  result.blockLink = true
  step('link to a block')

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

  // Links to another file and a folder (proposals/2026-10-22-links-to-files.md),
  // picked from the bar's list, and one to a file this person does not have.
  await js("window.pearoffice.call('file:newFolder', { name: 'Work' })")
  const linkTo = async (row, group, name) => {
    await js("document.querySelector('.grid .body').focus()")
    await sendMod('Home', ['control'])
    for (let i = 1; i < row; i++) await key('Down')
    await sendMod('K', ['control'])
    await waitFor('link bar', "!!document.querySelector('.sheet-link-bar input')")
    if (!group) { await type(name); await key('Enter'); return }
    await waitFor(name + ' listed', `!![...document.querySelectorAll('.sheet-link-bar optgroup[label="${group}"] option')].find((o) => o.textContent === ${JSON.stringify(name)})`)
    await js(`(() => {
      const s = document.querySelector('.sheet-link-bar select')
      const o = [...s.querySelectorAll('optgroup[label="${group}"] option')].find((x) => x.textContent === ${JSON.stringify(name)})
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await waitFor('name in the box', `document.querySelector('.sheet-link-bar input').value === ${JSON.stringify(name)}`)
    await key('Enter')
  }
  const cardSays = (text) => `!!${card} && ${card}.querySelector('.link-card-address').textContent === ${JSON.stringify(text)}`
  await linkTo(8, 'Files', 'Untitled sheet')
  await waitFor('A8 links to the file', isLink(8, 1) + ' && ' + cellNode(8, 1) + ".textContent === 'Untitled sheet' && " + cardSays('Untitled sheet'))
  await linkTo(9, 'Folders', 'Work')
  await waitFor('A9 links to the folder', isLink(9, 1) + ' && ' + cardSays('Work'))
  await linkTo(10, null, 'pearoffice://file/' + 'n'.repeat(43))
  await waitFor('A10 is a file nobody shared', isLink(10, 1) + ` && !!${card} && ${card}.textContent.includes("You don't have this file") && !${card}.querySelector('[aria-label="Open link"]')`)
  await key('Up')
  await waitFor('A9 card', cardSays('Work'))
  await js(card + ".querySelector('[aria-label=\"Open link\"]').click()")
  await waitFor('folder opened', "!!document.querySelector('.in-folder .folder-head h1') && document.querySelector('.in-folder .folder-head h1').textContent.includes('Work')")
  await js("[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes('Links back')).click()")
  await waitFor('back in Links back', "!!document.querySelector('.title') && document.querySelector('.title').value === 'Links back'")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  for (let i = 1; i < 8; i++) await key('Down')
  await waitFor('A8 card', cardSays('Untitled sheet'))
  await js(card + ".querySelector('[aria-label=\"Open link\"]').click()")
  await waitFor('file opened', "!!document.querySelector('.title') && document.querySelector('.title').value === 'Untitled sheet'")
  result.fileLinks = true
  step('links to a file and a folder')

  // From outside the app: Copy link on the start screen, then the link
  // arrives as a pearoffice:// link would.
  const { clipboard } = require('electron')
  const deeplink = (url) => wc.send('worklet:event', { name: 'app:deeplink', data: { url } })
  await js("document.querySelector('.all-files').click()")
  await waitFor('Links back card', "[...document.querySelectorAll('.file-cell')].some((c) => c.querySelector('.file-title').textContent === 'Links back')")
  await js(`(() => { const c = [...document.querySelectorAll('.file-cell')].find((x) => x.querySelector('.file-title').textContent === 'Links back'); const b = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 20 })) })()`)
  await waitFor('card menu', "[...document.querySelectorAll('.card-menu li')].some((l) => l.textContent === 'Copy link')")
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'Copy link').click()")
  await waitFor('copied', "!!document.querySelector('.toast') && document.querySelector('.toast').textContent === 'Link copied'")
  const copied = String(await clipboard.readText())
  deeplink(copied)
  await waitFor('opened from outside', "!!document.querySelector('.title') && document.querySelector('.title').value === 'Links back'")
  deeplink('pearoffice://file/' + 'n'.repeat(43))
  await waitFor('missing file says so', "!!document.querySelector('.toast') && document.querySelector('.toast').textContent.startsWith(\"You don't have this file\")")
  result.outsideLinks = /^pearoffice:\/\/file\/[A-Za-z0-9_-]{43}$/.test(copied)
  step('file link from outside')

  return result.webLink && result.innerLink && result.formulaLink && result.blockLink && result.roundTrip && result.fileLinks && result.outsideLinks
}
