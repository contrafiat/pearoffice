// In-app part of the desktop smoke test (see smoke.js). Runs in the main
// process with an offscreen window: creates a sheet through the UI, types
// with real key events, reads the grid back from the DOM and saves a
// screenshot. Prints one JSON line and quits.

const fs = require('node:fs')
const path = require('node:path')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run ({ app, win, ready, log, dataDir, getTray }) {
  const wc = win.webContents
  const result = { ok: false, steps: [] }
  const js = (code) => wc.executeJavaScript(code, true)
  const step = (name, data) => { result.steps.push(data === undefined ? name : { [name]: data }); log('smoke:', name) }

  async function waitFor (label, code, timeout = 20000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await js(code).catch(() => false)) return
      await sleep(100)
    }
    throw new Error('timed out waiting for ' + label)
  }

  async function openSettings () {
    await js("document.querySelector('.me-row').click()")
    await waitFor('settings open', "!!document.querySelector('.panel.settings')")
  }

  async function type (text, gap = 40) {
    for (const ch of text) {
      const modifiers = /[A-Z]/.test(ch) ? ['shift'] : []
      wc.sendInputEvent({ type: 'keyDown', keyCode: ch, modifiers })
      wc.sendInputEvent({ type: 'char', keyCode: ch, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode: ch, modifiers })
      if (gap) await sleep(gap)
    }
  }

  async function key (keyCode) {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
    await sleep(80)
  }

  const cellText = (row, col) => js(`(() => {
    const el = [...document.querySelectorAll('.cell')].find((c) => c.style.top === '${(row - 1) * 24}px' && c.style.left === document.querySelectorAll('.col-head')[${col - 1}].style.left)
    return el ? el.textContent : null
  })()`)

  try {
    await ready
    step('worklet ready')
    await new Promise((resolve) => wc.isLoading() ? wc.once('did-finish-load', resolve) : resolve())
    // Generous: a first launch on macOS includes the system's check of the new app.
    await waitFor('sheet list', "!!document.querySelector('.new-sheet') && !document.querySelector('.sheet-list .muted')?.textContent.includes('Starting')", 60000)
    step('ui loaded')

    await js("document.querySelector('.new-sheet').click()")
    await waitFor('grid', "!!document.querySelector('.grid .body') && !!document.querySelector('.selection')")
    // Let the new sheet settle, then make sure the grid has focus.
    await sleep(500)
    await js("document.querySelector('.grid .body').focus()")
    await waitFor('grid focus', "document.activeElement === document.querySelector('.grid .body')")
    step('sheet created')

    const hasCell = (text) => `[...document.querySelectorAll('.cell')].some((c) => c.textContent === ${JSON.stringify(text)})`
    async function enter (text, then, shows = text) {
      await type(text)
      await key(then)
      await waitFor('cell ' + text, hasCell(shows))
      await waitFor('grid focus', "document.activeElement === document.querySelector('.grid .body')")
    }
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
    if (process.env.PEARSHEET_SMOKE_HELP_SHOT) fs.writeFileSync(process.env.PEARSHEET_SMOKE_HELP_SHOT, (await wc.capturePage()).toPNG())
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
    // decimals, and "Paste values only" from the cell menu.
    const cellNode = (r, c) => "[...document.querySelectorAll('.cell')].find((x) => x.dataset.r === '" + r + "' && x.dataset.c === '" + c + "')"
    const sendMod = async (keyCode, modifiers) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await sleep(60) }
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
    await js("document.querySelector('.chart-types [title=\"Line\"]').click()")
    await waitFor('line chart', "document.querySelector('.chart-types [title=\"Line\"]').getAttribute('aria-checked') === 'true'")
    await js("document.querySelector('.chart-panel .close').click()")
    await js("document.querySelector('.grid .body').focus()")
    await sendMod('Home', ['control'])
    await key('Right')
    await enter('1300', 'Enter')
    await waitFor('chart follows the cell', "[...document.querySelectorAll('.chart-frame svg text')].some((t) => t.textContent === '1300')")
    await js("document.querySelector('.chart-frame').click()")
    await waitFor('chart tools', "!!document.querySelector('.chart-tools')")
    await js("document.querySelector('.chart-tools [aria-label=\"Download as PNG\"]').click()")
    const pngFile = require('node:path').join(dataDir, 'downloads', 'Chart.png')
    for (const t0 = Date.now(); !fs.existsSync(pngFile) && Date.now() - t0 < 10000;) await sleep(200)
    await sleep(300)
    const png = fs.existsSync(pngFile) ? fs.readFileSync(pngFile) : Buffer.alloc(0)
    // The .xlsx export carries the chart (src/shared/xlsxCharts.js).
    await js("document.querySelector('.toolbar .export').click()")
    const chartXlsx = require('node:path').join(dataDir, 'downloads', 'Untitled sheet.xlsx')
    for (const t0 = Date.now(); !fs.existsSync(chartXlsx) && Date.now() - t0 < 10000;) await sleep(200)
    await sleep(500)
    const zipped = fs.existsSync(chartXlsx) ? require('fflate').unzipSync(fs.readFileSync(chartXlsx)) : {}
    result.chartInXlsx = !!zipped['xl/charts/chart1.xml'] && require('fflate').strFromU8(zipped['xl/worksheets/sheet1.xml']).includes('<drawing r:id=')
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

    // Cell formats (proposals/2026-10-04-cell-formats.md), in M30 out of the
    // way: underline and strikethrough, wrap a long text and see its row
    // grow, a larger size, borders, and a row resized by dragging its edge.
    const rowHead = (r) => "[...document.querySelectorAll('.row-head')].find((h) => h.firstChild && h.firstChild.textContent === '" + r + "')"
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
    await js(`(() => { const s = document.querySelector('.tools [aria-label="Font size"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '24'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await waitFor('bigger text', cellNode(31, 13) + ".querySelector('.cell-text').style.fontSize === '32px' && " + rowHead(31) + '.getBoundingClientRect().height > 35')
    await js("document.querySelector('.tools [aria-label=\"Borders\"]').click()")
    await waitFor('borders menu', "!!document.querySelector('.borders-menu')")
    await js("[...document.querySelectorAll('.borders-menu .border-preset')].find((b) => b.textContent === 'All').click()")
    await waitFor('borders', "!!" + cellNode(31, 13) + ".querySelector('.cell-borders')")
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
    await waitFor('unmerged', "!!" + cellNode(40, 14))
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
    await waitFor('row hidden', "!" + cellNode(2, 1) + " && !!document.querySelector('.unhide-mark.row')")
    await js("document.querySelector('.grid .body').focus()")
    await sendMod('Home', ['control'])
    await key('Down')
    result.skipsHidden = await js("document.querySelector('.formula-bar .address').textContent") === 'A3'
    await js("document.querySelector('.unhide-mark.row').click()")
    await waitFor('row shown', "!!" + cellNode(2, 1) + " && !document.querySelector('.unhide-mark')")
    await js("document.querySelector('.grid .body').focus()")
    await sendMod('Home', ['control'])
    await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
    // Comment on A1 from the cell menu, reply, resolve.
    const typeInto = (sel, text) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    const panelButton = (label) => js("[...document.querySelectorAll('.comments-panel button')].find((b) => b.textContent.trim() === " + JSON.stringify(label) + ').click()')
    await js(cellNode(1, 1) + ".dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }))")
    await waitFor('cell menu comment', "[...document.querySelectorAll('.menu li')].some((l) => l.textContent === 'Comment')")
    await js("[...document.querySelectorAll('.menu li')].find((l) => l.textContent === 'Comment').click()")
    await waitFor('comment panel', "!!document.querySelector('.comments-panel textarea')")
    await typeInto('.comments-panel textarea', 'Check the rent')
    await panelButton('Comment')
    await waitFor('commented', "!!" + cellNode(1, 1) + ".querySelector('.comment-mark') && [...document.querySelectorAll('.comment-text')].some((p) => p.textContent === 'Check the rent')")
    await typeInto('.comments-panel textarea', 'Checked')
    await panelButton('Reply')
    await waitFor('replied', "document.querySelectorAll('.comments-panel .comment-text').length === 2")
    await panelButton('Resolve')
    await waitFor('resolved', "!!" + cellNode(1, 1) + ".querySelector('.comment-mark.resolved')")
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
    await waitFor('picked', cellNode(5, 16) + " && " + cellNode(5, 16) + ".textContent === 'Yes'")
    result.validation = true
    await js("document.querySelector('.grid .body').focus()")
    await sendMod('Home', ['control'])
    await key('Right'); for (let i = 0; i < 3; i++) await key('Down')
    // Colour rule: B1:B3 greater than 1000 gets Excel's light red fill.
    const setInput = (sel, text) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await js("document.querySelector('.toolbar .more-button').click()")
    await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === 'Colour rules...').click()")
    await waitFor('colour rule form', "!!document.querySelector('.cf-panel input[aria-label=\"Cells\"]')")
    await setInput('.cf-panel input[aria-label="Cells"]', 'B1:B3')
    await setInput('.cf-panel input[aria-label="Value"]', '1000')
    await js("[...document.querySelectorAll('.cf-panel button')].find((b) => b.textContent.trim() === 'Save').click()")
    await waitFor('rule listed', "document.querySelectorAll('.cf-list li').length === 1")
    await js("document.querySelector('.cf-panel .close').click()")
    await waitFor('coloured', cellNode(1, 2) + ".style.background === 'rgb(255, 199, 206)' && " + cellNode(3, 2) + ".style.background === 'rgb(255, 199, 206)'")
    result.colourRules = true
    await js("document.querySelector('.grid .body').focus()")
    result.formats = result.frozenStays === true && /^Showing 1 of \d+ rows$/.test(result.filterStatus) && result.skipsHidden && result.comments && result.validation && result.colourRules
    step('cell formats, row heights, freeze, filter, hiding, comments, validation and colour rules')

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

    // Rename the sheet.
    await js(`(() => {
      const el = document.querySelector('.title')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      el.focus(); set.call(el, 'Household budget'); el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })()`)
    await waitFor('title in list', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent.trim() === 'Household budget')")
    step('renamed')

    // Type with no gap between keys: keys that arrive before the cell editor
    // is drawn must still land in it, in order.
    await js("document.querySelector('.grid .body').focus()")
    for (let i = 0; i < 4; i++) await key('Down')
    await type('Typed fast 123', 0)
    await key('Enter')
    await waitFor('fast typing kept', "[...document.querySelectorAll('.cell')].some((c) => c.textContent === 'Typed fast 123')", 10000)
    step('fast typing')

    // Export to .xlsx, then import that file back through the file picker.
    const downloads = require('node:path').join(dataDir, 'downloads')
    await js("document.querySelector('.toolbar .export').click()")
    const file = require('node:path').join(downloads, 'Household budget.xlsx')
    const start = Date.now()
    while (!(fs.existsSync(file) && fs.statSync(file).size > 1000) && Date.now() - start < 20000) await sleep(200)
    await sleep(500)
    result.exportedBytes = fs.existsSync(file) ? fs.statSync(file).size : 0
    step('export')

    // CSV and PDF of this tab from the More menu; duplicate a tab and delete
    // the copy from the tab menu.
    const more = async (label) => {
      await js("document.querySelector('.toolbar .more-button').click()")
      await waitFor('more menu: ' + label, "[...document.querySelectorAll('.more-menu li')].some((l) => l.textContent === " + JSON.stringify(label) + ')')
      await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent === " + JSON.stringify(label) + ').click()')
    }
    await more('Download this tab as CSV')
    const csvFile = require('node:path').join(downloads, 'Household budget.csv')
    for (const t0 = Date.now(); !fs.existsSync(csvFile) && Date.now() - t0 < 10000;) await sleep(200)
    await sleep(300)
    const csv = fs.existsSync(csvFile) ? fs.readFileSync(csvFile, 'utf8') : ''
    await more('Save this tab as PDF')
    const pdfFile = require('node:path').join(dataDir, 'Household budget.pdf')
    for (const t0 = Date.now(); !fs.existsSync(pdfFile) && Date.now() - t0 < 15000;) await sleep(200)
    await sleep(300)
    const pdf = fs.existsSync(pdfFile) ? fs.readFileSync(pdfFile) : Buffer.alloc(0)
    result.csvPdf = csv.includes('Rent,1200') && csv.includes('Total,1650.5') && pdf.length > 1000 && pdf.slice(0, 4).toString() === '%PDF'
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
    step('csv, pdf, duplicate and delete a tab')
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

    // The Seeder and Devices panels reach the engine (seeder: and link: calls).
    await openSettings()
    await js("document.querySelector('.panel .settings-seeder').click()")
    await waitFor('seeder panel lists seeders', "!!document.querySelector('.panel') && document.querySelector('.panel').textContent.includes('None yet')")
    await js("document.querySelector('.panel .close').click()")
    await openSettings()
    await js("document.querySelector('.panel .settings-devices').click()")
    await waitFor('devices panel', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Link a new device')")
    // Back returns to Settings.
    await js("document.querySelector('.panel .back').click()")
    await waitFor('back in settings', "!!document.querySelector('.panel.settings')")
    await js("document.querySelector('.panel .settings-devices').click()")
    await waitFor('devices panel again', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Link a new device')")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Link a new device').click()")
    await waitFor('device link', "(document.querySelector('.panel input') || {}).value?.startsWith('pearsheet://link?')")
    await js("document.querySelector('.panel .close').click()")
    await openSettings()
    await js("document.querySelector('.panel .settings-devices').click()")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Show my phrase').click()")
    await waitFor('recovery phrase', "document.querySelectorAll('.phrase li').length === 24")
    await js("document.querySelector('.panel .close').click()")
    step('seeder and devices panels')

    // Run a seeder on this computer, pair this device with it, show its QR.
    await openSettings()
    await js("document.querySelector('.panel .settings-seeder').click()")
    await waitFor('local seeder switch', "[...document.querySelectorAll('.panel label')].some((l) => l.textContent.includes('Run a seeder'))")
    await js("[...document.querySelectorAll('.panel label')].find((l) => l.textContent.includes('Run a seeder')).querySelector('input').click()")
    await waitFor('local seeder running', "document.querySelector('.panel').textContent.includes('Holding')", 60000)
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Pair this device with it').click()")
    await waitFor('paired with the local seeder', "document.querySelector('.panel').textContent.includes('Paired. Your sheets are backing up.')", 60000)
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Show pairing code').click()")
    await waitFor('pairing QR', "!!document.querySelector('.pairing .qr svg')")
    await waitFor('seeder holds the sheets', "/Holding [1-9]/.test(document.querySelector('.panel').textContent)", 30000)
    await js("document.querySelector('.panel .close').click()")
    step('local seeder: running, paired, QR, holding sheets')

    // Keep sheets online: closing the window hides it, the app keeps running.
    await openSettings()
    await js("document.querySelector('.panel .keep-online input').click()")
    await waitFor('setting on', "document.querySelector('.keep-online input').checked")
    await waitFor('start at login shown', "!!document.querySelector('.start-at-login input')")
    await js("document.querySelector('.start-at-login input').click()")
    await waitFor('start at login on', "document.querySelector('.start-at-login input').checked")
    await js("document.querySelector('.panel .close').click()")
    if (process.platform === 'linux') {
      const entry = fs.readFileSync(path.join(dataDir, 'autostart', 'pearsheet.desktop'), 'utf8')
      result.autostart = /^Exec=.* "--hidden"$/m.test(entry)
    } else if (process.platform === 'darwin') {
      const agent = fs.readFileSync(path.join(dataDir, 'autostart', 'com.peerloom.pearsheet.login.plist'), 'utf8')
      result.autostart = agent.includes('<string>--hidden</string>')
    } else result.autostart = true
    win.close()
    await sleep(500)
    result.keepOnline = !win.isDestroyed() && !!getTray()
    step('keep online: window hidden, tray up')

    // Profile picture: a picked image is shrunk, saved and shown, here and
    // in the share panel.
    await openSettings()
    await js(`(async () => {
      const c = document.createElement('canvas')
      c.width = 300; c.height = 200
      const g = c.getContext('2d')
      g.fillStyle = '#5b8c3a'; g.fillRect(0, 0, 300, 200)
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'me.png', { type: 'image/png' }))
      const input = document.querySelector('.panel .me input[type=file]')
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await waitFor('own picture shown', "!!document.querySelector('.panel .me-picture img.avatar') && !!document.querySelector('.me-row img.avatar')")
    result.avatar = await js("document.querySelector('.me-row img.avatar').src.startsWith('data:image/jpeg;base64,')")
    // About: version and the open-source list.
    await js("document.querySelector('.panel .about-link').click()")
    await waitFor('about', "document.querySelector('.panel').textContent.includes('Open-source software') && /Version \\d/.test(document.querySelector('.panel').textContent)")
    await js("document.querySelector('.panel .close').click()")
    await waitFor('owner picture in the sheet list', "!!document.querySelector('.sheet-link .sheet-owner img.avatar')")
    step('profile picture')

    // Share: the owner gets a single-use invite link.
    await js("document.querySelector('.toolbar .share').click()")
    await waitFor('share panel', "!!document.querySelector('.panel .invite-actions')")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Invite to edit').click()")
    await waitFor('invite link', "(document.querySelector('.invite-link input') || {}).value?.startsWith('pearsheet://join?')")
    await waitFor('invite QR', "!!document.querySelector('.invite-link .qr svg')")
    result.inviteLink = (await js("document.querySelector('.invite-link input').value")).slice(0, 24)
    await waitFor('picture in the share panel', "!!document.querySelector('.people img.avatar')")
    step('invite link')

    // Stop backing up this sheet to the local seeder, then add it back.
    await waitFor('backups listed', "[...document.querySelectorAll('.backups button')].some((b) => b.textContent.trim() === 'Stop')", 30000)
    await js("[...document.querySelectorAll('.backups button')].find((b) => b.textContent.trim() === 'Stop').click()")
    await waitFor('seeder stopped', "[...document.querySelectorAll('.backups button')].some((b) => b.textContent.trim() === 'Back up here')", 30000)
    await js("[...document.querySelectorAll('.backups button')].find((b) => b.textContent.trim() === 'Back up here').click()")
    await waitFor('seeder back', "[...document.querySelectorAll('.backups button')].some((b) => b.textContent.trim() === 'Stop')", 30000)
    result.backups = true
    step('stop and restart a backup')

    // Remove the open sheet from this device: it leaves the list.
    await js("document.querySelector('.panel .close').click()")
    result.sheetsBefore = await js("document.querySelectorAll('.sheet-link').length")
    await js("document.querySelector('.toolbar .more-button').click()")
    await waitFor('more menu', "[...document.querySelectorAll('.more-menu li')].some((l) => l.textContent.trim() === 'Delete for everyone')")
    await js("[...document.querySelectorAll('.more-menu li')].find((l) => l.textContent.trim() === 'Remove from this device').click()")
    await waitFor('confirm', "[...document.querySelectorAll('.panel button')].some((b) => b.textContent.trim() === 'Remove from this device')")
    await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.trim() === 'Remove from this device').click()")
    await waitFor('sheet removed', "!document.querySelector('.panel') && document.querySelectorAll('.sheet-link').length === " + (result.sheetsBefore - 1), 30000)
    result.sheetsAfter = await js("document.querySelectorAll('.sheet-link').length")
    step('removed from this device')

    await sleep(300)
    const shot = process.env.PEARSHEET_SMOKE_SHOT
    if (shot) {
      const image = await wc.capturePage()
      fs.writeFileSync(shot, image.toPNG())
      step('screenshot', shot)
    }
    result.ok = result.importedFormats && result.keepOnline && result.avatar && result.spill && result.quickWins && result.findSort && result.fill && result.charts && result.formats && result.csvPdf && result.tabs && result.suggested === 'SUBSTITUTE,SUBTOTAL,SUM' && result.argHelp === 'number1' && result.autostart && result.backups && result.sheetsAfter === result.sheetsBefore - 1 && result.importedFormula === '=SUM(B1:B2)' && result.exportedBytes > 1000 && result.pastedFormula === '=SUM(C1:C2)' && result.inviteLink === 'pearsheet://join?s=' + result.inviteLink.slice(19) && result.afterUndo === '1650.5' && result.grid.B3 === '1650.5' && result.grid.A1 === 'Rent' && result.formulaBar === '=SUM(B1:B2)'
  } catch (err) {
    result.error = err.message
    // What the page showed, to tell a UI failure from a load failure.
    result.page = await js("(document.body && document.body.innerText || '').slice(0, 600) + ' | url=' + location.href").catch((e) => 'unreadable: ' + e.message)
    result.cells = await js("[...document.querySelectorAll('.cell')].filter((c) => c.textContent).map((c) => c.style.top + '/' + c.style.left + '=' + c.textContent)").catch(() => null)
  }
  console.log('SMOKE_RESULT ' + JSON.stringify(result))
  app.quit()
}

module.exports = { run }
