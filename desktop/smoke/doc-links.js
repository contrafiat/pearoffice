// Smoke test part "doc-links": links in a document. A web address typed
// into the link bar, the card under the caret with Open and Copy link,
// Ctrl+click, then links to another file and a folder picked from the
// bar's list, and opening them (proposals/2026-10-22-links-to-files.md),
// then a link on a picture (proposals/2026-10-26-picture-links.md).

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
    // To the end of the document (Ctrl+End is not a Mac key: Cmd+Down is).
    await js("document.querySelector('.doc-body').editor.commands.focus('end')")
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

  // A link on a picture (proposals/2026-10-26-picture-links.md): added from
  // the picture's bubble, opened from it and by Ctrl+click.
  await js("[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes('Untitled document')).click()")
  await waitFor('doc for the picture', `!!${anchor('Budget')}`)
  await js(`(async () => {
    const c = document.createElement('canvas')
    c.width = 320; c.height = 160
    const g = c.getContext('2d')
    g.fillStyle = '#3b6e22'; g.fillRect(0, 0, 320, 160)
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'box.png', { type: 'image/png' }))
    document.querySelector('.doc-body').editor.commands.focus('end')
    const input = document.querySelector('.doc-tools .picture-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('picture shown', "(() => { const i = document.querySelector('.doc-body .doc-picture-frame img'); return !!i && !i.hidden && i.naturalWidth === 320 })()")
  await js("(() => { const ed = document.querySelector('.doc-body').editor; let at = null; ed.state.doc.descendants((n, p) => { if (n.type.name === 'image') at = p }); ed.chain().focus().setNodeSelection(at).run() })()")
  await waitFor('picture bubble', "!!document.querySelector('.picture-bubble [aria-label=\"Link\"]')")
  await js("document.querySelector('.picture-bubble [aria-label=\"Link\"]').click()")
  await waitFor('picture link bar', "!!document.querySelector('.link-bar input') && document.activeElement === document.querySelector('.link-bar input')")
  await type('example.org/pic')
  await key('Return')
  const picHref = "(() => { let h = null; document.querySelector('.doc-body').editor.state.doc.descendants((n) => { if (n.type.name === 'image') h = n.attrs.href }); return h })()"
  await waitFor('picture linked', `${picHref} === 'https://example.org/pic'`)
  await waitFor('link mark', "!!document.querySelector('.doc-picture-frame[data-href] .doc-picture-link:not([hidden])') && getComputedStyle(document.querySelector('.doc-picture-link')).display !== 'none'")
  await waitFor('bubble Open', "!!document.querySelector('.picture-bubble [aria-label=\"Open link\"]')")
  fs.rmSync(path.join(dataDir, 'opened.txt'), { force: true })
  await js("document.querySelector('.picture-bubble [aria-label=\"Open link\"]').click()")
  await openedHas('https://example.org/pic', 'the picture bubble')
  fs.rmSync(path.join(dataDir, 'opened.txt'), { force: true })
  await js("document.querySelector('.doc-picture-frame[data-href] img').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))")
  await openedHas('https://example.org/pic', 'Ctrl+click on the picture')
  result.pictureLink = true
  step('picture link')

  return result.webLink && result.folderLink && result.fileLink && result.pictureLink
}
