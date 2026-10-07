// Smoke test part "slides-charts" (proposals/2026-10-06-slides-followups.md,
// "Charts"): Insert chart adds a column chart drawn as SVG bars in the
// theme's accents; the type changes to pie and line and back; Edit data
// changes a value and a series name and the drawing follows; title,
// stacked and values on the chart; the slide duplicated with its chart; the
// show draws it; the deck reopened keeps it; then as a line chart with smooth
// lines and white text, kept after reopening again.
//
// PEAROFFICE_SMOKE_CHART_SHOTS=<folder> saves a screenshot of the slide
// with each chart type in the Plain and Midnight themes, one of the chart
// tools and one of the data panel there.

const fs = require('node:fs')
const path = require('node:path')

module.exports = async function slidesCharts (t) {
  await t.js("window.__slideErrors = []; window.addEventListener('error', (e) => window.__slideErrors.push(String(e.message)))")
  try {
    return await run(t)
  } catch (err) {
    const errors = await t.js('window.__slideErrors').catch(() => null)
    throw new Error(err.message + (errors && errors.length ? ' (page errors: ' + errors.slice(0, 3).join(' | ') + ')' : ''))
  }
}

const TYPES = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'radar']
const ACCENT1 = '#5b8c3a' // Plain's first accent (themes.js)
const ACCENT2 = '#2f7d8c'

