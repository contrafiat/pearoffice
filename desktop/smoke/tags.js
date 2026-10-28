// Smoke test part "tags" (proposals/2026-10-28-file-tags.md): Tags... from a
// card and from the open file's menu, a new tag and an existing one, the pills
// on a card, search by name, by one tag and by two (files with all of them),
// a search at the top level finding a file inside a folder, a search inside a
// folder, renaming and deleting from Manage tags, and reopening.

const fs = require('node:fs')

module.exports = async function tags (t) {
  const { js, step, waitFor, type, more, newSheet, wc, result, sleep } = t
  const tagsNow = "window.pearoffice.call('file:tags')"
  const home = async () => {
    await js("document.querySelector('.sheet-link.all-files').click()")
    await waitFor('the start screen', "!!document.querySelector('.files-home')")
  }
  const cardOf = (title) => `[...document.querySelectorAll('.file-cell')].find((c) => (c.querySelector('.file-title') || {}).textContent === ${JSON.stringify(title)})`
  const titles = "[...document.querySelectorAll('.file-grid .file-cell:not(:has(.folder-card)):not(:has(.new-folder-card)) .file-title')].map((x) => x.textContent).sort().join('|')"
  const rename = async (title) => js(`(() => {
    const el = document.querySelector('.toolbar .title')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus(); set.call(el, ${JSON.stringify(title)}); el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })()`)
  const setInput = (sel, value) => js(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus(); set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const pick = (name) => js(`[...document.querySelectorAll('.tags-panel .folder-choice')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}).click()`)
  const newTag = async (name) => {
    await setInput('.tags-panel .tag-new input', name)
    await js("document.querySelector('.tags-panel .tag-new button').click()")
    await waitFor('tag ' + name + ' ticked', `[...document.querySelectorAll('.tags-panel .folder-choice.current')].some((b) => b.textContent.trim() === ${JSON.stringify(name)})`)
  }
  const closePanel = async () => {
    await js("document.querySelector('.tags-panel .close').click()")
    await waitFor('panel closed', "!document.querySelector('.tags-panel')")
  }
  const filter = (name) => js(`[...document.querySelectorAll('.file-search .tag-filter')].find((b) => b.textContent === ${JSON.stringify(name)}).click()`)

  // Three files: Bike budget, Race plan and Groceries.
  for (const title of ['Bike budget', 'Race plan', 'Groceries']) {
    await newSheet()
    await rename(title)
    await waitFor(title + ' in the list', `[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent === ${JSON.stringify(title)})`)
  }

  // Tags... from the open file's menu (Groceries is open): a new tag.
  await more('Tags...')
  await waitFor('tags panel', "!!document.querySelector('.tags-panel .tag-new input')")
  await newTag('Budget')
  await closePanel()
  result.tagFromMenu = true
  step('tagged from the file menu')

  // Tags... from a card: two new tags and an existing one.
  await home()
  await waitFor('search box', "!!document.querySelector('.file-search input')")
  await js(`${cardOf('Bike budget')}.querySelector('.card-more').click()`)
  await waitFor('card menu', "!!document.querySelector('.card-menu li')")
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'Tags...').click()")
  await waitFor('tags panel', "!!document.querySelector('.tags-panel .tag-new input')")
  await newTag('Bicycle')
  await pick('Budget')
  await waitFor('Budget ticked too', "document.querySelectorAll('.tags-panel .folder-choice.current').length === 2")
  // The same name in another case: the existing tag, nothing new.
  await setInput('.tags-panel .tag-new input', 'bicycle')
  await waitFor('Add, not Create', "document.querySelector('.tags-panel .tag-new button').textContent.trim() === 'Add'")
  await js("document.querySelector('.tags-panel .tag-new button').click()")
  await waitFor('input cleared', "document.querySelector('.tags-panel .tag-new input').value === ''")
  await waitFor('still two tags', `${tagsNow}.then((r) => r.tags.length === 2)`)
  if (process.env.PEAROFFICE_SMOKE_TAGS_SHOT) {
    await sleep(300)
    fs.writeFileSync(process.env.PEAROFFICE_SMOKE_TAGS_SHOT.replace(/\.png$/, '-panel.png'), (await wc.capturePage()).toPNG())
  }
  await closePanel()
  await waitFor('pills on the card', `[...${cardOf('Bike budget')}.querySelectorAll('.tag-pill')].map((p) => p.textContent).join('|') === 'Bicycle|Budget'`)
  const colours = await js(`[...${cardOf('Bike budget')}.querySelectorAll('.tag-pill')].map((p) => getComputedStyle(p).backgroundColor)`)
  if (colours[0] === colours[1]) throw new Error('the two tags have the same colour: ' + colours)
  result.tagPills = true
  step('tagged from a card, pills shown')

  // Race plan: Bicycle only.
  await js(`${cardOf('Race plan')}.querySelector('.card-more').click()`)
  await waitFor('card menu', "!!document.querySelector('.card-menu li')")
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'Tags...').click()")
  await waitFor('tags panel', "document.querySelectorAll('.tags-panel .folder-choice').length === 2")
  await pick('Bicycle')
  await waitFor('ticked', "document.querySelectorAll('.tags-panel .folder-choice.current').length === 1")
  await closePanel()

  // Search: by name, one tag, two tags, then clear.
  await setInput('.file-search input', 'plan')
  await waitFor('name search', `${titles} === 'Race plan'`)
  await js("document.querySelector('.file-search-box .icon-button').click()")
  await waitFor('cleared', `${titles} === 'Bike budget|Groceries|Race plan'`)
  await filter('Bicycle')
  await waitFor('one tag', `${titles} === 'Bike budget|Race plan'`)
  await filter('Budget')
  await waitFor('two tags: all of them', `${titles} === 'Bike budget'`)
  await setInput('.file-search input', 'zzz')
  await waitFor('none match', "document.querySelector('.files-home .folder-empty').textContent === 'No files match.'")
  await js("document.querySelector('.file-search-box .icon-button').click()")
  await waitFor('cleared again', `${titles} === 'Bike budget|Groceries|Race plan' && !document.querySelector('.tag-filter.on')`)
  result.tagSearch = true
  step('searched by name and tags')

  // A file in a folder: found from the top level with its folder's name, and
  // a search inside the folder covers only it.
  await js("document.querySelector('.new-folder-card').click()")
  await waitFor('name panel', "document.activeElement === document.querySelector('.panel.folder-name input')")
  await type('Sport')
  await js("document.querySelector('.panel.folder-name .primary').click()")
  await waitFor('Sport card', "!!document.querySelector('.folder-card')")
  const folderId = await js("window.pearoffice.call('file:folders').then((f) => f.folders[0].id)")
  const raceId = await js(`window.pearoffice.call('file:list').then((l) => l.find((f) => f.title === 'Race plan').sheetId)`)
  await js(`window.pearoffice.call('file:place', { sheetId: ${JSON.stringify(raceId)}, folder: ${JSON.stringify(folderId)} })`)
  await waitFor('Race plan filed', `!${cardOf('Race plan')}`)
  await filter('Bicycle')
  await waitFor('found inside the folder', `${titles} === 'Bike budget|Race plan' && ${cardOf('Race plan')}.querySelector('.file-where').textContent.trim() === 'Sport' && !document.querySelector('.folder-card')`)
  await js("document.querySelector('.file-search-box .icon-button').click()")
  await js("document.querySelector('.folder-card').click()")
  await waitFor('inside Sport', `!!document.querySelector('.folder-head') && ${titles} === 'Race plan'`)
  await setInput('.file-search input', 'bike')
  await waitFor('inside the folder only', "document.querySelector('.files-home .folder-empty').textContent === 'No files match.'")
  await js("document.querySelector('.folder-back').click()")
  await waitFor('back home, search reset', "!!document.querySelector('.folder-card') && document.querySelector('.file-search input').value === ''")
  result.tagFolders = true
  step('search and folders')

  // Reopened, the tags are still there.
  wc.reload()
  await sleep(500)
  await waitFor('reloaded', `!!document.querySelector('.file-search') && [...(${cardOf('Bike budget')} || document).querySelectorAll('.tag-pill')].length === 2`, 30000)
  result.tagReopened = true
  step('reopened')

  // Manage tags: rename Bicycle, delete Budget (the files stay).
  await js(`${cardOf('Groceries')}.querySelector('.card-more').click()`)
  await waitFor('card menu', "!!document.querySelector('.card-menu li')")
  await js("[...document.querySelectorAll('.card-menu li')].find((l) => l.textContent === 'Tags...').click()")
  await waitFor('tags panel', "!!document.querySelector('.tags-panel .manage-tags')")
  await js("document.querySelector('.tags-panel .manage-tags').click()")
  await waitFor('manage', "document.querySelectorAll('.tag-manage .tag-row').length === 2")
  await js("document.querySelector('.tag-manage [aria-label=\"Rename Bicycle\"]').click()")
  await setInput('.tag-manage input', 'Cycling')
  await js("document.querySelector('.tag-manage [aria-label=\"Save\"]').click()")
  await waitFor('renamed', "[...document.querySelectorAll('.tag-manage .tag-pill')].map((p) => p.textContent).join('|') === 'Budget|Cycling'")
  await js("document.querySelector('.tag-manage [aria-label=\"Delete Budget\"]').click()")
  await waitFor('delete asks', "document.querySelector('.tags-panel p').textContent.includes('taken off 2 files')")
  await js("document.querySelector('.tags-panel .danger').click()")
  await waitFor('deleted', "[...document.querySelectorAll('.tag-manage .tag-pill')].map((p) => p.textContent).join('|') === 'Cycling'")
  await js("document.querySelector('.tags-panel .close').click()")
  await waitFor('cards follow', `!document.querySelector('.tags-panel') && [...${cardOf('Bike budget')}.querySelectorAll('.tag-pill')].map((p) => p.textContent).join('|') === 'Cycling' && !${cardOf('Groceries')}.querySelector('.tag-pill') && !!${cardOf('Groceries')}`)
  result.tagManage = true
  step('renamed and deleted')

  // With PEAROFFICE_SMOKE_TAGS_SHOT=<png>: the start screen with a tag picked.
  if (process.env.PEAROFFICE_SMOKE_TAGS_SHOT) {
    await filter('Cycling')
    await sleep(300)
    fs.writeFileSync(process.env.PEAROFFICE_SMOKE_TAGS_SHOT, (await wc.capturePage()).toPNG())
  }

  return result.tagFromMenu && result.tagPills && result.tagSearch && result.tagFolders && result.tagReopened && result.tagManage
}
