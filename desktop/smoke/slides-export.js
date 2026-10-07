// Smoke test part "slides-export": a deck with a title, a shape, a picture
// and a second slide, saved from the More menu as PDF (one page per slide,
// 13.333 x 7.5 in) and as PowerPoint (read back with jszip: two slides, the
// title's text, the shape and the picture).
//
// PEAROFFICE_SMOKE_EXPORT_SHOTS=<folder> saves a screenshot of the first
// slide and copies of the two files there.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const JSZip = require('jszip')

module.exports = async function slidesExport (t) {
  await t.js("window.__slideErrors = []; window.addEventListener('error', (e) => window.__slideErrors.push(String(e.message)))")
  try {
    return await run(t)
  } catch (err) {
    const errors = await t.js('window.__slideErrors').catch(() => null)
    throw new Error(err.message + (errors && errors.length ? ' (page errors: ' + errors.slice(0, 3).join(' | ') + ')' : ''))
  }
}

// A new file with this extension in `dir`, once it has stopped growing.
async function newFile (dir, ext, before, sleep, timeout = 20000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sleep(200)) {
    const name = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith(ext) && !before.includes(f))
    if (!name) continue
    const file = path.join(dir, name)
    const size = fs.statSync(file).size
    await sleep(300)
    if (size > 0 && fs.statSync(file).size === size) return file
  }
  return null
}

// Pages and page size in points, from pdfinfo, or by counting page objects.
function pdfPages (file) {
  try {
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
    const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)
    return { pages: Number(/Pages:\s+(\d+)/.exec(info)[1]), size: size ? Math.round(size[1]) + 'x' + Math.round(size[2]) : '' }
  } catch {
    const text = fs.readFileSync(file).toString('latin1')
    return { pages: (text.match(/\/Type\s*\/Page(?!s)/g) || []).length, size: '' }
  }
}

