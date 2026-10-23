// Smoke test part "sheet-files": cell formats, freeze, filter, hiding,
// comments, validation, colour rules and names, then saving the sheet as
// .xlsx, .csv, .json and PDF, tabs, tidy up and opening .json, .csv and
// .xlsx files (the .xlsx round trip checks the formats come back).

const fs = require('node:fs')
const path = require('node:path')
const gridHelpers = require('./grid')

module.exports = async function sheetFiles (t) {
  const { wc, js, step, waitFor, type, key, sendMod, more, downloads, dataDir, result, sleep } = t
  const { enter, cellNode, rowHead, typeInto, setInput, setSelect } = gridHelpers(t)

  await t.newSheet()
  step('sheet created')

  await enter('Rent', 'Tab')
  await enter('1200', 'Enter')
  await key('Left')
  await enter('Food', 'Tab')
  await enter('450.5', 'Enter')
  await key('Left')
  await enter('Total', 'Tab')
  await enter('=SUM(B1:B2)', 'Enter', '1650.5')
  step('typed')

  // Cell formats (proposals/2026-10-04-cell-formats.md), in M30 out of the
  // way: underline and strikethrough, wrap a long text and see its row
  // grow, a larger size, borders and a row resized by dragging its edge.
  await sendMod('Home', ['control'])
  for (let i = 0; i < 12; i++) await key('Right')
  for (let i = 0; i < 29; i++) await key('Down')
  await enter('A long note that will not fit on one line of this cell', 'Enter')
  await key('Up')
  await sendMod('U', ['control'])
  await sendMod('5', ['control'])
  await waitFor('underline and strike', cellNode(30, 13) + ".querySelector('.cell-text').style.textDecoration === 'underline line-through'")
  const before = await js(rowHead(30) + '.getBoundingClientRect().height')
  await js("document.querySelector('.tools [aria-label=\"Alignment\"]').click()")
  await waitFor('align menu', "!!document.querySelector('.align-menu')")
  await js("document.querySelector('.align-menu [aria-label=\"Wrap text\"]').click()")
  await waitFor('row grows for wrapped text', rowHead(30) + '.getBoundingClientRect().height > ' + (before + 10))
  await js("document.querySelector('.grid .body').focus()")
  await key('Down')
  await enter('Big', 'Enter', 'Big')
  await key('Up')
  await js('(() => { const s = document.querySelector(\'.tools [aria-label="Font size"]\'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, \'value\').set; set.call(s, \'24\'); s.dispatchEvent(new Event(\'change\', { bubbles: true })) })()')
  await waitFor('bigger text', cellNode(31, 13) + ".querySelector('.cell-text').style.fontSize === '32px' && " + rowHead(31) + '.getBoundingClientRect().height > 35')
  await js("document.querySelector('.tools [aria-label=\"Borders\"]').click()")
  await waitFor('borders menu', "!!document.querySelector('.borders-menu')")
  await js("[...document.querySelectorAll('.borders-menu .border-preset')].find((b) => b.textContent === 'All').click()")
  await waitFor('borders', '!!' + cellNode(31, 13) + ".querySelector('.cell-borders')")
  const [rx, ry] = await js(`(() => { const r = ${rowHead(29)}.querySelector('.row-resize').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })()`)
  wc.sendInputEvent({ type: 'mouseDown', x: rx, y: ry, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 5; i++) { wc.sendInputEvent({ type: 'mouseMove', x: rx, y: ry + i * 6, button: 'left' }); await sleep(40) }
  wc.sendInputEvent({ type: 'mouseUp', x: rx, y: ry + 30, button: 'left', clickCount: 1 })
  await waitFor('row resized', rowHead(29) + '.getBoundingClientRect().height > 45')
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  // Merge M40:N40 (N40 has text, so it asks first), check the merged box
  // spans both columns and Right steps past it, then unmerge.
  await sendMod('Home', ['control'])
  for (let i = 0; i < 12; i++) await key('Right')
  for (let i = 0; i < 39; i++) await key('Down')
  await enter('Merged title', 'Tab')
  await enter('gone', 'Enter')
  await key('Up'); await key('Left')
  await sendMod('Right', ['shift'])
  await js("document.querySelector('.tools [aria-label=\"Merge cells\"]').click()")
  await waitFor('merge asks', "!!document.querySelector('.panel[aria-label=\"Merge cells\"]')")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Merge').click()")
  await waitFor('merged', `(() => { const m = ${cellNode(40, 13)}; const n = ${cellNode(40, 15)}; return m && n && Math.abs(m.getBoundingClientRect().right - n.getBoundingClientRect().left) < 2 && !${cellNode(40, 14)} })()`)
  await js("document.querySelector('.grid .body').focus()")
  await key('Right')
  await waitFor('steps past the merge', "document.querySelector('.formula-bar .address').textContent === 'O40'")
  await key('Left')
  await waitFor('back on the merge', "document.querySelector('.formula-bar .address').textContent === 'M40'")
  await js("document.querySelector('.tools [aria-label=\"Unmerge cells\"]').click()")
  await waitFor('unmerged', '!!' + cellNode(40, 14))
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  // Freeze the top row from the More menu: it stays at the top while the
  // grid scrolls; then unfreeze.
  await js("document.querySelector('.toolbar .more-button').click()")
  await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === 'Freeze top row').click()")
  await waitFor('frozen', "!!document.querySelector('.frozen-top')")
  await js("document.querySelector('.grid .body').scrollTop = 400")
  await sleep(300)
  result.frozenStays = await js("(() => { const b = document.querySelector('.grid .body').getBoundingClientRect(); const c = document.querySelector('.frozen-top .cell[data-r=\"1\"][data-c=\"1\"]'); return !!c && Math.abs(c.getBoundingClientRect().top - b.top) < 2 && c.textContent === 'Rent' })()")
  await js("document.querySelector('.toolbar .more-button').click()")
  await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === 'Unfreeze').click()")
  await waitFor('unfrozen', "!document.querySelector('.frozen-top')")
  await js("document.querySelector('.grid .body').scrollTop = 0")
  await js("document.querySelector('.grid .body').focus()")
  // Filter (this device only): from A1, Ctrl+Shift+L, then keep only
  // "Total" in column A; row 2 hides and the status line counts.
  await sendMod('Home', ['control'])
  await sendMod('L', ['control', 'shift'])
  await waitFor('filter on', "!!document.querySelector('.filter-button')")
  await js("document.querySelector('.cell[data-r=\"1\"][data-c=\"1\"] .filter-button').click()")
  await waitFor('filter panel', "!!document.querySelector('.panel[aria-label=\"Filter\"]')")
  await js("document.querySelector('.filter-values .check input').click()")
  await js("[...document.querySelectorAll('.filter-values .check')].find((l) => l.textContent.startsWith('Total')).querySelector('input').click()")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Apply').click()")
  await waitFor('filtered', "!document.querySelector('.panel[aria-label=\"Filter\"]') && !document.querySelector('.cell[data-r=\"2\"]') && !!document.querySelector('.cell[data-r=\"3\"]')")
  result.filterStatus = await js("document.querySelector('.filter-status').textContent")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('L', ['control', 'shift'])
  await waitFor('filter off', "!document.querySelector('.filter-status') && !!document.querySelector('.cell[data-r=\"2\"]')")
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  // Hide row 2 from its header menu (shared): Down from A1 skips it; the
  // mark between the headers shows it again.
  await js(rowHead(2) + ".dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 120 }))")
  await waitFor('row menu', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Hide row 2')")
  await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Hide row 2').click()")
  await waitFor('row hidden', '!' + cellNode(2, 1) + " && !!document.querySelector('.unhide-mark.row')")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Down')
  result.skipsHidden = await js("document.querySelector('.formula-bar .address').textContent") === 'A3'
  await js("document.querySelector('.unhide-mark.row').click()")
  await waitFor('row shown', '!!' + cellNode(2, 1) + " && !document.querySelector('.unhide-mark')")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  // Comment on A1 from the cell menu, reply, resolve.
  const panelButton = (label) => js("[...document.querySelectorAll('.comments-panel button')].find((b) => b.textContent.trim() === " + JSON.stringify(label) + ').click()')
  await js(cellNode(1, 1) + ".dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }))")
  await waitFor('cell menu comment', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Comment')")
  await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Comment').click()")
  await waitFor('comment panel', "!!document.querySelector('.comments-panel textarea')")
  await typeInto('.comments-panel textarea', 'Check the rent')
  await panelButton('Comment')
  await waitFor('commented', '!!' + cellNode(1, 1) + ".querySelector('.comment-mark') && [...document.querySelectorAll('.comment-text')].some((p) => p.textContent === 'Check the rent')")
  await typeInto('.comments-panel textarea', 'Checked')
  await panelButton('Reply')
  await waitFor('replied', "document.querySelectorAll('.comments-panel .comment-text').length === 2")
  await panelButton('Resolve')
  await waitFor('resolved', '!!' + cellNode(1, 1) + ".querySelector('.comment-mark.resolved')")
  await js("document.querySelector('.comments-panel .close').click()")
  result.comments = true
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  // Validation: a list on P5 refuses "Maybe"; the dropdown enters "Yes".
  await sendMod('Home', ['control'])
  for (let i = 0; i < 15; i++) await key('Right')
  for (let i = 0; i < 4; i++) await key('Down')
  await waitFor('at P5', "document.querySelector('.formula-bar .address').textContent === 'P5'")
  await js("document.querySelector('.toolbar .more-button').click()")
  await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === 'Validation...').click()")
  await waitFor('validation panel', "!!document.querySelector('.panel[aria-label=\"Validation\"] textarea')")
  await typeInto('.panel[aria-label="Validation"] textarea', 'Yes\nNo')
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Save').click()")
  await waitFor('list button', "!document.querySelector('.panel') && !!document.querySelector('.list-button')")
  await js("document.querySelector('.grid .body').focus()")
  await type('Maybe')
  await key('Return')
  await waitFor('refused', "!!document.querySelector('.panel[aria-label=\"Not allowed\"]')")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Cancel').click()")
  await js("document.querySelector('.list-button').click()")
  await waitFor('list open', "[...document.querySelectorAll('.pick-menu li')].some((l) => l.textContent === 'Yes')")
  await js("[...document.querySelectorAll('.pick-menu li')].find((l) => l.textContent === 'Yes').click()")
  await waitFor('picked', cellNode(5, 16) + ' && ' + cellNode(5, 16) + ".textContent === 'Yes'")
  result.validation = true
  // Coloured chips (proposals/2026-10-22-dropdown-chips.md): R5:R7 filled,
  // Dropdown... offers their values, Todo made red, picking from the list.
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  for (let i = 0; i < 17; i++) await key('Right')
  for (let i = 0; i < 4; i++) await key('Down')
  await waitFor('at R5', "document.querySelector('.formula-bar .address').textContent === 'R5'")
  for (const v of ['Todo', 'Done', 'Todo']) { await type(v); await key('Return') }
  for (let i = 0; i < 3; i++) await key('Up')
  await sendMod('Down', ['shift']); await sendMod('Down', ['shift'])
  await js("document.querySelector('.toolbar .more-button').click()")
  await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === 'Dropdown...').click()")
  await waitFor('items offered', "!!document.querySelector('.panel[aria-label=\"Validation\"] textarea') && document.querySelector('.panel[aria-label=\"Validation\"] textarea').value === 'Todo\\nDone' && document.querySelectorAll('.chip-colors button').length === 2")
  await js("document.querySelector('.chip-colors button').click()")
  await waitFor('swatches', "!!document.querySelector('.chip-swatches [aria-label=\"red\"]')")
  await js("document.querySelector('.chip-swatches [aria-label=\"red\"]').click()")
  await waitFor('Todo is red', "document.querySelector('.chip-colors button').classList.contains('chip-red')")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Save').click()")
  const chipIn = (r, c, color) => `!!${cellNode(r, c)} && !!${cellNode(r, c)}.querySelector('.chip.chip-${color}')`
  await waitFor('chips drawn', `!document.querySelector('.panel') && ${chipIn(5, 18, 'red')} && ${chipIn(6, 18, 'orange')} && ${chipIn(7, 18, 'red')}`)
  await js("document.querySelector('.grid .body').focus()")
  await key('Down')
  await waitFor('at R6', "document.querySelector('.formula-bar .address').textContent === 'R6' && !!document.querySelector('.list-button')")
  await js("document.querySelector('.list-button').click()")
  await waitFor('chips in the list', "[...document.querySelectorAll('.pick-menu li .chip')].length === 2")
  await waitFor('tick on Done', "(() => { const on = document.querySelector('.pick-menu li[aria-selected=\"true\"]'); return !!on && on.textContent === 'Done' && !!on.querySelector('.pick-tick svg') })()")
  await js("[...document.querySelectorAll('.pick-menu li')].find((l) => l.textContent === 'Todo').click()")
  await waitFor('R6 is now Todo', chipIn(6, 18, 'red'))
  await js("document.querySelector('.list-button').click()")
  await waitFor('Edit choices', "!!document.querySelector('.pick-menu .pick-edit')")
  await js("document.querySelector('.pick-menu .pick-edit').click()")
  await waitFor('panel for the list', "!!document.querySelector('.panel[aria-label=\"Validation\"] h2') && document.querySelector('.panel[aria-label=\"Validation\"] h2').textContent === 'Allowed in R5:R7'")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Cancel').click()")
  await waitFor('panel closed', "!document.querySelector('.panel')")
  result.chips = true
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  // Colour rule: B1:B3 greater than 1000 gets Excel's light red fill.
  await js("document.querySelector('.toolbar .more-button').click()")
  await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === 'Conditional formatting...').click()")
  await waitFor('colour rule form', "!!document.querySelector('.cf-panel input[aria-label=\"Cells\"]')")
  await setInput('.cf-panel input[aria-label="Cells"]', 'B1:B3')
  await setInput('.cf-panel input[aria-label="Value"]', '1000')
  await js("[...document.querySelectorAll('.cf-panel button')].find((b) => b.textContent.trim() === 'Save').click()")
  await waitFor('rule listed', "document.querySelectorAll('.cf-list li').length === 1")
  await js("document.querySelector('.cf-panel .close').click()")
  await waitFor('coloured', cellNode(1, 2) + ".style.background === 'rgb(255, 199, 206)' && " + cellNode(3, 2) + ".style.background === 'rgb(255, 199, 206)'")
  // A formula rule (B2 under 1000, green) and an icon set on B1:B3
  // (proposals/2026-10-05-formula-rules-icon-sets.md).
  const addRule = async (kind, fill) => {
    await js("document.querySelector('.toolbar .more-button').click()")
    await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === 'Conditional formatting...').click()")
    await waitFor('rules list', "[...document.querySelectorAll('.cf-panel button')].some((b) => b.textContent.trim() === 'Add a rule')")
    await js("[...document.querySelectorAll('.cf-panel button')].find((b) => b.textContent.trim() === 'Add a rule').click()")
    await waitFor('rule form', "!!document.querySelector('.cf-panel input[aria-label=\"Cells\"]')")
    await setInput('.cf-panel input[aria-label="Cells"]', 'B1:B3')
    await setSelect('.cf-panel select[aria-label="Colour cells that are"]', kind)
    await fill()
    await js("[...document.querySelectorAll('.cf-panel button')].find((b) => b.textContent.trim() === 'Save').click()")
    await waitFor('rule saved', "!document.querySelector('.cf-panel input[aria-label=\"Cells\"]')")
    await js("document.querySelector('.cf-panel .close').click()")
  }
  await addRule('formula', async () => {
    await waitFor('formula field', "!!document.querySelector('.cf-panel input[aria-label=\"Formula\"]')")
    await setInput('.cf-panel input[aria-label="Formula"]', '=B1<1000')
    await setSelect('.cf-panel select[aria-label="Look"]', '2')
  })
  await waitFor('formula rule colours B2', cellNode(2, 2) + ".style.background === 'rgb(198, 239, 206)' && " + cellNode(1, 2) + ".style.background === 'rgb(255, 199, 206)'")
  await addRule('icons', async () => { await waitFor('icon field', "!!document.querySelector('.cf-panel select[aria-label=\"Icons\"]')") })
  await waitFor('icons in cells', '!!' + cellNode(1, 2) + ".querySelector('.cf-icon svg') && !!" + cellNode(3, 2) + ".querySelector('.cf-icon svg')")
  result.colourRules = true
  await js("document.querySelector('.grid .body').focus()")
  // Named range: B1:B2 as "Budget", used in a formula in Q1, then found
  // again from the name box.
  await js("document.querySelector('.toolbar .more-button').click()")
  await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === 'Named ranges...').click()")
  await waitFor('names panel', "[...document.querySelectorAll('.names-panel button')].some((b) => b.textContent.trim() === 'Name a range')")
  await js("[...document.querySelectorAll('.names-panel button')].find((b) => b.textContent.trim() === 'Name a range').click()")
  await waitFor('name form', "!!document.querySelector('.names-panel input[aria-label=\"Name\"]')")
  await setInput('.names-panel input[aria-label="Name"]', 'Budget')
  await setInput('.names-panel input[aria-label="Range"]', 'B1:B2')
  await js("[...document.querySelectorAll('.names-panel button')].find((b) => b.textContent.trim() === 'Save').click()")
  await waitFor('named', "document.querySelectorAll('.names-panel .name-go').length === 1")
  await js("document.querySelector('.names-panel .close').click()")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  for (let i = 0; i < 16; i++) await key('Right')
  await enter('=ROWS(Budget)', 'Return', '2')
  await js("document.querySelector('.formula-bar span.address').click()")
  await waitFor('name box', "!!document.querySelector('.formula-bar input.address')")
  await setInput('.formula-bar input.address', 'budget')
  await key('Return')
  await waitFor('went to the name', "document.querySelector('.formula-bar .address').textContent === 'B1' && !!document.querySelector('.range')")
  result.names = true
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  result.formats = result.frozenStays === true && /^Showing 1 of \d+ rows$/.test(result.filterStatus) && result.skipsHidden && result.comments && result.validation && result.chips && result.colourRules && result.names
  step('cell formats, row heights, freeze, filter, hiding, comments, validation, colour rules and names')

  // Rename the sheet.
  await js(`(() => {
    const el = document.querySelector('.title')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus(); set.call(el, 'Household budget'); el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })()`)
  await waitFor('title in list', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent.trim() === 'Household budget')")
  step('renamed')

  // Export to .xlsx, then import that file back through the file picker.
  await more('Save as an Excel file')
  const file = path.join(downloads, 'Household budget.xlsx')
  const start = Date.now()
  while (!(fs.existsSync(file) && fs.statSync(file).size > 1000) && Date.now() - start < 20000) await sleep(200)
  await sleep(500)
  result.exportedBytes = fs.existsSync(file) ? fs.statSync(file).size : 0
  step('export')

  // The same sheet as an OpenDocument file, for LibreOffice, with a chart
  // from A1:B2 in it; imported back below. The chart is deleted after.
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await sendMod('Down', ['shift']); await sendMod('Right', ['shift'])
  await js("document.querySelector('.insert-chart').click()")
  await waitFor('chart inserted', "!!document.querySelector('.chart-frame svg') && !!document.querySelector('.chart-panel')")
  await js("document.querySelector('.chart-panel .close').click()")
  await more('Save as an OpenDocument file (.ods)')
  const odsFile = path.join(downloads, 'Household budget.ods')
  for (const t0 = Date.now(); !(fs.existsSync(odsFile) && fs.statSync(odsFile).size > 1000) && Date.now() - t0 < 10000;) await sleep(200)
  await sleep(300)
  if (!fs.existsSync(odsFile)) throw new Error('no .ods saved')
  await js("document.querySelector('.chart-frame').click()")
  await waitFor('chart tools', "!!document.querySelector('.chart-tools [aria-label=\"Delete chart\"]')")
  await js("document.querySelector('.chart-tools [aria-label=\"Delete chart\"]').click()")
  await waitFor('chart deleted', "!document.querySelector('.chart-frame')")
  step('ods')

  // CSV and PDF of this tab from the More menu; duplicate a tab and delete
  // the copy from the tab menu.
  await more('Download this tab as CSV')
  const csvFile = path.join(downloads, 'Household budget.csv')
  for (const t0 = Date.now(); !fs.existsSync(csvFile) && Date.now() - t0 < 10000;) await sleep(200)
  await sleep(300)
  const csv = fs.existsSync(csvFile) ? fs.readFileSync(csvFile, 'utf8') : ''
  await more('Save as JSON')
  const jsonFile = path.join(downloads, 'Household budget.json')
  for (const t0 = Date.now(); !fs.existsSync(jsonFile) && Date.now() - t0 < 10000;) await sleep(200)
  await sleep(300)
  let saved = null
  try { saved = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) } catch {}
  // The first row names the fields: Rent | 1200, then Food, Total.
  result.json = !!saved && Array.isArray(saved.Sheet1) && saved.Sheet1.some((r) => r.Rent === 'Total' && r['1200'] === 1650.5)
  if (!result.json) throw new Error('json export: ' + JSON.stringify(saved).slice(0, 300))
  await more('Save this tab as PDF')
  const pdfFile = path.join(dataDir, 'Household budget.pdf')
  for (const t0 = Date.now(); !fs.existsSync(pdfFile) && Date.now() - t0 < 15000;) await sleep(200)
  await sleep(300)
  const pdf = fs.existsSync(pdfFile) ? fs.readFileSync(pdfFile) : Buffer.alloc(0)
  result.csvPdf = csv.includes('Rent,1200') && csv.includes('Total,1650.5') && pdf.length > 1000 && pdf.slice(0, 4).toString() === '%PDF'
  // Ctrl+P prints the tab, as Print this tab... does.
  const printed = path.join(dataDir, 'printed.html')
  await sendMod('P', ['control'])
  for (const t0 = Date.now(); !fs.existsSync(printed) && Date.now() - t0 < 15000;) await sleep(200)
  result.printKey = fs.existsSync(printed) && fs.readFileSync(printed, 'utf8').includes('1650.5')
  if (!result.printKey) throw new Error('Ctrl+P did not print the tab')
  await js("document.querySelector('.tab.active').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 700 }))")
  await waitFor('tab menu', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Duplicate')")
  await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Duplicate').click()")
  await waitFor('duplicated', "document.querySelector('.tab.active').textContent === 'Sheet1 2' && [...document.querySelectorAll('.cell')].some((c) => c.textContent === '1650.5')")
  await js("document.querySelector('.tab.active').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 700 }))")
  await waitFor('tab menu again', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Delete tab')")
  await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Delete tab').click()")
  await waitFor('confirm delete tab', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Delete tab')")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Delete tab').click()")
  await waitFor('tab deleted', "document.querySelectorAll('.tab:not(.add)').length === 1 && document.querySelector('.tab.active').textContent === 'Sheet1'")
  result.tabs = true
  step('csv, json, pdf, duplicate and delete a tab')

  // Tidy up (proposals/2026-10-05-shared-compaction.md): the sheet moves to
  // a fresh copy with the same content, and the app switches to it.
  const listBudget = "window.pearoffice.call('sheet:list', {}).then((l) => JSON.stringify(l.filter((x) => x.title === 'Household budget').map((x) => x.sheetId)))"
  const beforeIds = JSON.parse(await js(listBudget))
  await more('Tidy up this sheet...')
  await waitFor('tidy panel ready', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Tidy up' && !b.disabled)")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Tidy up').click()")
  await waitFor('tidied', listBudget + '.then((s) => { const ids = JSON.parse(s); return ids.length === 1 && ids[0] !== ' + JSON.stringify(beforeIds[0]) + ' })')
  await waitFor('the tidied copy is open', "!document.querySelector('.panel') && [...document.querySelectorAll('.cell')].some((c) => c.textContent === '1650.5')")
  result.tidied = beforeIds.length === 1
  step('tidy up')

  // A .json file: lists of records become tabs, dates become dates
  // (src/sheet/jsonImport.js).
  const json = JSON.stringify({ balance: 42, bills: [{ name: 'Rent', amount: 1200, due: '2026-11-01' }, { name: 'Water', amount: 30.5, due: '2026-11-15' }] })
  await js(`(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([${JSON.stringify(json)}], 'Budget export.json'))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('json sheet open', "document.querySelector('.title').value === 'Budget export' && [...document.querySelectorAll('.tab:not(.add)')].map((t) => t.textContent).join() === 'Summary,bills'")
  await js("[...document.querySelectorAll('.tab:not(.add)')].find((t) => t.textContent === 'bills').click()")
  await waitFor('json values', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === '2026-11-15') && [...document.querySelectorAll('.cell')].some((c) => c.textContent === '30.5')")
  result.jsonImport = true
  step('json import')

  // A .csv file: UTF-8 text, leading zeros kept, dates shown as dates
  // (src/sheet/csvImport.js).
  await js(`(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([${JSON.stringify('Name,Code,Due\nCafé,007,11/15/2026\n')}], 'Codes.csv'))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('csv sheet open', "document.querySelector('.title').value === 'Codes'")
  await waitFor('csv values', "['Café', '007', '2026-11-15'].every((t) => [...document.querySelectorAll('.cell')].some((c) => c.textContent === t))")
  result.csvImport = true
  step('csv import')

  const b64 = fs.readFileSync(file).toString('base64')
  await js(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'Imported budget.xlsx'))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('imported sheet open', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent.trim() === 'Imported budget') && document.querySelector('.title').value === 'Imported budget'")
  await waitFor('imported values', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === '1650.5') && [...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Rent')")
  await js("document.querySelector('.grid .body').focus()")
  for (let i = 0; i < 2; i++) await key('Down')
  await key('Right')
  result.importedFormula = await js("document.querySelector('.formula-bar input').value")
  // Formats come back from the file: M30 underlined and struck through,
  // M31 at 24pt with borders, row 29's height.
  await sendMod('Home', ['control'])
  for (let i = 0; i < 12; i++) await key('Right')
  for (let i = 0; i < 30; i++) await key('Down')
  await waitFor('imported formats', cellNode(30, 13) + ".querySelector('.cell-text').style.textDecoration === 'underline line-through' && " + cellNode(31, 13) + ".querySelector('.cell-text').style.fontSize === '32px' && !!" + cellNode(31, 13) + ".querySelector('.cell-borders') && " + rowHead(29) + '.getBoundingClientRect().height > 45')
  result.importedFormats = true
  step('import')

  const odsB64 = fs.readFileSync(odsFile).toString('base64')
  await js(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(odsB64)}), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'From LibreOffice.ods'))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('ods sheet open', "document.querySelector('.title').value === 'From LibreOffice'")
  await waitFor('ods values', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === '1650.5') && [...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Rent')")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  for (let i = 0; i < 2; i++) await key('Down')
  await key('Right')
  result.odsFormula = await js("document.querySelector('.formula-bar input').value")
  await waitFor('ods chart', "!!document.querySelector('.chart-frame svg')")
  result.odsChart = true
  // The same formats as the .xlsx brought back: M30 underlined and struck
  // through, M31 at 24pt with borders, row 29's height.
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  for (let i = 0; i < 12; i++) await key('Right')
  for (let i = 0; i < 30; i++) await key('Down')
  await waitFor('ods formats', cellNode(30, 13) + ".querySelector('.cell-text').style.textDecoration === 'underline line-through' && " + cellNode(31, 13) + ".querySelector('.cell-text').style.fontSize === '32px' && !!" + cellNode(31, 13) + ".querySelector('.cell-borders') && " + rowHead(29) + '.getBoundingClientRect().height > 45')
  // Colour rules and validation: the icons in B1 and B3, the list in P5.
  await sendMod('Home', ['control'])
  await waitFor('ods icons', '!!' + cellNode(1, 2) + ".querySelector('.cf-icon svg') && !!" + cellNode(3, 2) + ".querySelector('.cf-icon svg')")
  for (let i = 0; i < 15; i++) await key('Right')
  for (let i = 0; i < 4; i++) await key('Down')
  await waitFor('ods at P5', "document.querySelector('.formula-bar .address').textContent === 'P5'")
  await waitFor('ods list', "!!document.querySelector('.list-button')")
  result.odsRules = true
  step('ods import')

  return result.importedFormats && result.formats && result.csvPdf && result.printKey && result.tabs && result.tidied && result.jsonImport && result.csvImport && result.importedFormula === '=SUM(B1:B2)' && result.odsFormula === '=SUM(B1:B2)' && result.odsChart && result.odsRules && result.exportedBytes > 1000
}
