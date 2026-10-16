// Smoke test part "folders" (proposals/2026-10-10-folders.md): New folder,
// Move to folder from a card and from the file's own menu, opening a folder,
// New inside it, dragging a file in and back out, the side list, renaming,
// reopening and deleting a folder (its files stay), then a file removed
// from its right-click menu.

const fs = require('node:fs')
const path = require('node:path')

module.exports = async function folders (t) {
  const { js, step, waitFor, type, more, newSheet, wc, result, sleep } = t
  // With PEAROFFICE_SMOKE_FOLDERS_SHOTS=<folder>: a screenshot of each screen.
  const shots = process.env.PEAROFFICE_SMOKE_FOLDERS_SHOTS
  const snap = async (name) => {
    if (!shots) return
    await sleep(300)
    fs.mkdirSync(shots, { recursive: true })
    fs.writeFileSync(path.join(shots, name + '.png'), (await wc.capturePage()).toPNG())
  }
  const places = "window.pearoffice.call('file:folders')"
  const home = async () => {
    await js("document.querySelector('.sheet-link.all-files').click()")
    await waitFor('the start screen', "!!document.querySelector('.files-home')")
  }
  const cardOf = (title) => `[...document.querySelectorAll('.file-cell')].find((c) => (c.querySelector('.file-title') || {}).textContent === ${JSON.stringify(title)})`
  const rename = async (title) => js(`(() => {
    const el = document.querySelector('.toolbar .title')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus(); set.call(el, ${JSON.stringify(title)}); el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })()`)
  // A drag from one element to another, as the page sees it.
  const drag = (from, to) => js(`(() => {
    const dt = new DataTransfer();
    (${from}).dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }))
    const target = ${to}
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })()`)

  // Two files at the top level.
  await newSheet()
  await rename('Seeds')
  await waitFor('Seeds in the list', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent === 'Seeds')")
  await newSheet()
  await rename('Tools')
  await waitFor('Tools in the list', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent === 'Tools')")
  await home()

  // New folder.
  await js("document.querySelector('.new-folder-card').click()")
  await waitFor('name panel', "document.activeElement === document.querySelector('.panel.folder-name input')")
  await type('Garden')
  await js("document.querySelector('.panel.folder-name .primary').click()")
  await waitFor('Garden card', "[...document.querySelectorAll('.folder-card .file-title')].some((x) => x.textContent === 'Garden')")
  await waitFor('empty', "document.querySelector('.folder-card .file-meta').textContent === 'Empty'")
  step('new folder')

  // Move to folder from a card's menu.
  await js(`${cardOf('Seeds')}.querySelector('.card-more').click()`)
  await waitFor('card menu', "!!document.querySelector('.card-menu li')")
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'Move to folder...').click()")
  await waitFor('move panel', "[...document.querySelectorAll('.move-folder .folder-choice-name')].some((x) => x.textContent === 'Garden')")
  await snap('move-panel')
  await js("[...document.querySelectorAll('.move-folder .folder-choice')].find((b) => b.textContent.includes('Garden')).click()")
  await waitFor('Seeds filed', `!document.querySelector('.move-folder') && !${cardOf('Seeds')} && document.querySelector('.folder-card .file-meta').textContent === '1 file'`)
  result.folderMove = true
  await snap('home')
  step('moved from the card')

  // Open the folder; New inside it lands there.
  await js("document.querySelector('.folder-card').click()")
  await waitFor('inside Garden', "document.querySelector('.folder-head h1').textContent.trim() === 'Garden' && !!" + cardOf('Seeds'))
  await js("document.querySelector('.files-home .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-doc')")
  await js("document.querySelector('.kind-choice.kind-doc').click()")
  await waitFor('doc editor', "!!document.querySelector('.doc-body')")
  await rename('Plan')
  await waitFor('two files in Garden', `${places}.then((f) => Object.keys(f.places).length === 2)`)
  result.folderNewInside = true
  step('new inside a folder')

  // Move to folder from the open file's own menu.
  await js("[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes('Tools')).click()")
  await waitFor('Tools open', "!!document.querySelector('.grid .body')")
  await more('Move to folder...')
  await waitFor('move panel', "[...document.querySelectorAll('.move-folder .folder-choice-name')].some((x) => x.textContent === 'Garden')")
  await js("[...document.querySelectorAll('.move-folder .folder-choice')].find((b) => b.textContent.includes('Garden')).click()")
  await waitFor('three in Garden', `${places}.then((f) => Object.keys(f.places).length === 3)`)
  result.folderMenuMove = true
  step('moved from the file menu')

  // Drag out of the folder to Your files, then back onto the folder.
  await home()
  await js("document.querySelector('.folder-card').click()")
  await waitFor('inside Garden', `!!${cardOf('Tools')}`)
  await drag(cardOf('Tools'), "document.querySelector('.folder-back')")
  await waitFor('Tools out', `${places}.then((f) => Object.keys(f.places).length === 2)`)
  await js("document.querySelector('.folder-back').click()")
  await waitFor('Tools at the top', `!!${cardOf('Tools')}`)
  await drag(cardOf('Tools'), "document.querySelector('.folder-card')")
  await waitFor('Tools back in', `${places}.then((f) => Object.keys(f.places).length === 3 && !${cardOf('Tools')})`)
  result.folderDrag = true
  step('dragged')

  // The side list: Garden opens to show its files.
  await js("document.querySelector('.sidebar .folder-link').click()")
  await waitFor('side folder open', "!!document.querySelector('.side-folder.open') && document.querySelector('.side-folder-files').getBoundingClientRect().height > 60 && document.querySelectorAll('.side-folder-files .sheet-link').length === 3 && document.querySelector('.sidebar .folder-count').textContent === '3'")
  await snap('side-list')
  result.folderSide = true

  // The side list: drag Tools onto All files (out of the folder), then
  // onto the folder again.
  const sideLink = (title) => `[...document.querySelectorAll('.sidebar .sheet-link')].find((b) => (b.querySelector('.sheet-title') || {}).textContent === ${JSON.stringify(title)})`
  await drag(sideLink('Tools'), "document.querySelector('.sidebar .all-files')")
  await waitFor('Tools out from the side', `${places}.then((f) => Object.keys(f.places).length === 2)`)
  await waitFor('side count', "document.querySelector('.sidebar .folder-count').textContent === '2'")
  await drag(sideLink('Tools'), "document.querySelector('.sidebar .folder-link')")
  await waitFor('Tools in from the side', `${places}.then((f) => Object.keys(f.places).length === 3)`)
  result.folderSideDrag = true
  step('dragged in the side list')

  // Rename from the folder's menu.
  await js("document.querySelector('.folder-card').click()")
  await waitFor('inside Garden', "!!document.querySelector('.folder-more')")
  await snap('inside')
  await js("document.querySelector('.folder-more').click()")
  await waitFor('folder menu', "!!document.querySelector('.card-menu li')")
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'Rename').click()")
  await waitFor('name panel', "document.querySelector('.panel.folder-name input').value === 'Garden'")
  await js(`(() => {
    const el = document.querySelector('.panel.folder-name input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, 'Allotment'); el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await js("document.querySelector('.panel.folder-name .primary').click()")
  await waitFor('renamed', "document.querySelector('.folder-head h1').textContent.trim() === 'Allotment'")
  result.folderRename = true
  step('renamed')

  // Reopened, everything is where it was.
  wc.reload()
  await sleep(500)
  await waitFor('reloaded', "!!document.querySelector('.new-folder-card')", 30000)
  await waitFor('folder kept', "[...document.querySelectorAll('.folder-card .file-title')].some((x) => x.textContent === 'Allotment') && document.querySelector('.folder-card .file-meta').textContent === '3 files'")
  result.folderReopened = true
  step('reopened')

  // Delete the folder: the files stay, at the top level.
  await js("document.querySelector('.folder-card').parentElement.querySelector('.card-more').click()")
  await waitFor('folder menu', "!!document.querySelector('.card-menu li.danger')")
  await js("document.querySelector('.card-menu li.danger').click()")
  await waitFor('delete panel', "!!document.querySelector('.panel .danger')")
  await js("document.querySelector('.panel .danger').click()")
  await waitFor('folder gone, files back', `!document.querySelector('.folder-card') && !!${cardOf('Seeds')} && !!${cardOf('Tools')} && !!${cardOf('Plan')}`)
  result.folderDelete = true
  step('deleted')

  // Right-click a file card: its menu, with both deletes for the owner;
  // Remove from this device takes it off the list.
  await js(`(() => { const r = ${cardOf('Tools')}.getBoundingClientRect(); ${cardOf('Tools')}.querySelector('.file-card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 })) })()`)
  await waitFor('right-click menu', "[...document.querySelectorAll('.card-menu li')].map((l) => l.textContent).join('|') === 'Move to folder...|Remove from this device|Delete for everyone'")
  await snap('context-menu')
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'Remove from this device').click()")
  await waitFor('remove panel', "!!document.querySelector('.panel .primary')")
  await js("document.querySelector('.panel .primary').click()")
  await waitFor('Tools removed', `!document.querySelector('.panel') && !${cardOf('Tools')} && !!${cardOf('Seeds')}`)
  result.fileContextMenu = true
  step('removed from a right-click menu')

  return result.folderMove && result.folderNewInside && result.folderMenuMove && result.folderDrag && result.folderSide && result.folderSideDrag && result.folderRename && result.folderReopened && result.folderDelete && result.fileContextMenu
}