async function run (t) {
  const { wc, js, step, waitFor, type, key, more, downloads, dataDir, result, sleep } = t
  const shots = process.env.PEAROFFICE_SMOKE_EXPORT_SHOTS
  const count = "document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]').length"
  const centre = async (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const click = (p, clickCount = 1) => {
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount })
  }

  // A deck with a title, a rectangle and a picture on its first slide.
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-slides:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-slides').click()")
  await waitFor('slides editor', `!!document.querySelector('.slides .slide-stage .slide') && ${count} === 1`)
  if (shots) await js("document.documentElement.dataset.theme = 'light'")
  const title = await centre('.slide-stage .slide-el[data-role=title]')
  click(title)
  click(title, 2)
  await waitFor('title editor', "document.activeElement && document.activeElement.matches('.slide-el[data-role=title] .ProseMirror')")
  await type('Export smoke', 20)
  await key('Escape')
  await waitFor('title typed', "(document.querySelector('.slide-stage .slide-el[data-role=title] .slide-static') || {}).textContent === 'Export smoke'")

  await js("document.querySelector('.slides-tools .add-shape').click()")
  await waitFor('shape menu', "!!document.querySelector('.shape-menu .shape-rect')")
  await js("document.querySelector('.shape-menu .shape-rect').click()")
  await waitFor('rectangle', "!!document.querySelector('.slide-stage .slide-el[data-type=shape] svg[data-shape=rect]')")
  await key('Escape')

  await js(`(async () => {
    const c = document.createElement('canvas')
    c.width = 320; c.height = 160
    const g = c.getContext('2d')
    g.fillStyle = '#3b6e22'; g.fillRect(0, 0, 320, 160)
    g.fillStyle = '#f0c040'; g.fillRect(40, 40, 120, 80)
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'box.png', { type: 'image/png' }))
    const input = document.querySelector('.slides-tools .slide-picture-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('picture shown', "(() => { const i = document.querySelector('.slide-stage .slide-el[data-type=picture] img.slide-picture'); return !!i && i.complete && i.naturalWidth === 320 })()")
  const deckId = await js("window.pearoffice.call('sheet:list', {}).then((l) => l.find((x) => x.kind === 'slides').sheetId)")
  await waitFor('picture stored', `window.pearoffice.call('slides:picture', { sheetId: ${JSON.stringify(deckId)}, ref: document.querySelector('.slide-stage .slide-el[data-type=picture] img').dataset.ref }).then(() => true, () => false)`)
  await key('Escape')
  if (shots) {
    await sleep(400)
    fs.mkdirSync(shots, { recursive: true })
    const r = await js("(() => { const r = document.querySelector('.slide-stage .slide-holder').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } })()")
    fs.writeFileSync(path.join(shots, 'export-app-slide1.png'), (await wc.capturePage(r)).toPNG())
  }

  // A second slide, with its title typed.
  await js("document.querySelector('.slide-add .add-slide').click()")
  await waitFor('second slide', `${count} === 2 && !!document.querySelector('.slide-stage .slide-el[data-role=title]')`)
  const title2 = await centre('.slide-stage .slide-el[data-role=title]')
  click(title2)
  click(title2, 2)
  await waitFor('title 2 editor', "document.activeElement && document.activeElement.matches('.slide-el[data-role=title] .ProseMirror')")
  await type('Second page', 20)
  await key('Escape')
  await waitFor('title 2 typed', "(document.querySelector('.slide-stage .slide-el[data-role=title] .slide-static') || {}).textContent === 'Second page'")
  step('deck made')

  // The menu names the three ways out.
  await js("document.querySelector('.toolbar .more-button').click()")
  await waitFor('more menu', "!!document.querySelector('.more-menu li')")
  const items = await js("[...document.querySelectorAll('.more-menu li')].map((l) => l.textContent).join('|')")
  await js("document.querySelector('.toolbar .more-button').click()")
  result.exportMenu = ['Save as a PowerPoint file', 'Save as PDF', 'Print...'].every((s) => items.split('|').includes(s))
  if (!result.exportMenu) throw new Error('more menu: ' + items)

  // PDF: saved without a dialog in the data folder.
  const pdfBefore = fs.readdirSync(dataDir)
  const t0 = Date.now()
  await more('Save as PDF')
  const pdf = await newFile(dataDir, '.pdf', pdfBefore, sleep)
  if (!pdf) throw new Error('no PDF saved')
  const pdfMs = Date.now() - t0
  const pdfBytes = fs.readFileSync(pdf)
  const info = pdfPages(pdf)
  result.exportPdf = pdfBytes.slice(0, 4).toString() === '%PDF' && info.pages === 2 && (info.size === '' || info.size === '960x540')
  if (!result.exportPdf) throw new Error('PDF: ' + JSON.stringify({ bytes: pdfBytes.length, ...info }))
  step('PDF saved: ' + info.pages + ' pages, ' + (info.size || 'size unknown') + ' pt, ' + pdfMs + ' ms')

  // PowerPoint: a download.
  const pptBefore = fs.existsSync(downloads) ? fs.readdirSync(downloads) : []
  const t1 = Date.now()
  await more('Save as a PowerPoint file')
  const pptx = await newFile(downloads, '.pptx', pptBefore, sleep)
  if (!pptx) throw new Error('no .pptx saved')
  const pptMs = Date.now() - t1
  const zip = await JSZip.loadAsync(fs.readFileSync(pptx))
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort()
  const s1 = zip.file('ppt/slides/slide1.xml') ? await zip.file('ppt/slides/slide1.xml').async('string') : ''
  const s2 = zip.file('ppt/slides/slide2.xml') ? await zip.file('ppt/slides/slide2.xml').async('string') : ''
  const checks = {
    slides: slides.length === 2,
    title: s1.includes('<a:t>Export smoke</a:t>'),
    shape: s1.includes('prst="rect"'),
    picture: s1.includes('<p:pic>') && Object.keys(zip.files).some((n) => n.startsWith('ppt/media/')),
    second: s2.includes('<a:t>Second page</a:t>')
  }
  result.exportPptx = Object.values(checks).every(Boolean)
  if (!result.exportPptx) throw new Error('pptx: ' + JSON.stringify(checks))
  step('PowerPoint saved: ' + slides.length + ' slides, ' + pptMs + ' ms')

  if (shots) {
    fs.copyFileSync(pdf, path.join(shots, 'export-app.pdf'))
    fs.copyFileSync(pptx, path.join(shots, 'export-app.pptx'))
  }
  return true
}
