// Store and website screenshots of the desktop app (not a test; not in the
// default parts). Links this device to Nick, who owns the community garden
// files scripts/store-shots/demo.js serves, then saves one PNG per scene.
//
//   PEAROFFICE_SHOTS_LINK_URL  where demo.js hands out device links
//                              (default http://127.0.0.1:8799/link)
//   PEAROFFICE_SHOTS_OUT       folder for the PNGs
//
// Run by scripts/store-shots/desktop.sh. The window is 1440 x 900 and the
// theme light.

const fs = require('node:fs')
const path = require('node:path')
const { nativeTheme } = require('electron')

const TITLES = { sheet: 'Garden budget 2026', doc: 'Planting plan', slides: 'October meeting' }

module.exports = async function storeShots (t) {
  const { js, step, waitFor, win, wc, sleep, key } = t
  const out = process.env.PEAROFFICE_SHOTS_OUT
  fs.mkdirSync(out, { recursive: true })
  const save = async (name) => {
    await waitFor('no notice', "!document.querySelector('.toast')", 15000)
    await sleep(800)
    fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG())
    step(name)
  }

  nativeTheme.themeSource = 'light'
  win.setContentSize(1440, 900)
  await js("localStorage.setItem('pearoffice:theme', 'light'); document.documentElement.dataset.theme = 'light'; window.dispatchEvent(new CustomEvent('pearoffice:theme')); true")
  // Become Nick: link to Nick's engine as the Devices panel does
  // (takeIdentity.js), which restarts with Nick's identity and files.
  const link = await (await fetch(process.env.PEAROFFICE_SHOTS_LINK_URL || 'http://127.0.0.1:8799/link')).text()
  const reloaded = new Promise((resolve) => wc.once('did-finish-load', resolve))
  await js(`(async () => {
    const r = await window.pearoffice.call('link:join', { link: ${JSON.stringify(link)}, replace: true })
    if (r && r.restart) { await window.pearoffice.call('app:onboarded'); window.__pearRestarting = true; window.pearoffice.call('app:restart') }
    return true
  })()`)
  await reloaded
  await waitFor('restarted', "!!document.querySelector('.new-sheet')", 60000)
  step('linked')
  const listed = (title) => `[...document.querySelectorAll('.sidebar .sheet-link')].some((b) => b.textContent.includes(${JSON.stringify(title)}) && !b.classList.contains('joining') && !b.classList.contains('waiting'))`
  for (const title of Object.values(TITLES)) await waitFor('joined ' + title, listed(title), 180000)
  // This device writes to the files once one of Nick's others adds it. Wait
  // for that, so no shot catches a "not writable" message.
  await waitFor('writable', `(async () => {
    const list = await window.pearoffice.call('sheet:list')
    for (const f of list) {
      const s = f.kind === 'doc' ? await window.pearoffice.call('doc:state', { sheetId: f.sheetId, withState: false })
        : f.kind === 'slides' ? await window.pearoffice.call('slides:state', { sheetId: f.sheetId, withState: false })
          : await window.pearoffice.call('sheet:view', { sheetId: f.sheetId })
      if (!s.writable) return false
    }
    return list.length >= 3
  })()`, 120000)
  step('joined')

  const open = async (title) => js(`[...document.querySelectorAll('.sidebar .sheet-link')].find((b) => b.textContent.includes(${JSON.stringify(title)})).click()`)

  // 1. The file list, with who is in each file.
  await js("document.querySelector('.sidebar .sheet-link.all-files').click()")
  await waitFor('file list', "document.querySelectorAll('.file-card, .file-row, .files li').length >= 3 || document.body.innerText.includes('Members meeting')")
  await save('01-files.png')

  // 2. The budget: formulas, a chart and Satoshi on a cell.
  await open(TITLES.sheet)
  await waitFor('grid', "!!document.querySelector('.grid .body') && document.body.innerText.includes('Raised bed lumber')")
  await waitFor('chart', "!!document.querySelector('.chart-frame svg')", 30000)
  // The total's cell, so the formula bar shows =SUM.
  await js("document.querySelector('.grid .body').focus()")
  for (let i = 0; i < 12; i++) await key('Down')
  for (let i = 0; i < 2; i++) await key('Right')
  await save('02-sheet.png')

  // 3. The planting plan.
  await open(TITLES.doc)
  await waitFor('document', "!!document.querySelector('.doc-body') && document.querySelector('.doc-body').innerText.includes('Who looks after which bed')")
  await save('03-document.png')

  // 4. The deck, on the chart slide where Hal is.
  await open(TITLES.slides)
  await waitFor('deck', "document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]').length >= 4")
  await js("document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]')[2].click()")
  await waitFor('chart slide', "!!document.querySelector('.slide-stage .slide-el[data-type=chart] svg')", 30000)
  await save('04-slides.png')

  // 5. Sharing the deck: invite links and the people in it.
  await js("document.querySelector('button.share').click()")
  await waitFor('share panel', "!!document.querySelector('.panel[role=dialog]') && document.querySelector('.panel[role=dialog]').innerText.includes('Hal')")
  await js("[...document.querySelectorAll('.panel button')].find((b) => b.textContent.includes('Invite to edit')).click()")
  await waitFor('invite link', "!!document.querySelector('.panel input[aria-label=\"Invite link\"]')")
  await save('05-sharing.png')
  return true
}
