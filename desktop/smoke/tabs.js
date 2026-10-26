// Smoke test part "tabs": files in tabs (proposals/2026-10-26-tabs.md).
// Three files opened into tabs, switching by click, Ctrl+Tab and Ctrl+number,
// a sheet keeping its selected cell and undo while hidden, Ctrl+W and a
// middle click closing tabs, All files and back, Open in new window from a
// tab, a removed file's tab closing and the tabs back after a reload.
// PEAROFFICE_SMOKE_TABS_SHOT=<png> saves the three tabs.

const { BrowserWindow } = require('electron')

module.exports = async function tabs (t) {
  const { js, wc, step, waitFor, type, key, sendMod, result, sleep, win } = t
  const ask = (method, args = {}) => js('window.pearoffice.call(' + JSON.stringify(method) + ', ' + JSON.stringify(args) + ')')
  const titles = "[...document.querySelectorAll('.file-tabs .file-tab .file-tab-title')].map((x) => x.textContent).join('|')"
  const shown = "(document.querySelector('.file-tabs .file-tab.on .file-tab-title') || {}).textContent"
  const side = (title) => js(`[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes(${JSON.stringify(title)})).click()`)
  const tab = (title) => `[...document.querySelectorAll('.file-tabs .file-tab')].find((x) => x.querySelector('.file-tab-title').textContent === ${JSON.stringify(title)})`
  const address = "(document.querySelector('.formula-bar .address') || {}).textContent"

  await ask('sheet:create', { title: 'Alpha' })
  await ask('doc:create', { title: 'Beta' })
  await ask('slides:create', { title: 'Gamma' })
  await waitFor('side list', "[...document.querySelectorAll('.sheet-link')].filter((b) => /Alpha|Beta|Gamma/.test(b.textContent)).length === 3")

  // One file: no tab row. Three: three tabs.
  await side('Alpha')
  await waitFor('Alpha open', "!!document.querySelector('.grid')")
  if (await js("!!document.querySelector('.file-tabs')")) throw new Error('a tab row with one file open')
  await side('Beta')
  await waitFor('Beta open', `!!document.querySelector('.doc-body') && ${titles} === 'Alpha|Beta' && ${shown} === 'Beta'`)
  await side('Gamma')
  await waitFor('Gamma open', `!!document.querySelector('.slide-stage') && ${titles} === 'Alpha|Beta|Gamma' && ${shown} === 'Gamma'`)
  await t.shot('PEAROFFICE_SMOKE_TABS_SHOT', 300)
  result.opened = true
  step('three tabs')

  // Switching, and a sheet keeping its selected cell and undo while hidden.
  await js(`${tab('Alpha')}.click()`)
  await waitFor('Alpha shown', `${shown} === 'Alpha' && !!document.querySelector('.grid') && !document.querySelector('.doc-body')`)
  await js("document.querySelector('.grid .body').focus()")
  await type('x')
  await key('Return')
  const a1 = "(([...document.querySelectorAll('.grid .cell[data-r=\"1\"][data-c=\"1\"]')][0] || {}).textContent || '')"
  await waitFor('typed in A1', `${address} === 'A2' && ${a1} === 'x'`)
  await sendMod('Tab', ['control'])
  await waitFor('Ctrl+Tab to Beta', `${shown} === 'Beta' && !!document.querySelector('.doc-body')`)
  await sendMod('3', ['control'])
  await waitFor('Ctrl+3 to Gamma', `${shown} === 'Gamma' && !!document.querySelector('.slide-stage')`)
  await sendMod('Tab', ['control', 'shift'])
  await waitFor('Ctrl+Shift+Tab to Beta', `${shown} === 'Beta'`)
  await sendMod('1', ['control'])
  await waitFor('Ctrl+1 to Alpha, still on A2', `${shown} === 'Alpha' && ${address} === 'A2'`)
  await js("document.querySelector('.grid .body').focus()")
  await sendMod('Z', ['control'])
  await waitFor('undo kept', `${a1} === ''`)
  result.switching = true
  step('switching keeps state')

  // Ctrl+W closes the shown tab and shows its neighbour; a middle click closes one.
  await sendMod('W', ['control'])
  await waitFor('Alpha closed', `${titles} === 'Beta|Gamma' && ${shown} === 'Beta'`)
  await js(`${tab('Gamma')}.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))`)
  await waitFor('Gamma closed, no row', "!document.querySelector('.file-tabs') && !!document.querySelector('.doc-body')")
  result.closing = true
  step('closing')

  // All files keeps the tabs.
  await side('Alpha')
  await waitFor('two again', `${titles} === 'Beta|Alpha'`)
  await js("document.querySelector('.sheet-link.all-files').click()")
  await waitFor('file list, tabs kept', `!!document.querySelector('.file-cell') && ${titles} === 'Beta|Alpha' && !document.querySelector('.file-tabs .file-tab.on')`)
  await js(`${tab('Beta')}.click()`)
  await waitFor('back to Beta', `${shown} === 'Beta' && !!document.querySelector('.doc-body')`)
  result.home = true
  step('all files and back')

  // Open in new window from a tab's menu: the tab goes.
  await js(`(() => { const el = ${tab('Alpha')}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 })) })()`)
  await waitFor('tab menu', "!!document.querySelector('.tab-menu .open-window')")
  await js("document.querySelector('.tab-menu .open-window').click()")
  const alphaWindow = () => BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed() && /[?&]file=/.test(w.webContents.getURL()))
  for (let i = 0; i < 100 && !alphaWindow(); i++) await sleep(100)
  if (!alphaWindow()) throw new Error('no window for Alpha')
  await waitFor('Alpha tab gone', '!document.querySelector(\'.file-tabs\')')
  alphaWindow().close()
  result.window = true
  step('tab to its own window')

  // A removed file's tab closes; the tabs come back after a reload.
  const delta = (await ask('sheet:create', { title: 'Delta' })).sheetId
  await waitFor('Delta listed', "[...document.querySelectorAll('.sheet-link')].some((b) => b.textContent.includes('Delta'))")
  await side('Delta')
  await side('Gamma')
  await waitFor('Beta, Delta, Gamma', `${titles} === 'Beta|Delta|Gamma' && ${shown} === 'Gamma'`)
  await ask('sheet:removeLocal', { sheetId: delta })
  await waitFor('Delta tab closed', `${titles} === 'Beta|Gamma' && ${shown} === 'Gamma'`)
  await sleep(300)
  wc.reload()
  await new Promise((resolve) => wc.once('did-finish-load', resolve))
  await waitFor('tabs back', `${titles} === 'Beta|Gamma' && ${shown} === 'Gamma' && !!document.querySelector('.slide-stage')`)
  result.restart = true
  step('removed and reloaded')

  return result.opened && result.switching && result.closing && result.home && result.window && result.restart
}
