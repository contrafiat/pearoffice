// Exports a document with every kind of block to .docx the way the app does
// (src/ui/doc/docFiles.js), then has LibreOffice open it and checks the text,
// headings, lists and table it finds. Needs `soffice`.
// Usage: node scripts/check-doc-export.js [out-dir]
// With an out-dir it also keeps the .docx and a PDF of it for a look.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Window } = require('happy-dom')

globalThis.window = new Window()

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
  const { json } = await f.fileToJson('Plan.md', new TextEncoder().encode(MD))
  json.content.unshift({ type: 'paragraph', attrs: { blockStyle: 'title' }, content: [{ type: 'text', text: 'Plan title' }] })
  json.content.push({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Big blue', marks: [{ type: 'textStyle', attrs: { fontSize: '18pt', color: '#1d4ed8', fontFamily: 'serif' } }, { type: 'highlight', attrs: { color: '#fef08a' } }] }] })
  const file = path.join(out, 'Plan.docx')
  fs.writeFileSync(file, await f.toDocx(json, 'Plan'))

  const soffice = (fmt) => execFileSync('soffice', ['--headless', '-env:UserInstallation=file://' + path.join(out, 'lo-profile'), '--convert-to', fmt, '--outdir', out, file], { stdio: 'pipe', timeout: 120000 })
  soffice('txt:Text (encoded):UTF8')
  soffice('html')
  if (keep) soffice('pdf')
  const text = fs.readFileSync(path.join(out, 'Plan.txt'), 'utf8')
  const html = fs.readFileSync(path.join(out, 'Plan.html'), 'utf8')

  const checks = {
    'title text': text.includes('Plan title'),
    'heading text': ['Weekly plan', 'Lists', 'Other blocks'].every((s) => text.includes(s)),
    'headings as headings': /<h1[^>]*>[\s\S]*?Weekly plan/.test(html) && /<h2[^>]*>[\s\S]*?Lists/.test(html) && /<h3[^>]*>[\s\S]*?Other blocks/.test(html),
    'bold text': /<b>bold<\/b>|<strong>bold<\/strong>/.test(html),
    'list items': ['First', 'Second', 'Nested', 'One', 'Two'].every((s) => text.includes(s)),
    'numbered list': /1\.\s*One/.test(text) && /2\.\s*Two/.test(text),
    checklist: text.includes('☐ Open task') && text.includes('☑ Done task'),
    'table cells': /<table[\s\S]*Name[\s\S]*Role[\s\S]*Ann[\s\S]*Owner[\s\S]*<\/table>/.test(html),
    'quote and code': text.includes('A quote') && text.includes('let a = 1'),
    link: html.includes('https://example.com')
  }
  for (const [name, ok] of Object.entries(checks)) console.log((ok ? 'ok   ' : 'FAIL ') + name)
  const failed = Object.values(checks).filter((x) => !x).length
  console.log(failed ? failed + ' check(s) failed' : 'LibreOffice read the .docx: all checks pass')
  if (keep) console.log('kept in ' + out)
  else fs.rmSync(out, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
})().catch((err) => { console.error(err); process.exit(1) })
