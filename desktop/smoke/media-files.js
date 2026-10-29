// Smoke test part "media-files": PDFs and pictures as files
// (proposals/2026-10-29-pdf-and-picture-files.md). A two-page PDF with a link
// and a PNG made here go in through Import a file; each opens in the viewer
// (pages drawn, "Page 1 of 2", the link, zoom), Save a copy gives back the
// same bytes, a JPEG's location data is dropped, a tag goes on, the cards
// show their kind and both open again
// after closing. PEAROFFICE_SMOKE_MEDIA_SHOTS=<folder> saves each viewer.

const fs = require('node:fs')
const path = require('node:path')

// A small valid PDF: two pages of text, a link on the first.
function makePdf () {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [8 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    null, null,
    '<< /Type /Annot /Subtype /Link /Rect [72 690 300 720] /Border [0 0 0] /A << /S /URI /URI (https://peerloom.com/) >> >>'
  ]
  const stream = (text) => { const s = 'BT /F1 28 Tf 72 700 Td (' + text + ') Tj ET'; return '<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream' }
  objs[5] = stream('Smoke page one')
  objs[6] = stream('Smoke page two')
  let out = '%PDF-1.4\n'
  const at = []
  objs.forEach((o, i) => { at.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n' })
  const xref = out.length
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + at.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'
  return Buffer.from(out, 'latin1')
}

module.exports = async function mediaFiles (t) {
  const { js, step, waitFor, more, result, sleep, downloads, waitFile, wc, sendMod } = t
  const shots = process.env.PEAROFFICE_SMOKE_MEDIA_SHOTS
  const snap = async (name) => {
    if (!shots) return
    await sleep(400)
    fs.mkdirSync(shots, { recursive: true })
    fs.writeFileSync(path.join(shots, name + '.png'), (await wc.capturePage()).toPNG())
  }
  const importBytes = (b64, name, mime) => js(`(() => {
    const bin = atob(${JSON.stringify(b64)})
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} }))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  const home = async () => {
    await js("document.querySelector('.sheet-link.all-files').click()")
    await waitFor('the start screen', "!!document.querySelector('.files-home')")
  }
  const saveCopy = () => more('Save a copy')

  // The PDF.
  const pdf = makePdf()
  await importBytes(pdf.toString('base64'), 'Smoke manual.pdf', 'application/pdf')
  await waitFor('PDF open', "document.querySelector('.toolbar .title') && document.querySelector('.toolbar .title').value === 'Smoke manual' && !!document.querySelector('.media-pdf')", 30000)
  await waitFor('pages drawn', "document.querySelectorAll('.pdf-page canvas').length >= 1 && /Page 1 of 2/.test((document.querySelector('.pdf-count') || {}).textContent || '')", 30000)
  await waitFor('link', "[...document.querySelectorAll('.pdf-link')].some((a) => a.getAttribute('href') === 'https://peerloom.com/')", 15000)
  // The page is drawn: some of its pixels are dark (the text).
  const inked = await js("(() => { const c = document.querySelector('.pdf-page canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, Math.floor(c.height / 4)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) n++; return n })()")
  if (!(inked > 50)) throw new Error('the PDF page looks blank: ' + inked)
  const w1 = await js("document.querySelector('.pdf-page').getBoundingClientRect().width")
  await js("document.querySelector('.media-zoom button[aria-label=\"Zoom in\"]').click()")
  await waitFor('zoomed', `document.querySelector('.media-zoom-level').textContent === '125%' && document.querySelector('.pdf-page').getBoundingClientRect().width > ${w1} * 1.2`)
  await js("document.querySelector('.media-zoom button[aria-label=\"Fit\"]').click()")
  await snap('pdf')
  await saveCopy()
  const saved = await waitFile(path.join(downloads, 'Smoke manual.pdf'))
  if (!saved.equals(pdf)) throw new Error('the saved PDF differs: ' + saved.length + ' bytes, wanted ' + pdf.length)
  result.pdf = true
  step('pdf')

  // A tag on it, from the file menu.
  await more('Tags...')
  await waitFor('tags panel', "!!document.querySelector('.tags-panel .tag-new input')")
  await js(`(() => { const el = document.querySelector('.tags-panel .tag-new input'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Manuals'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await js("document.querySelector('.tags-panel .tag-new button').click()")
  await waitFor('tagged', "[...document.querySelectorAll('.tags-panel .folder-choice.current')].some((b) => b.textContent.trim() === 'Manuals')")
  await js("document.querySelector('.tags-panel .close').click()")
  step('tagged')

  // A picture, made here.
  const png = await js(`new Promise((resolve) => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200
    const g = c.getContext('2d'); g.fillStyle = '#2a7'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fff'; g.fillRect(40, 40, 80, 60)
    c.toBlob(async (b) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); resolve(btoa(s)) }, 'image/png')
  })`)
  await importBytes(png, 'Smoke box.png', 'image/png')
  await waitFor('picture open', "document.querySelector('.toolbar .title').value === 'Smoke box' && !!document.querySelector('.media-image') && document.querySelector('.media-image').naturalWidth === 320", 30000)
  await js("document.querySelector('.picture-stage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
  await waitFor('picture zoomed', "document.querySelector('.media-zoom-level').textContent === '250%' && /scale\\(2.5\\)/.test(document.querySelector('.media-image').style.transform)")
  await js("document.querySelector('.picture-stage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
  await snap('picture')
  await saveCopy()
  const savedPng = await waitFile(path.join(downloads, 'Smoke box.png'))
  if (!savedPng.equals(Buffer.from(png, 'base64'))) throw new Error('the saved picture differs')
  result.picture = true
  step('picture')

  // A JPEG with location data (an EXIF block with a marker in it): the
  // stored copy has none of it.
  const jpeg = Buffer.from(await js(`new Promise((resolve) => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 120
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 200, 120)
    c.toBlob(async (b) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); resolve(btoa(s)) }, 'image/jpeg', 0.9)
  })`), 'base64')
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('GPS-LOCATION-MARKER-4471 52.37N 4.89E')])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif])
  const tagged = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)])
  await importBytes(tagged.toString('base64'), 'Smoke photo.jpg', 'image/jpeg')
  await waitFor('photo open', "document.querySelector('.toolbar .title').value === 'Smoke photo' && !!document.querySelector('.media-image') && document.querySelector('.media-image').naturalWidth === 200", 30000)
  await saveCopy()
  const savedJpeg = await waitFile(path.join(downloads, 'Smoke photo.jpg'))
  if (!savedJpeg.length || savedJpeg.includes('GPS-LOCATION-MARKER-4471') || savedJpeg[0] !== 0xff || savedJpeg[1] !== 0xd8) throw new Error('the stored photo still has its location data, or is not a JPEG')
  result.noLocation = true
  step('location dropped')

  // The cards show what they are; both open again after closing.
  await home()
  const card = (title) => `[...document.querySelectorAll('.file-cell')].find((c) => (c.querySelector('.file-title') || {}).textContent === ${JSON.stringify(title)})`
  await waitFor('cards', `!!${card('Smoke manual')}?.querySelector('.kind-pdf') && !!${card('Smoke box')}?.querySelector('.kind-picture') && ${card('Smoke manual')}.textContent.includes('Manuals')`)
  const menuHasTemplate = async (title) => {
    await js(`${card(title)}.querySelector('.card-more').click()`)
    await waitFor('card menu', "!!document.querySelector('.card-menu li')")
    const has = await js("[...document.querySelectorAll('.card-menu li')].some((l) => /template/i.test(l.textContent))")
    await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    await sleep(100)
    return has
  }
  if (await menuHasTemplate('Smoke manual')) throw new Error('a PDF should not offer Use as a template')
  for (let i = 0; i < 3; i++) await sendMod('W', ['control'])
  await js(`${card('Smoke manual')}.querySelector('.file-card').click()`)
  await waitFor('PDF again', "/Page 1 of 2/.test((document.querySelector('.pdf-count') || {}).textContent || '')", 30000)
  await home()
  await js(`${card('Smoke box')}.querySelector('.file-card').click()`)
  await waitFor('picture again', "!!document.querySelector('.media-image') && document.querySelector('.media-image').naturalWidth === 320", 30000)
  result.reopen = true
  step('reopen')
  return true
}
