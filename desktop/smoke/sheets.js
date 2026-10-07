// Smoke test part "sheets": the spreadsheet editor. Typing, formulas,
// spilling, shortcuts, find and sort, fill, charts, copy and paste, bold,
// undo, fast typing and zoom.

const fs = require('node:fs')
const path = require('node:path')
const gridHelpers = require('./grid')

module.exports = async function sheets (t) {
  const { wc, js, step, waitFor, type, key, sendMod, dataDir, result, sleep } = t
  const { cellText, enter, cellNode } = gridHelpers(t)

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
  step('typed and computed')

  // Formula suggestions: =su lists SUM; Down, Down, Tab inserts it; inside
  // the brackets the argument help shows; Escape leaves the cell as it was.
  await type('=su')
  await waitFor('suggestions', "!!document.querySelector('.formula-help') && document.querySelector('.formula-help').textContent.includes('SUM(')")
  if (process.env.PEAROFFICE_SMOKE_HELP_SHOT) fs.writeFileSync(process.env.PEAROFFICE_SMOKE_HELP_SHOT, (await wc.capturePage()).toPNG())
  result.suggested = await js("[...document.querySelectorAll('.formula-help .fname')].map((e) => e.textContent).slice(0, 3).join(',')")
  await key('Down'); await key('Down'); await key('Tab')
  await waitFor('function inserted', "(document.querySelector('.grid .editor') || {}).value === '=SUM('")
  await type('B1')
  await waitFor('argument help', "!!document.querySelector('.formula-help .sig b')")
  result.argHelp = await js("document.querySelector('.formula-help .sig b').textContent")
  await key('Escape')
  await waitFor('edit cancelled', "!document.querySelector('.grid .editor') && !document.querySelector('.formula-help')")
  await js("document.querySelector('.grid .body').focus()")
  step('formula suggestions')

  // Spilling: =SEQUENCE(3) in H1 fills H1:H3 and outlines the block; a
  // value typed in H3 blocks it (#SPILL!) with a note saying why.
  for (let i = 0; i < 6; i++) await key('Right')
  for (let i = 0; i < 3; i++) await key('Up')
  await enter('=SEQUENCE(3)', 'Enter', '1')
  const cellAt = (a1) => "[...document.querySelectorAll('.cell')].find((c) => c.dataset.r === '" + a1[1] + "' && c.dataset.c === '8')"
  await waitFor('spilled', cellAt('H3') + ".textContent === '3' && " + cellAt('H2') + ".textContent === '2'")
  await waitFor('spill outline', "!!document.querySelector('.spill-outline') && document.querySelector('.formula-bar input').value === '=SEQUENCE(3)' && document.querySelector('.formula-bar input').classList.contains('spilled')")
  // H1# is the whole spill from H1.
  await key('Up'); await key('Right')
  await enter('=SUM(H1#)', 'Enter', '6')
  await key('Left')
  await key('Down')
  await enter('x', 'Enter')
  for (let i = 0; i < 3; i++) await key('Up')
  await waitFor('spill blocked', cellAt('H1') + ".textContent === '#SPILL!' && !!document.querySelector('.spill-note') && document.querySelector('.spill-note').textContent.includes('H3')")
  await key('Down'); await key('Down')
  await key('Delete')
  await waitFor('spill back', cellAt('H3') + ".textContent === '3'")
  await key('Up'); await key('Up')
  await key('Delete')
  await waitFor('spill cleared', cellAt('H1') + ".textContent === '' && !document.querySelector('.spill-outline')")
  await key('Right'); await key('Delete'); await key('Left')
  for (let i = 0; i < 6; i++) await key('Left')
  for (let i = 0; i < 3; i++) await key('Down')
  result.spill = true
  step('spilling formula')

  // Quick wins: totals of the selection, Ctrl+Home and Ctrl+Down, more
  // decimals and "Paste values only" from the cell menu.
  await sendMod('Home', ['control'])
  await waitFor('at A1', "document.querySelector('.formula-bar .address').textContent === 'A1'")
  await sendMod('Down', ['control'])
  await waitFor('Ctrl+Down to A3', "document.querySelector('.formula-bar .address').textContent === 'A3'")
  await key('Right'); await key('Up'); await key('Up')
  await sendMod('Down', ['shift']); await sendMod('Down', ['shift'])
  await waitFor('totals', "!!document.querySelector('.totals') && document.querySelector('.totals').textContent.includes('Sum 3301') && document.querySelector('.totals').textContent.includes('Count 3')")
  await key('Up'); await key('Down')
  await js("document.querySelector('.tools [aria-label=\"More decimal places\"]').click()")
  await waitFor('more decimals', cellNode(2, 2) + ".textContent === '450.50'")
  await key('Down')
  await js(`(() => { const el = ${cellNode(3, 2)}; el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 })) })()`)
  await waitFor('cell menu', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Copy')")
  await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Copy').click()")
  await key('Right'); await key('Right')
  await js(`(() => { const el = ${cellNode(3, 4)}; el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 200 })) })()`)
  await waitFor('cell menu again', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Paste values only')")
  await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Paste values only').click()")
  await waitFor('pasted value', cellNode(3, 4) + ".textContent === '1650.5' && document.querySelector('.formula-bar input').value === '1650.5'")
  await key('Delete')
  await waitFor('cleared', cellNode(3, 4) + ".textContent === ''")
  await key('Left'); await key('Left'); await key('Down')
  result.quickWins = true
  step('totals, shortcuts, decimals, paste values')

  // Find (Ctrl+F) jumps to a match; "Sort Z to A" from the cell menu sorts
  // the block around the cell; one undo puts it back.
  await sendMod('F', ['control'])
  await waitFor('find panel', "!!document.querySelector('.find-panel input')")
  await type('Food')
  await key('Enter')
  await waitFor('found', "document.querySelector('.formula-bar .address').textContent === 'A2'")
  await js("document.querySelector('.find-panel .close').click()")
  await js(`(() => { const el = ${cellNode(1, 1)}; el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 150 })) })()`)
  await waitFor('sort in menu', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Sort Z to A')")
  await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Sort Z to A').click()")
  await waitFor('sorted', cellNode(1, 1) + ".textContent === 'Total' && " + cellNode(3, 1) + ".textContent === 'Food'")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Z', ['control'])
  await waitFor('sort undone', cellNode(1, 1) + ".textContent === 'Rent' && " + cellNode(3, 2) + ".textContent === '1650.5'")
  for (let i = 0; i < 3; i++) await key('Down')
  await key('Right')
  result.findSort = true
  step('find and sort')

  // Fill: 1 and 2 in J1:J2, drag the fill handle to J5 for 3, 4, 5; Ctrl+D
  // copies a formula down with its reference shifted.
  const center = async (sel) => js(`(() => { const r = (${sel}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })()`)
  await sendMod('Home', ['control'])
  for (let i = 0; i < 9; i++) await key('Right')
  await enter('1', 'Enter')
  await enter('2', 'Enter')
  await key('Up'); await key('Up')
  await sendMod('Down', ['shift'])
  await waitFor('fill handle', "!!document.querySelector('.fill-handle')")
  const [hx, hy] = await center("document.querySelector('.fill-handle')")
  const [tx, ty] = await center(cellNode(5, 10))
  wc.sendInputEvent({ type: 'mouseDown', x: hx, y: hy, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 6; i++) { wc.sendInputEvent({ type: 'mouseMove', x: hx + Math.round((tx - hx) * i / 6), y: hy + Math.round((ty - hy) * i / 6), button: 'left' }); await sleep(40) }
  wc.sendInputEvent({ type: 'mouseUp', x: tx, y: ty, button: 'left', clickCount: 1 })
  await waitFor('filled series', cellNode(3, 10) + ".textContent === '3' && " + cellNode(5, 10) + ".textContent === '5'")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  for (let i = 0; i < 10; i++) await key('Right')
  await enter('=J1*10', 'Enter', '10')
  await key('Up')
  await sendMod('Down', ['shift']); await sendMod('Down', ['shift'])
  await sendMod('D', ['control'])
  await waitFor('ctrl+d', cellNode(3, 11) + ".textContent === '30'")
  // Clear J1:K5 and go back to B4.
  await sendMod('Home', ['control'])
  for (let i = 0; i < 9; i++) await key('Right')
  await sendMod('Right', ['shift'])
  for (let i = 0; i < 4; i++) await sendMod('Down', ['shift'])
  await key('Delete')
  await waitFor('fill cleared', cellNode(5, 10) + ".textContent === '' && " + cellNode(1, 11) + ".textContent === ''")
  await sendMod('Home', ['control'])
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  result.fill = true
  step('fill handle and Ctrl+D')

  // Charts: insert one from A1:B2, show values, switch to a line chart,
  // change a cell and see the chart follow, download a PNG, delete it.
  await sendMod('Home', ['control'])
  await sendMod('Down', ['shift']); await sendMod('Right', ['shift'])
  await js("document.querySelector('.insert-chart').click()")
  await waitFor('chart inserted', "!!document.querySelector('.chart-frame svg') && !!document.querySelector('.chart-panel')")
  await js("[...document.querySelectorAll('.chart-panel label')].find((l) => l.textContent.includes('Show values')).querySelector('input').click()")
  await waitFor('values shown', "[...document.querySelectorAll('.chart-frame svg text')].some((t) => t.textContent === '1200')")
  // A click that lands while the panel redraws can be lost, so each wait
  // clicks again until the type is picked (picking it twice changes nothing).
  const pick = (t) => "((b) => (b && b.getAttribute('aria-checked') === 'true' && !!document.querySelector('.chart-frame svg')) || (b && b.click(), false))(document.querySelector('.chart-types [title=\"" + t + "\"]'))"
  await waitFor('line chart', pick('Line'))
  // Each newer type draws (proposals/2026-10-05-more-chart-types.md).
  for (const t of ['Radar', 'Bubble', 'Stock', 'Histogram', 'Waterfall']) await waitFor(t + ' chart', pick(t))
  result.moreChartTypes = true
  await waitFor('line chart again', pick('Line'))
  await js("document.querySelector('.chart-panel .close').click()")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Right')
  await enter('1300', 'Enter')
  await waitFor('chart follows the cell', "[...document.querySelectorAll('.chart-frame svg text')].some((t) => t.textContent === '1300')")
  await js("document.querySelector('.chart-frame').click()")
  await waitFor('chart tools', "!!document.querySelector('.chart-tools')")
  await js("document.querySelector('.chart-tools [aria-label=\"Download as PNG\"]').click()")
  const pngFile = path.join(dataDir, 'downloads', 'Chart.png')
  for (const t0 = Date.now(); !fs.existsSync(pngFile) && Date.now() - t0 < 10000;) await sleep(200)
  await sleep(300)
  const png = fs.existsSync(pngFile) ? fs.readFileSync(pngFile) : Buffer.alloc(0)
  // The .xlsx export carries the chart (src/sheet/xlsxCharts.js).
  await js("document.querySelector('.toolbar .export').click()")
  const chartXlsx = path.join(dataDir, 'downloads', 'Untitled sheet.xlsx')
  for (const t0 = Date.now(); !fs.existsSync(chartXlsx) && Date.now() - t0 < 10000;) await sleep(200)
  await sleep(500)
  // fflate is only in the checkout; a packaged app checks the file was saved.
  const fflate = (() => { try { return require('fflate') } catch { return null } })()
  if (fflate) {
    const zipped = fs.existsSync(chartXlsx) ? fflate.unzipSync(fs.readFileSync(chartXlsx)) : {}
    result.chartInXlsx = !!zipped['xl/charts/chart1.xml'] && fflate.strFromU8(zipped['xl/worksheets/sheet1.xml']).includes('<drawing r:id=')
  } else result.chartInXlsx = fs.existsSync(chartXlsx)
  await js("document.querySelector('.chart-frame').click()")
  await waitFor('chart tools again', "!!document.querySelector('.chart-tools')")
  await js("document.querySelector('.chart-tools [aria-label=\"Delete chart\"]').click()")
  await waitFor('chart deleted', "!document.querySelector('.chart-frame')")
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Home', ['control'])
  await key('Right')
  await enter('1200', 'Enter', '1650.5')
  await sendMod('Home', ['control'])
  await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
  result.charts = png.length > 2000 && png.slice(1, 4).toString() === 'PNG' && result.chartInXlsx
  step('charts')

  // Ranges, copy and paste: select B1:B3, copy, paste into C1. The formula
  // moves with it, as in Excel.
  for (let i = 0; i < 3; i++) await key('Up')
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['shift'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down', modifiers: ['shift'] }); await sleep(80)
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['shift'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down', modifiers: ['shift'] }); await sleep(150)
  await waitFor('range shown', "!!document.querySelector('.range')")
  wc.copy()
  await sleep(200)
  await key('Right')
  wc.paste()
  await waitFor('pasted', "[...document.querySelectorAll('.cell')].filter((c) => c.textContent === '1650.5').length === 2")
  // Go to C3 to read its formula, then reselect C1:C3 from there.
  await key('Down')
  await key('Down')
  result.pastedFormula = await js("document.querySelector('.formula-bar input').value")
  for (let i = 0; i < 2; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Up', modifiers: ['shift'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Up', modifiers: ['shift'] }); await sleep(100) }
  step('copy and paste')

  // Fill colour on the pasted range, then clear it.
  await js("document.querySelectorAll('.swatch-button')[1].click()")
  await waitFor('palette', "!!document.querySelector('.palette')")
  await js("document.querySelector('.palette .swatch').click()")
  await waitFor('fill applied', "[...document.querySelectorAll('.cell')].filter((c) => c.style.background).length >= 3")
  step('fill colour')
  await js("document.querySelector('.grid .body').focus()")
  await key('Delete')
  await waitFor('range cleared', "[...document.querySelectorAll('.cell')].filter((c) => c.textContent === '1650.5').length === 1")
  step('clear range')
  // Back to B4, where the rest of the test expects to be (active cell is C3).
  await key('Left')
  await key('Down')

  result.grid = {
    A1: await cellText(1, 1),
    B1: await cellText(1, 2),
    A3: await cellText(3, 1),
    B3: await cellText(3, 2)
  }
  // Back up to B3: the formula bar shows the formula in A1 form.
  await key('Up')
  result.formulaBar = await js("document.querySelector('.formula-bar input').value")

  // Bold B3 with Ctrl+B and check the class.
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: ['control'] })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'B', modifiers: ['control'] })
  await waitFor('bold applied', "[...document.querySelectorAll('.cell.b')].some((c) => c.textContent === '1650.5')")
  step('bold')

  // Undo the bold.
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] })
  await waitFor('bold undone', "!document.querySelector('.cell.b')")
  result.afterUndo = await cellText(3, 2)
  step('undo')

  // Type with no gap between keys: keys that arrive before the cell editor
  // is drawn must still land in it, in order.
  await js("document.querySelector('.grid .body').focus()")
  for (let i = 0; i < 4; i++) await key('Down')
  await type('Typed fast 123', 0)
  await key('Enter')
  await waitFor('fast typing kept', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Typed fast 123')", 10000)
  step('fast typing')

  // Zoom (bottom right) and Ctrl 0. The theme is in the app part.
  await js("document.querySelector('.zoom [aria-label=\"Zoom in\"]').click()")
  await waitFor('zoomed in', "document.querySelector('.zoom-level').textContent === '110%' && document.querySelector('.grid').style.getPropertyValue('--row-h') === '26px'")
  await sendMod('0', ['control'])
  await waitFor('zoom reset', "document.querySelector('.zoom-level').textContent === '100%'")
  step('zoom')

  await sleep(300)
  if (process.env.PEAROFFICE_SMOKE_SHOT) {
    await t.shot('PEAROFFICE_SMOKE_SHOT')
    step('screenshot', process.env.PEAROFFICE_SMOKE_SHOT)
  }

  return result.moreChartTypes && result.spill && result.quickWins && result.findSort && result.fill && result.charts && result.suggested === 'SUBSTITUTE,SUBTOTAL,SUM' && result.argHelp === 'number1' && result.pastedFormula === '=SUM(C1:C2)' && result.afterUndo === '1650.5' && result.grid.B3 === '1650.5' && result.grid.A1 === 'Rent' && result.formulaBar === '=SUM(B1:B2)'
}
