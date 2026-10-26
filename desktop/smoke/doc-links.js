// Smoke test part "doc-links": links in a document. A web address typed
// into the link bar, the card under the caret with Open and Copy link,
// Ctrl+click, then links to another file and a folder picked from the
// bar's list, and opening them (proposals/2026-10-22-links-to-files.md).

const fs = require('node:fs')
const path = require('node:path')

module.exports = async function docLinks (t) {
  const { js, step, waitFor, type, key, sendMod, dataDir, result, sleep } = t
  const opened = () => { try { return fs.readFileSync(path.join(dataDir, 'opened.txt'), 'utf8') } catch { return '' } }
  const card = "document.querySelector('.link-card')"
  const cardSays = (text) => `!!${card} && ${card}.querySelector('.link-card-address').textContent === ${JSON.stringify(text)}`
  // The app notes what it would open in opened.txt (desktop/main.js).
  const openedHas = async (url, how) => {
    for (let i = 0; i < 50 && !opened().includes(url); i++) await sleep(100)
    if (!opened().includes(url)) throw new Error(how + ' did not open ' + url)
  }
  const anchor = (text) => `[...document.querySelectorAll('.doc-body a')].find((a) => a.textContent === ${JSON.stringify(text)})`

  await js("window.pearoffice.call('sheet:create', { title: 'Budget' })")
  await js("window.pearoffice.call('file:newFolder', { name: 'Work' })")
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-doc:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-doc').click()")
  await waitFor('doc editor', "!!document.querySelector('.doc-body[contenteditable=\"true\"]')")
  await js("document.querySelector('.doc-body').focus()")
  await waitFor('doc focus', "document.activeElement === document.querySelector('.doc-body')")

  // A web address typed with nothing selected goes in as linked text.
  await type('See ')
  await waitFor('typed', "(document.querySelector('.doc-body p') || {}).textContent === 'See '")
  await sleep(200)
  await sendMod('K', ['control'])
  await waitFor('link bar', "!!document.querySelector('.link-bar input')")
  await type('example.com')
  await key('Return')
  await waitFor('web link', `!!${anchor('example.com')} && ${anchor('example.com')}.getAttribute('href') === 'https://example.com'`)
  await key('Left')
  await waitFor('web card', cardSays('https://example.com'))
  await js(card + ".querySelector('[aria-label=\"Open link\"]').click()")
  await openedHas('https://example.com', 'Open')
  await js(card + ".querySelector('[aria-label=\"Copy link\"]').click()")
  await waitFor('copied', `${card}.querySelector('[aria-label="Copy link"]').title === 'Copied'`)
  const { clipboard } = require('electron')
  const copied = String(await clipboard.readText())
  if (copied !== 'https://example.com') throw new Error('Copy link copied ' + copied)
  // Ctrl+click opens it too; a plain click only moves the caret.
  fs.rmSync(path.join(dataDir, 'opened.txt'), { force: true })
  await js(`${anchor('example.com')}.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`)
  await sleep(200)
  if (opened()) throw new Error('a plain click opened the link')
  await js(`${anchor('example.com')}.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))`)
  await openedHas('https://example.com', 'Ctrl+click')
  result.webLink = true
  step('web link')

  // Links to a file and a folder, picked from the list.
  const linkTo = async (group, name) => {
    await js("document.querySelector('.doc-body').focus()")
    await sendMod('End', ['control'])
    await type(' and ')
    await sleep(200)
    await sendMod('K', ['control'])
    await waitFor(name + ' listed', `!![...document.querySelectorAll('.link-bar optgroup[label="${group}"] option')].find((o) => o.textContent === ${JSON.stringify(name)})`)
    await js(`(() => {
      const s = document.querySelector('.link-bar select')
      const o = [...s.querySelectorAll('optgroup[label="${group}"] option')].find((x) => x.textContent === ${JSON.stringify(name)})
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await waitFor('name in the box', `document.querySelector('.link-bar input').value === ${JSON.stringify(name)}`)
    await key('Return')
    await waitFor(name + ' linked', `!!${anchor(name)} && /^pearoffice:\\/\\/(file|folder)\\//.test(${anchor(name)}.getAttribute('href'))`)
    await key('Left')
    await waitFor(name + ' card', cardSays(name))
  }
  await linkTo('Files', 'Budget')
  await linkTo('Folders', 'Work')
  await js(card + ".querySelector('[aria-label=\"Open link\"]').click()")
  await waitFor('folder opened', "!!document.querySelector('.in-folder .folder-head h1') && document.querySelector('.in-folder .folder-head h1').textContent.includes('Work')")
  result.folderLink = true
  step('folder link')

  await js("[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes('Untitled document')).click()")
  await waitFor('doc again', `!!${anchor('Budget')}`)
  await js(`${anchor('Budget')}.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))`)
  await waitFor('file opened', "!!document.querySelector('.title') && document.querySelector('.title').value === 'Budget'")
  result.fileLink = true
  step('file link')

  return result.webLink && result.folderLink && result.fileLink
}
