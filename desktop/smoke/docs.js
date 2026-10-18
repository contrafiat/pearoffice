// Smoke test part "docs": a document typed with real keys, paste and the
// outline, others' cursors, .md import, Word, Markdown and PDF export,
// pictures and copying a picture between documents.

const path = require('node:path')

module.exports = async function docs (t) {
  const { wc, js, step, waitFor, type, key, sendMod, more, waitFile, downloads, dataDir, result, sleep } = t

  // A document (proposals/2026-10-06-documents.md): typed with real keys,
  // a heading and a list from typed shortcuts, bold, centred, a bigger
  // size, a table, renamed, found in All files and reopened.
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-doc:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-doc').click()")
  await waitFor('doc editor', "!!document.querySelector('.doc-body[contenteditable=\"true\"]') && !!document.querySelector('.doc-tools')")
  await js("document.querySelector('.doc-body').focus()")
  await waitFor('doc focus', "document.activeElement === document.querySelector('.doc-body')")
  await type('# Weekly plan')
  await key('Return')
  await waitFor('heading', "(document.querySelector('.doc-body h1') || {}).textContent === 'Weekly plan'")
  await type('Hello world')
  // On a busy machine the typing is still settling (each edit goes to the
  // worklet and back) when the keys that select arrive, and the selection
  // is lost; wait for the text, then for 'world' to be selected.
  await waitFor('typed', "(document.querySelector('.doc-body p') || {}).textContent === 'Hello world'")
  await sleep(300)
  for (let i = 0; i < 5; i++) await sendMod('Left', ['shift'])
  await waitFor('word selected', "document.getSelection().toString() === 'world'")
  await sendMod('B', ['control'])
  await waitFor('bold word', "(document.querySelector('.doc-body p strong') || {}).textContent === 'world'")
  await js("(() => { const s = document.querySelector('.doc-tools .size-select'); s.value = '18'; s.dispatchEvent(new Event('change', { bubbles: true })) })()")
  await waitFor('font size', "[...document.querySelectorAll('.doc-body p span')].some((x) => x.style.fontSize === '18pt' && x.textContent === 'world')")
  await js("document.querySelector('.doc-tools .align-button').click()")
  await waitFor('align menu', "!!document.querySelector('.doc-pop li.align-center')")
  await js("document.querySelector('.doc-pop li.align-center').click()")
  await waitFor('centred', "[...document.querySelectorAll('.doc-body p')].some((x) => x.style.textAlign === 'center' && x.textContent === 'Hello world')")
  await sendMod('End')
  await key('Return')
  await js("document.querySelector('.doc-tools .align-button').click()")
  await waitFor('align menu', "!!document.querySelector('.doc-pop li.align-left')")
  await js("document.querySelector('.doc-pop li.align-left').click()")
  await type('- First item')
  await key('Return')
  await type('Second item')
  await key('Return')
  await key('Return')
  await waitFor('list', "document.querySelectorAll('.doc-body ul li').length === 2")
  await js("document.querySelector('.doc-tools .table-button').click()")
  await waitFor('table', "document.querySelectorAll('.doc-body table td, .doc-body table th').length === 9")
  await type('Name')
  await key('Tab')
  await type('Role')
  await waitFor('table text', "(document.querySelector('.doc-body table') || {}).textContent.startsWith('NameRole')")
  result.docWords = await js("document.querySelector('.doc-footer .word-count').textContent")
  await js(`(() => {
    const el = document.querySelector('.toolbar .title')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus(); set.call(el, 'Smoke notes'); el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })()`)
  await waitFor('doc title in list', "[...document.querySelectorAll('.sheet-link .sheet-title')].some((b) => b.textContent.trim() === 'Smoke notes')")
  await sleep(600) // the editor sends its edits a moment after typing
  await js("document.querySelector('.sheet-link.all-files').click()")
  await waitFor('doc in all files', "[...document.querySelectorAll('.file-card')].some((c) => !!c.querySelector('.kind-icon.kind-doc') && c.querySelector('.file-title').textContent === 'Smoke notes')")
  result.docCard = true
  await js("[...document.querySelectorAll('.file-card')].find((c) => c.querySelector('.file-title').textContent === 'Smoke notes').click()")
  await waitFor('doc reopened', "!!document.querySelector('.doc-body') && document.querySelector('.doc-body').textContent.includes('Hello world') && (document.querySelector('.doc-body p strong') || {}).textContent === 'world' && !!document.querySelector('.doc-body table')")
  result.docReopened = await js("(() => { const p = [...document.querySelectorAll('.doc-body p')].find((x) => x.textContent === 'Hello world'); return !!p && p.style.textAlign === 'center' && [...p.querySelectorAll('span')].some((x) => x.style.fontSize === '18pt') })()")
  // Others' cursors: one device only, so play a presence event from someone
  // else whose cursor is at the end of the document (a Yjs relative position
  // for the end of 'body').
  const docId = await js("window.pearoffice.call('sheet:list', {}).then((l) => l.find((x) => x.title === 'Smoke notes').sheetId)")
  const endOfBody = 'AQRib2R5AA=='
  const someone = { identity: 'ab'.repeat(32), device: 'cd'.repeat(32), tab: null, row: null, col: null, editing: false, cursor: { anchor: endOfBody, head: endOfBody } }
  wc.send('worklet:event', { name: 'sheet:presence', data: { sheetId: docId, people: [someone] } })
  await waitFor('remote caret', "(document.querySelector('.doc-body .doc-caret .presence-tag') || {}).textContent === 'Someone'")
  result.docCursors = await js("!document.querySelector('.banner[role=alert]') && document.querySelector('.doc-body').editor.state.plugins.some((p) => p.key === 'yjs-cursor$')")
  await t.shot('PEAROFFICE_SMOKE_DOC_SHOT', 300)
  wc.send('worklet:event', { name: 'sheet:presence', data: { sheetId: docId, people: [] } })
  await waitFor('remote caret gone', "!document.querySelector('.doc-caret')")
  step('document')

  // Paste from Google Docs (its bold wrapper and inline styles) keeps the
  // heading, list and bold word without making it all bold; the outline
  // lists the headings and a click moves to one.
  const gdocs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-0a1b2c3d"><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="font-size:16pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;">Pasted section</span></h2><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;">Plain then </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;">strong</span></p><ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;font-weight:400;">Pasted item</span></p></li></ul></b>'
  await js(`(() => {
    const ed = document.querySelector('.doc-body').editor
    ed.chain().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).focus('end').run()
    const dt = new DataTransfer()
    dt.setData('text/html', ${JSON.stringify(gdocs)})
    dt.setData('text/plain', 'Pasted section')
    document.querySelector('.doc-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })()`)
  await waitFor('pasted', "(document.querySelector('.doc-body h2') || {}).textContent === 'Pasted section' && [...document.querySelectorAll('.doc-body li')].some((l) => l.textContent === 'Pasted item')")
  result.docPaste = await js("(() => { const b = [...document.querySelectorAll('.doc-body strong')].map((x) => x.textContent); return b.includes('strong') && !b.some((t) => /Plain|Pasted/.test(t)) })()")
  await js("document.querySelector('.doc-tools .outline-button').click()")
  await waitFor('outline', "[...document.querySelectorAll('.doc-outline .outline-item')].map((b) => b.textContent).join('|') === 'Weekly plan|Pasted section'")
  await waitFor('outline follows the cursor', "(document.querySelector('.doc-outline .outline-item.on') || {}).textContent === 'Pasted section'")
  await js("[...document.querySelectorAll('.doc-outline .outline-item')].find((b) => b.textContent === 'Weekly plan').click()")
  await waitFor('outline click', "(document.querySelector('.doc-outline .outline-item.on') || {}).textContent === 'Weekly plan' && document.querySelector('.doc-body').editor.state.selection.$from.parent.textContent === 'Weekly plan'")
  await t.shot('PEAROFFICE_SMOKE_OUTLINE_SHOT', 300)
  result.docOutline = await js("document.querySelector('.doc-outline .outline-item.level-2').textContent === 'Pasted section'")
  await js("document.querySelector('.doc-tools .outline-button').click()")
  await waitFor('outline closed', "!document.querySelector('.doc-outline')")
  step('document paste and outline')

  // A Markdown file imported as a document (src/ui/doc/docFiles.js), then
  // saved as Word, Markdown and PDF. The picture in it is left out, and
  // a notice says so.
  const md = '# Imported heading\n\nSome **bold** text.\n\n- Apples\n- Pears\n\nPacking:\n\n- [x] Packed\n\n| Item | Cost |\n| --- | --- |\n| Tent | 80 |\n\n![A picture](pic.png)\n'
  await js(`(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([${JSON.stringify(md)}], 'Smoke import.md'))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('imported doc open', "document.querySelector('.toolbar .title').value === 'Smoke import' && (document.querySelector('.doc-body h1') || {}).textContent === 'Imported heading'")
  await waitFor('imported doc content', "document.querySelectorAll('.doc-body ul:not([data-type]) li').length === 2 && document.querySelectorAll('.doc-body li[data-checked=\"true\"]').length === 1 && (document.querySelector('.doc-body p strong') || {}).textContent === 'bold' && (document.querySelector('.doc-body table') || {}).textContent === 'ItemCostTent80'")
  result.docImportNotice = await js("[...document.querySelectorAll('.banner.info')].some((b) => b.textContent.includes('Some parts of this file, such as pictures, were left out.'))")
  result.docImport = true
  step('document import')

  // A picture (proposals/2026-10-06-document-images.md): a generated PNG
  // through the insert button's file input, shown from its picture core,
  // resized by its corner handle and aligned from its bubble.
  await js(`(async () => {
    const c = document.createElement('canvas')
    c.width = 320; c.height = 160
    const g = c.getContext('2d')
    g.fillStyle = '#3b6e22'; g.fillRect(0, 0, 320, 160)
    g.fillStyle = '#f0c040'; g.fillRect(40, 40, 120, 80)
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'box.png', { type: 'image/png' }))
    document.querySelector('.doc-body').editor.commands.focus('end')
    const input = document.querySelector('.doc-tools .picture-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('picture shown', "(() => { const i = document.querySelector('.doc-body .doc-picture-frame img'); return !!i && !i.hidden && i.src.startsWith('blob:') && i.naturalWidth === 320 })()")
  await js("(() => { const ed = document.querySelector('.doc-body').editor; let at = null; ed.state.doc.descendants((n, p) => { if (n.type.name === 'image') at = p }); ed.chain().focus().setNodeSelection(at).run() })()")
  await waitFor('picture handle and bubble', "!!document.querySelector('.doc-picture-block.ProseMirror-selectednode .doc-picture-handle') && !!document.querySelector('.picture-bubble')")
  await js(`(() => {
    const h = document.querySelector('.doc-picture-handle')
    const r = h.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x - 60, clientY: y, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x - 60, clientY: y, pointerId: 1 }))
  })()`)
  await waitFor('picture resized', "(() => { let w = null; document.querySelector('.doc-body').editor.state.doc.descendants((n) => { if (n.type.name === 'image') w = n.attrs.width }); return w > 10 && w < 100 })()")
  await js("document.querySelector('.picture-bubble .picture-align-left').click()")
  await waitFor('picture aligned', "(document.querySelector('.doc-body .doc-picture-block') || {}).dataset?.align === 'left'")
  await t.shot('PEAROFFICE_SMOKE_PICTURE_SHOT', 300)
  result.docPicture = await js("(() => { let a = null; document.querySelector('.doc-body').editor.state.doc.descendants((n) => { if (n.type.name === 'image') a = n.attrs }); return !!a && /^[0-9a-f]{64}:/.test(a.ref) && a.w === 320 && a.h === 160 && a.align === 'left' })()")
  await sleep(600) // the editor sends its edits a moment later
  step('document picture')
  await more('Save as a Word file')
  const docxOut = await waitFile(path.join(downloads, 'Smoke import.docx'))
  let docXml = ''
  let docMedia = 0
  // fflate is only in the checkout; a packaged app checks the file is a zip.
  const fflate = (() => { try { return require('fflate') } catch { return null } })()
  try {
    const zip = fflate.unzipSync(new Uint8Array(docxOut))
    docXml = fflate.strFromU8(zip['word/document.xml'])
    docMedia = Object.keys(zip).filter((k) => /^word\/media\/.+\.(png|jpe?g)$/.test(k)).length
  } catch {}
  const docxOk = fflate
    ? docXml.includes('Imported heading') && docXml.includes('w:val="Heading1"') && docXml.includes('Tent') && docMedia === 1
    : docxOut.length > 1000 && docxOut.slice(0, 2).toString() === 'PK'
  await more('Save as Markdown')
  const mdOut = (await waitFile(path.join(downloads, 'Smoke import.md'))).toString('utf8')
  await more('Save as PDF')
  const docPdf = await waitFile(path.join(dataDir, 'Smoke import.pdf'))
  result.docExport = docxOk &&
    mdOut.startsWith('# Imported heading\n') && mdOut.includes('- [x] Packed') && mdOut.includes('| Tent | 80 |') && /!\[\]\(data:image\/(webp|jpeg|png);base64,/.test(mdOut) &&
    docPdf.length > 1000 && docPdf.slice(0, 4).toString() === '%PDF'
  if (!result.docExport) throw new Error('document export: ' + JSON.stringify({ docx: docxOut.length, media: docMedia, md: mdOut.slice(0, 200), pdf: docPdf.length }))
  step('document export')
  // Ctrl+P prints, as Print... in the More menu does.
  await sendMod('P', ['control'])
  result.docPrintKey = (await waitFile(path.join(dataDir, 'printed.html'))).toString('utf8').includes('Imported heading')
  if (!result.docPrintKey) throw new Error('Ctrl+P did not print the document')
  step('Ctrl+P prints')

  // OpenDocument (src/ui/doc/odt.js): saved as .odt with its picture, then
  // that file imported back as a new document.
  await more('Save as an OpenDocument file (.odt)')
  const odtOut = await waitFile(path.join(downloads, 'Smoke import.odt'))
  let odtXml = ''
  let odtPictures = 0
  try {
    const zip = fflate.unzipSync(new Uint8Array(odtOut))
    odtXml = fflate.strFromU8(zip['content.xml'])
    odtPictures = Object.keys(zip).filter((k) => k.startsWith('Pictures/')).length
  } catch {}
  if (fflate && !(odtXml.includes('Imported heading') && odtXml.includes('Tent') && odtPictures === 1)) throw new Error('odt export: ' + odtXml.slice(0, 200))
  await js(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(odtOut.toString('base64'))}), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'From LibreOffice.odt'))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('odt doc open', "document.querySelector('.toolbar .title').value === 'From LibreOffice' && (document.querySelector('.doc-body h1') || {}).textContent === 'Imported heading'")
  await waitFor('odt doc content', "document.querySelectorAll('.doc-body li[data-checked=\"true\"]').length === 1 && (document.querySelector('.doc-body p strong') || {}).textContent === 'bold' && (document.querySelector('.doc-body table') || {}).textContent === 'ItemCostTent80'")
  await waitFor('odt picture shown', "(() => { const i = document.querySelector('.doc-body .doc-picture-frame img'); return !!i && !i.hidden && i.complete && i.naturalWidth > 0 })()")
  result.docOdt = true
  await js("document.querySelector('.sheet-link.all-files').click()")
  await js("[...document.querySelectorAll('.file-card')].find((c) => c.querySelector('.file-title').textContent === 'Smoke import').click()")
  await waitFor('back to import', "document.querySelector('.toolbar .title').value === 'Smoke import' && document.querySelectorAll('.doc-body .doc-picture-frame').length === 1")
  step('document as .odt')

  // Copy the picture from this document and paste it into "Smoke notes":
  // it is stored again there, so the new node points at that file's own
  // picture core and shows.
  const srcRef = await js("(() => { let a = null; document.querySelector('.doc-body').editor.state.doc.descendants((n) => { if (n.type.name === 'image') a = n.attrs.ref }); return a })()")
  const copiedHtml = await js(`(() => {
    const ed = document.querySelector('.doc-body').editor
    let at = null
    ed.state.doc.descendants((n, p) => { if (n.type.name === 'image') at = p })
    ed.chain().focus().setNodeSelection(at).run()
    const dt = new DataTransfer()
    document.querySelector('.doc-body').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
    return dt.getData('text/html')
  })()`)
  if (!/data-file="[^"]+"/.test(copiedHtml)) throw new Error('copied picture has no data-file: ' + copiedHtml.slice(0, 300))
  await js("document.querySelector('.sheet-link.all-files').click()")
  await js("[...document.querySelectorAll('.file-card')].find((c) => c.querySelector('.file-title').textContent === 'Smoke notes').click()")
  await waitFor('notes open', "document.querySelector('.toolbar .title').value === 'Smoke notes' && !!document.querySelector('.doc-body') && document.querySelector('.doc-body').textContent.includes('Hello world')")
  await js(`(() => {
    const ed = document.querySelector('.doc-body').editor
    ed.chain().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).focus('end').run()
    const dt = new DataTransfer()
    dt.setData('text/html', ${JSON.stringify(copiedHtml)})
    dt.setData('text/plain', '')
    document.querySelector('.doc-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })()`)
  const pastedRef = "(() => { let a = null; document.querySelector('.doc-body').editor.state.doc.descendants((n) => { if (n.type.name === 'image') a = n.attrs.ref }); return a })()"
  await waitFor('pasted picture moved', `(() => { const r = ${pastedRef}; return !!r && r !== ${JSON.stringify(srcRef)} })()`)
  await waitFor('pasted picture shown', "(() => { const i = document.querySelector('.doc-body .doc-picture-frame img'); return !!i && !i.hidden && i.complete && i.naturalWidth > 0 })()")
  const notesId = await js("window.pearoffice.call('sheet:list', {}).then((l) => l.find((x) => x.title === 'Smoke notes').sheetId)")
  const newRef = await js(pastedRef)
  // doc:picture answers only for a picture core of this file, once the
  // editor has sent the edit.
  await waitFor('pasted picture saved', `window.pearoffice.call('doc:picture', { sheetId: ${JSON.stringify(notesId)}, ref: ${JSON.stringify(newRef)} }).then((r) => r.data.length > 0, () => false)`).catch(() => {})
  const fromNotes = await js(`window.pearoffice.call('doc:picture', { sheetId: ${JSON.stringify(notesId)}, ref: ${JSON.stringify(newRef)} }).then((r) => r.data.length > 0, () => false)`)
  result.docPictureCopy = fromNotes && newRef.split(':')[0] !== srcRef.split(':')[0]
  if (!result.docPictureCopy) throw new Error('picture copy: ' + JSON.stringify({ srcRef, newRef, fromNotes }))
  // Cut it from "Smoke notes" and paste it back into "Smoke import": it
  // goes into that file's own picture core (the one srcRef is in).
  const cutHtml = await js(`(() => {
    const ed = document.querySelector('.doc-body').editor
    let at = null
    ed.state.doc.descendants((n, p) => { if (n.type.name === 'image') at = p })
    ed.chain().focus().setNodeSelection(at).run()
    const dt = new DataTransfer()
    document.querySelector('.doc-body').dispatchEvent(new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true }))
    return dt.getData('text/html')
  })()`)
  await waitFor('picture cut', "!document.querySelector('.doc-body .doc-picture-frame')")
  await sleep(600) // the cut is sent a moment later
  await js("document.querySelector('.sheet-link.all-files').click()")
  await js("[...document.querySelectorAll('.file-card')].find((c) => c.querySelector('.file-title').textContent === 'Smoke import').click()")
  await waitFor('import open', "document.querySelector('.toolbar .title').value === 'Smoke import' && document.querySelectorAll('.doc-body .doc-picture-frame').length === 1")
  await js(`(() => {
    const ed = document.querySelector('.doc-body').editor
    ed.chain().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).focus('end').run()
    const dt = new DataTransfer()
    dt.setData('text/html', ${JSON.stringify(cutHtml)})
    document.querySelector('.doc-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })()`)
  const keysHere = "(() => { const k = []; document.querySelector('.doc-body').editor.state.doc.descendants((n) => { if (n.type.name === 'image') k.push(n.attrs.ref.split(':')[0]) }); return k.join(',') })()"
  const srcKey = srcRef.split(':')[0]
  await waitFor('cut picture moved', `${keysHere} === ${JSON.stringify(srcKey + ',' + srcKey)}`)
  await waitFor('cut picture shown', "(() => { const i = [...document.querySelectorAll('.doc-body .doc-picture-frame img')]; return i.length === 2 && i.every((x) => !x.hidden && x.complete && x.naturalWidth > 0) })()")
  result.docPictureCut = true
  await sleep(600)
  step('document picture copy and cut')

  // Ctrl+V with a picture on the system clipboard, and with a picture file
  // copied in a file manager (only its path on the clipboard): both are read
  // by the app (app:clipboardPicture) and land in the document.
  const { clipboard, ClipboardItem } = require('electron')
  const pictureCount = "document.querySelectorAll('.doc-body .doc-picture-frame').length"
  const before = await js(pictureCount)
  const png = await wc.capturePage({ x: 0, y: 0, width: 64, height: 48 })
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png.toPNG()], { type: 'image/png' }) })])
  await js("document.querySelector('.doc-body').editor.chain().insertContentAt(document.querySelector('.doc-body').editor.state.doc.content.size, { type: 'paragraph' }).focus('end').run()")
  wc.paste() // the Edit menu's paste: on a Mac a sent Cmd+V reaches no menu
  await sleep(60)
  await waitFor('pasted clipboard picture', `${pictureCount} === ${before + 1}`)
  const file = path.join(dataDir, 'copied picture.png')
  require('node:fs').writeFileSync(file, png.toPNG())
  await clipboard.write([new ClipboardItem({ 'text/uri-list': require('node:url').pathToFileURL(file).href + '\r\n' })])
  await js("document.querySelector('.doc-body').editor.chain().insertContentAt(document.querySelector('.doc-body').editor.state.doc.content.size, { type: 'paragraph' }).focus('end').run()")
  wc.paste() // the Edit menu's paste: on a Mac a sent Cmd+V reaches no menu
  await sleep(60)
  await waitFor('pasted picture file', `${pictureCount} === ${before + 2}`)
  // A picture copied in a browser can reach the page as HTML holding only an
  // <img> link: the app then reads the picture off the system clipboard.
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png.toPNG()], { type: 'image/png' }) })])
  await js(`(() => {
    const ed = document.querySelector('.doc-body').editor
    ed.chain().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).focus('end').run()
    const dt = new DataTransfer()
    dt.setData('text/html', '<meta charset="utf-8"><img src="https://example.com/photo.png" alt="">')
    document.querySelector('.doc-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })()`)
  await waitFor('picture read off the clipboard', `${pictureCount} === ${before + 3}`)
  result.docPastePicture = true
  step('pasted pictures')

  // A narrow window: the toolbar keeps to one row, More tools shows the rest
  // on more rows and hides them again.
  const barH = "document.querySelector('.doc-tools').getBoundingClientRect().height"
  const moreShown = "!!document.querySelector('.doc-tools .tool-more:not([data-tool-hidden])')"
  const [w0, h0] = t.win.getContentSize()
  t.win.setContentSize(960, h0)
  await waitFor('one row', `${moreShown} && ${barH} < 50 && !!document.querySelector('.doc-tools [data-tool-hidden]')`)
  await js("document.querySelector('.doc-tools .tool-more').click()")
  await waitFor('all tools', `${barH} > 60 && !document.querySelector('.doc-tools [data-tool-hidden]') && !!document.querySelector('.doc-tools .outline-button')`)
  await js("document.querySelector('.doc-tools .tool-more').click()")
  await waitFor('one row again', `${barH} < 50`)
  t.win.setContentSize(w0, h0)
  await waitFor('wide again', `!${moreShown} || ${barH} < 50`)
  result.docToolRow = true
  step('toolbar keeps to one row')

  return result.docToolRow && result.docPrintKey && result.docOdt && result.docPastePicture && result.docPicture && result.docPictureCopy && result.docPictureCut && result.docPaste && result.docOutline && result.docImport && result.docImportNotice && result.docExport && result.docCursors && result.docCard && result.docReopened && result.docWords === '10 words'
}
