// Exports a document with every kind of block to .docx the way the app does
// (src/ui/doc/docFiles.js), then has LibreOffice open it and checks the text,
// headings, lists, table and checkboxes it finds (the checkboxes in its PDF
// need `pdftotext`), then imports LibreOffice's own .docx of it and checks the
// formatting came back and that the picture in it is there. Needs `soffice`.
// Usage: node scripts/check-doc-export.js [out-dir]
// With an out-dir it also keeps the .docx and a PDF of it for a look.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { Window } = require('happy-dom')

globalThis.window = new Window()
globalThis.document = window.document

// A 60 x 30 PNG, for the picture.
function png (w, h) {
  const table = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = x * 4; raw[i + 1] = y * 8; raw[i + 2] = 120 }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PIC = png(60, 30)

const MD = `# Weekly plan

Some **bold**, _italic_ and ~~struck~~ words and a [link](https://example.com).

## Lists

- First
- Second
  - Nested

1. One
2. Two

- [ ] Open task
- [x] Done task

### Other blocks

> A quote

\`\`\`
let a = 1
\`\`\`

---

| Name | Role |
| --- | --- |
| Ann | Owner |
`

;(async () => {
  const f = await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'docFiles.js'))
  const keep = process.argv[2]
  const out = keep || fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-doc-'))
  fs.mkdirSync(out, { recursive: true })
  const { json } = await f.fileToJson('Plan.md', new TextEncoder().encode(MD + '\n![A test picture](data:image/png;base64,' + PIC.toString('base64') + ')\n'))
  const pictures = new Map()
  const fill = (n) => { for (const c of n.content || []) { if (c.type === 'image') { c.attrs = { ...c.attrs, mime: 'image/png', w: 60, h: 30, width: 40 }; pictures.set(c.attrs.ref, { bytes: new Uint8Array(PIC), mime: 'image/png' }) } fill(c) } }
  fill(json)
  json.content.unshift({ type: 'paragraph', attrs: { blockStyle: 'title' }, content: [{ type: 'text', text: 'Plan title' }] })
  json.content.push({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Big blue', marks: [{ type: 'textStyle', attrs: { fontSize: '18pt', color: '#1d4ed8', fontFamily: 'serif' } }, { type: 'highlight', attrs: { color: '#fef08a' } }] }] })
  const file = path.join(out, 'Plan.docx')
  fs.writeFileSync(file, await f.toDocx(json, 'Plan', pictures))

  const soffice = (fmt, dir = out) => execFileSync('soffice', ['--headless', '-env:UserInstallation=file://' + path.join(out, 'lo-profile'), '--convert-to', fmt, '--outdir', dir, file], { stdio: 'pipe', timeout: 120000 })
  soffice('txt:Text (encoded):UTF8')
  soffice('html')
  soffice('pdf')
  // LibreOffice saves it as its own .docx; importing that keeps the formatting.
  soffice('docx:MS Word 2007 XML', path.join(out, 'lo'))
  const loFile = await f.fileToJson('Plan.docx', fs.readFileSync(path.join(out, 'lo', 'Plan.docx')))
  const lo = loFile.json
  const big = []
  const walk = (n) => { if (n.type === 'text' && n.text.includes('Big blue')) big.push(n); (n.content || []).forEach(walk) }
  walk(lo)
  const loBlock = lo.content.find((b) => JSON.stringify(b).includes('Big blue'))
  const marks = big.length ? big[0].marks || [] : []
  const ts = (marks.find((m) => m.type === 'textStyle') || {}).attrs || {}
  const hl = (marks.find((m) => m.type === 'highlight') || {}).attrs || {}
  const text = fs.readFileSync(path.join(out, 'Plan.txt'), 'utf8')
  const html = fs.readFileSync(path.join(out, 'Plan.html'), 'utf8')

  const checks = {
    'title text': text.includes('Plan title'),
    'heading text': ['Weekly plan', 'Lists', 'Other blocks'].every((s) => text.includes(s)),
    'headings as headings': /<h1[^>]*>[\s\S]*?Weekly plan/.test(html) && /<h2[^>]*>[\s\S]*?Lists/.test(html) && /<h3[^>]*>[\s\S]*?Other blocks/.test(html),
    'bold text': /<b>bold<\/b>|<strong>bold<\/strong>/.test(html),
    'list items': ['First', 'Second', 'Nested', 'One', 'Two'].every((s) => text.includes(s)),
    'numbered list': /1\.\s*One/.test(text) && /2\.\s*Two/.test(text),
    checklist: text.includes('☐ Open task') && text.includes('☒ Done task'),
    'table cells': /<table[\s\S]*Name[\s\S]*Role[\s\S]*Ann[\s\S]*Owner[\s\S]*<\/table>/.test(html),
    'quote and code': text.includes('A quote') && text.includes('let a = 1'),
    link: html.includes('https://example.com'),
    picture: /<img/i.test(html),
    'picture back from LibreOffice': loFile.pictures.length === 1,
    'formatting back from LibreOffice': [ts.color, ts.fontSize, ts.fontFamily, hl.color, loBlock && loBlock.attrs.textAlign].join() === '#1d4ed8,18pt,serif,#fef08a,center'
  }
  // Both boxes drawn in the PDF: pdftotext finds them and no colour emoji
  // font drew them (it leaves a PDF blank, as it did for ☑).
  const pdf = path.join(out, 'Plan.pdf')
  try {
    const pdfText = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' })
    const fonts = execFileSync('pdffonts', [pdf], { encoding: 'utf8' })
    checks['checkboxes in the PDF'] = pdfText.includes('☐ Open task') && pdfText.includes('☒ Done task') && !/emoji/i.test(fonts)
  } catch {
    console.log('skip checkboxes in the PDF (needs pdftotext and pdffonts from poppler)')
  }
  for (const [name, ok] of Object.entries(checks)) console.log((ok ? 'ok   ' : 'FAIL ') + name)
  const failed = Object.values(checks).filter((x) => !x).length
  console.log(failed ? failed + ' check(s) failed' : 'LibreOffice read the .docx: all checks pass')
  if (keep) console.log('kept in ' + out)
  else fs.rmSync(out, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
})().catch((err) => { console.error(err); process.exit(1) })