async function run (t) {
  const { wc, js, step, waitFor, type, key, sendMod, result, sleep } = t
  const shots = process.env.PEAROFFICE_SMOKE_CHART_SHOTS
  const count = "document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]').length"
  const svg = (root = '.slide-stage') => `document.querySelector('${root} .slide-el[data-type=chart] .slide-chart svg')`
  const markup = () => js(`(${svg()} || {}).outerHTML || ''`)
  const texts = (root) => js(`[...(${svg(root)} || document.createElement('svg')).querySelectorAll('text')].map((x) => x.textContent)`)
  // Bars, slices and other data marks: ECharts tags them with their series.
  const marks = (fill) => js(`[...(${svg()} || document.createElement('svg')).querySelectorAll('path[ecmeta_ssr_type=chart]')].filter((p) => ${fill ? `p.getAttribute('fill') === '${fill}'` : 'true'}).length`)
  const pick = (sel, value) => js(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  const shot = async (name, crop) => {
    if (!shots) return
    await sleep(300)
    fs.mkdirSync(shots, { recursive: true })
    const r = crop ? await js(`(() => { const b = document.querySelector(${JSON.stringify(crop)}).getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) } })()`) : undefined
    fs.writeFileSync(path.join(shots, name + '.png'), (await wc.capturePage(r)).toPNG())
  }
  const click = (p) => {
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  }
  const centre = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const setType = async (id) => {
    await js("document.querySelector('.slides-tools .chart-type').click()")
    await waitFor('chart type menu', `!!document.querySelector('.chart-type-menu .chart-type-${id}')`)
    await js(`document.querySelector('.chart-type-menu .chart-type-${id}').click()`)
    await waitFor('chart type ' + id, `(document.querySelector('.slide-stage .slide-chart') || {}).dataset?.chartType === '${id}' && !!${svg()}`)
  }

  // A blank deck.
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-slides:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-slides').click()")
  await waitFor('slides editor', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 1`)
  if (shots) await js("document.documentElement.dataset.theme = 'light'")
  await pick('.slides-tools .layout-select', 'blank')
  await waitFor('blank slide', "document.querySelectorAll('.slide-stage .slide-el').length === 0")
  step('deck created')

  // Insert chart: three categories, two series, drawn as six bars in the
  // first two accents.
  await js("document.querySelector('.slides-tools .add-chart').click()")
  await waitFor('chart drawn', `!!${svg()} && !!document.querySelector('.slides-tools .chart-type')`)
  result.chartsInsert = (await marks(ACCENT1)) === 3 && (await marks(ACCENT2)) === 3
  if (!result.chartsInsert) throw new Error('bars: ' + (await marks()) + ' ' + (await markup()).slice(0, 400))
  await shot('chart-tools', '.slides-tools')
  step('chart inserted')

  // Every type draws; pie has three slices.
  const drawn = {}
  for (const id of [...TYPES.slice(1), 'column']) {
    const before = await markup()
    await setType(id)
    const after = await markup()
    drawn[id] = after !== before && (await marks()) > 0
    if (id === 'pie') drawn[id] = drawn[id] && (await marks()) === 3
    if (shots) {
      await js("document.querySelector('.slide-stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
      await shot('plain-' + id, '.slide-stage .slide')
      click(await centre('.slide-stage .slide-el[data-type=chart]'))
      await waitFor('chart selected', "!!document.querySelector('.slides-tools .chart-type')")
    }
  }
  result.chartsTypes = TYPES.slice(1).every((id) => drawn[id])
  if (!result.chartsTypes) throw new Error('types drawn: ' + JSON.stringify(drawn))
  step('types')

  // Edit data: the first value and the first series' name. The drawing
  // changes once typing stops.
  await js("document.querySelector('.slides-tools .chart-edit-data').click()")
  await waitFor('data panel', "!!document.querySelector('.chart-data-panel .chart-data input.value[data-row=\"0\"][data-series=\"0\"]')")
  result.chartsGrid = await js("[...document.querySelectorAll('.chart-data input.cat')].map((i) => i.value).join(',') === 'First,Second,Third' && [...document.querySelectorAll('.chart-data input.series-name')].map((i) => i.value).join(',') === 'Series 1,Series 2'")
  await js("(() => { const i = document.querySelector('.chart-data input.value[data-row=\"0\"][data-series=\"0\"]'); i.focus(); i.select() })()")
  await type('40', 30)
  await js("(() => { const i = document.querySelector('.chart-data input.series-name[data-series=\"0\"]'); i.focus(); i.select() })()")
  await type('Apples', 30)
  await waitFor('drawing follows the data', "(() => { const t = [...document.querySelectorAll('.slide-stage .slide-chart svg text')].map((x) => x.textContent); return t.includes('Apples') && t.includes('40') })()", 5000)
  await shot('data-panel')
  // Add a row: a fourth category with no values yet.
  await js("document.querySelector('.chart-data-panel .add-row').click()")
  await waitFor('row added', "document.querySelectorAll('.chart-data input.cat').length === 4")
  await js("(() => { const i = document.querySelector('.chart-data input.cat[data-row=\"3\"]'); i.focus() })()")
  await type('Fourth', 30)
  await waitFor('fourth category drawn', `(${svg()} ? [...${svg()}.querySelectorAll('text')].map((x) => x.textContent) : []).includes('Fourth')`, 5000)
  await key('Escape')
  await waitFor('data panel closed', "!document.querySelector('.chart-data-panel')")
  result.chartsData = result.chartsGrid
  step('data edited')

  // Title, stacked and values on the chart.
  await js("(() => { const i = document.querySelector('.slides-tools .chart-title-input'); i.focus(); i.select() })()")
  await type('Fruit sales', 30)
  await key('Return')
  await waitFor('title drawn', `(${svg()} ? [...${svg()}.querySelectorAll('text')].map((x) => x.textContent) : []).includes('Fruit sales')`)
  const textCount = (await texts()).length
  const unstacked = await markup()
  await js("document.querySelector('.slides-tools .chart-stacked').click()")
  await waitFor('stacked', `document.querySelector('.slides-tools .chart-stacked').classList.contains('on') && ${svg()}.outerHTML !== ${JSON.stringify(unstacked)}`)
  await js("document.querySelector('.slides-tools .chart-labels').click()")
  await waitFor('values shown', `document.querySelector('.slides-tools .chart-labels').classList.contains('on') && ${svg()}.querySelectorAll('text').length > ${textCount}`)
  await pick('.slides-tools .chart-legend', 'right')
  await waitFor('legend on the right', `!!${svg()}`)
  result.chartsSettings = true
  step('title, stacked, values, legend')

  // The thumbnail draws the chart too.
  await waitFor('thumbnail chart', "[...document.querySelectorAll('.slide-thumb .thumb .slide-chart svg text')].some((x) => x.textContent === 'Fruit sales')")

  // The two themes for screenshots: each type on Midnight.
  if (shots) {
    await pick('.slides-tools .theme-select', 'midnight')
    for (const id of TYPES) {
      click(await centre('.slide-stage .slide-el[data-type=chart]'))
      await waitFor('chart selected', "!!document.querySelector('.slides-tools .chart-type')")
      await setType(id)
      await js("document.querySelector('.slide-stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
      await shot('midnight-' + id, '.slide-stage .slide')
    }
    click(await centre('.slide-stage .slide-el[data-type=chart]'))
    await waitFor('chart selected', "!!document.querySelector('.slides-tools .chart-type')")
    await setType('column')
    await pick('.slides-tools .theme-select', 'plain')
  }

  // Duplicate the slide: the copy has the chart.
  const firstSlide = await js("document.querySelector('.slide-thumb.current').dataset.id")
  await js("document.querySelector('.slide-thumbs').focus()")
  await sendMod('D', ['control'])
  await waitFor('duplicated', `${count} === 2 && document.querySelector('.slide-thumb.current').dataset.id !== ${JSON.stringify(firstSlide)}`)
  await waitFor('copy has the chart', `(${svg()} ? [...${svg()}.querySelectorAll('text')].map((x) => x.textContent) : []).includes('Fruit sales')`)
  result.chartsDuplicate = true
  step('slide duplicated')

  // The show draws it.
  process.env.PEAROFFICE_FAKE_DISPLAYS = '1'
  await js("document.querySelector('.present-button').click()")
  await waitFor('show', `(${svg('.show')} ? [...${svg('.show')}.querySelectorAll('text')].map((x) => x.textContent) : []).includes('Apples')`)
  result.chartsShow = true
  await key('Escape')
  await waitFor('show ended', "!document.querySelector('.show')")
  step('show')

  // Reopen: the chart keeps its type, data and settings.
  await sleep(700)
  await js("document.querySelector('.sheet-link.all-files').click()")
  await waitFor('deck in all files', "[...document.querySelectorAll('.file-card')].some((c) => !!c.querySelector('.kind-icon.kind-slides'))")
  await js("[...document.querySelectorAll('.file-card')].find((c) => !!c.querySelector('.kind-icon.kind-slides')).click()")
  await waitFor('deck reopened', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 2`)
  await js(`document.querySelector('.slide-thumb[data-id="${firstSlide}"]').click()`)
  await waitFor('chart again', `!!${svg()}`)
  const back = await texts()
  result.chartsPersisted = ['Fruit sales', 'Apples', '40', 'Fourth'].every((x) => back.includes(x)) && (await js("document.querySelector('.slide-stage .slide-chart').dataset.chartType")) === 'column'
  if (!result.chartsPersisted) throw new Error('not kept after reopening: ' + JSON.stringify(back))
  step('deck reopened')

  // White text and smooth lines on a line chart, kept after reopening.
  click(await centre('.slide-stage .slide-el[data-type=chart]'))
  await waitFor('chart selected again', "!!document.querySelector('.slides-tools .chart-type')")
  result.chartsNoSmoothOnColumn = await js("!document.querySelector('.slides-tools .chart-smooth')")
  await setType('line')
  const straight = await markup()
  await waitFor('smooth button', "!!document.querySelector('.slides-tools .chart-smooth')")
  await js("document.querySelector('.slides-tools .chart-smooth').click()")
  // ECharts draws a smooth line with curves (C in the path).
  const curved = `[...${svg()}.querySelectorAll('path')].some((p) => /C/.test(p.getAttribute('d') || '') && p.getAttribute('fill') === 'none')`
  await waitFor('smooth lines', `document.querySelector('.slides-tools .chart-smooth').classList.contains('on') && ${svg()}.outerHTML !== ${JSON.stringify(straight)} && ${curved}`)
  await js("document.querySelector('.slides-tools .chart-text').click()")
  await waitFor('text colour menu', "!!document.querySelector('.chart-text-palette .swatch[title=\"#ffffff\"]')")
  await js("document.querySelector('.chart-text-palette .swatch[title=\"#ffffff\"]').click()")
  // Every label is white: the title, the axes and the legend.
  const white = `(() => { const t = [...${svg()}.querySelectorAll('text')]; return t.length > 4 && t.every((x) => /^(#fff|#ffffff|rgb\\(255, ?255, ?255\\))$/i.test(x.getAttribute('fill') || '')) })()`
  await waitFor('white text', white)
  if (shots) {
    await pick('.slides-tools .theme-select', 'midnight')
    await js("document.querySelector('.slide-stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
    await shot('smooth-white', '.slide-stage .slide')
    await pick('.slides-tools .theme-select', 'plain')
  }
  await sleep(700)
  await js("document.querySelector('.sheet-link.all-files').click()")
  await waitFor('deck in all files again', "[...document.querySelectorAll('.file-card')].some((c) => !!c.querySelector('.kind-icon.kind-slides'))")
  await js("[...document.querySelectorAll('.file-card')].find((c) => !!c.querySelector('.kind-icon.kind-slides')).click()")
  await waitFor('deck reopened again', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 2`)
  await js(`document.querySelector('.slide-thumb[data-id="${firstSlide}"]').click()`)
  await waitFor('line chart again', `(document.querySelector('.slide-stage .slide-chart') || {}).dataset?.chartType === 'line' && !!${svg()}`)
  result.chartsSmoothText = await js(`${curved} && ${white}`)
  if (!result.chartsSmoothText) throw new Error('smooth lines or white text not kept: ' + (await markup()).slice(0, 600))
  step('smooth lines and text colour')

  return result.chartsNoSmoothOnColumn && result.chartsSmoothText && result.chartsInsert && result.chartsTypes && result.chartsData && result.chartsSettings && result.chartsDuplicate && result.chartsShow && result.chartsPersisted
}
