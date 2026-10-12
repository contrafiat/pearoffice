// Documents in and out of .docx, .md and .txt (proposals/2026-10-06-documents.md,
// src/ui/doc/docFiles.js). The conversions run here with happy-dom standing in
// for the page's DOM. Only strings, numbers and booleans are compared.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Y = require('yjs')
const b4a = require('b4a')
const fflate = require('fflate')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { Window } = require('happy-dom')
const { createSheetEngine } = require('../src/worklet/engine')
const docModel = require('../src/doc/docModel')
const { tmpDir, cleanup, call } = require('./helpers')

globalThis.window = new Window()
const load = () => import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'docFiles.js'))
const enc = (s) => new TextEncoder().encode(s)

const MD = [
  '# Weekly plan',
  '',
  'Some **bold** words and a [link](https://example.com/page).',
  '',
  '## Lists',
  '',
  '- First',
  '- Second',
  '  - Nested',
  '',
  '1. One',
  '2. Two',
  '',
  '- [ ] Open task',
  '- [x] Done task',
  '',
  '> A quote',
  '',
  '```',
  'let a = 1',
  '```',
  '',
  '---',
  '',
  '| Name | Role |',
  '| --- | --- |',
  '| Ann | Owner |',
  ''
].join('\n')

// Every node type in order, one level deep, as a string.
const types = (json) => (json.content || []).map((n) => n.type + (n.type === 'heading' ? n.attrs.level : '')).join(',')

// All text in the order it appears, one entry per text block.
function blocks (json) {
  const out = []
  const walk = (n) => {
    if (n.type === 'text') return n.text
    const inner = (n.content || []).map(walk).join('')
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') { out.push(inner); return '' }
    return inner
  }
  walk(json)
  return out
}

function find (json, pred) {
  let hit = null
  const walk = (n) => { if (!hit && pred(n)) hit = n; (n.content || []).forEach(walk) }
  walk(json)
  return hit
}

test('a Markdown list mixing bullets and tasks keeps each as it was', async () => {
  const f = await load()
  const { json } = await f.fileToJson('Mixed.md', enc('- Plain one\n- [ ] Task\n- Plain two\n- [x] Done\n'))
  assert.equal(types(json), 'bulletList,taskList,bulletList,taskList')
  assert.equal(json.content.map((l) => blocks(l).join('|')).join(' / '), 'Plain one / Task / Plain two / Done')
  assert.equal(String(json.content[3].content[0].attrs.checked), 'true')
  const md = f.toMarkdown(json)
  assert.equal((md.match(/- \[[ x]\] /g) || []).length, 2)
  assert.ok(md.includes('- Plain one') && md.includes('- Plain two'))
})

test('a Markdown file becomes the editor\'s nodes', async () => {
  const f = await load()
  const { json, dropped } = await f.fileToJson('Plan.md', enc(MD))
  assert.equal(dropped, false)
  assert.equal(types(json), 'heading1,paragraph,heading2,bulletList,orderedList,taskList,blockquote,codeBlock,horizontalRule,table')
  const bold = find(json, (n) => n.type === 'text' && (n.marks || []).some((m) => m.type === 'bold'))
  assert.equal(bold.text, 'bold')
  const link = find(json, (n) => n.type === 'text' && (n.marks || []).some((m) => m.type === 'link'))
  assert.equal(link.text, 'link')
  assert.equal(link.marks.find((m) => m.type === 'link').attrs.href, 'https://example.com/page')
  const tasks = find(json, (n) => n.type === 'taskList')
  assert.equal(tasks.content.map((i) => String(i.attrs.checked)).join(), 'false,true')
  assert.equal(blocks(tasks).join('|'), 'Open task|Done task')
  const nested = find(json, (n) => n.type === 'listItem' && (n.content || []).some((c) => c.type === 'bulletList'))
  assert.equal(blocks(nested).join('|'), 'Second|Nested')
  const table = find(json, (n) => n.type === 'table')
  assert.equal(blocks(table).join('|'), 'Name|Role|Ann|Owner')
  assert.equal(find(json, (n) => n.type === 'codeBlock').content[0].text, 'let a = 1')
})

test('a text file becomes one paragraph per line', async () => {
  const f = await load()
  const { json } = await f.fileToJson('notes.txt', enc('﻿First line\r\n\r\nSecond line\nThird <b>line</b>\n'))
  assert.equal(types(json), 'paragraph,paragraph,paragraph')
  assert.equal(blocks(json).join('|'), 'First line|Second line|Third <b>line</b>')
  const empty = await f.fileToJson('empty.txt', enc(''))
  assert.equal(types(empty.json), 'paragraph')
})

test('pictures and other content with no place are left out and reported', async () => {
  const f = await load()
  const md = await f.fileToJson('a.md', enc('Text\n\n![A picture](pic.png)\n'))
  assert.equal(md.dropped, true)
  assert.equal(blocks(md.json).join('|'), 'Text|')
  const html = await f.fileToJson('a.html', enc('<h1>Hi</h1><p>One<sup><a href="#footnote-1">[1]</a></sup></p><video src="x"></video><h5>Deep</h5>'))
  assert.equal(html.dropped, true)
  assert.equal(types(html.json), 'heading1,paragraph,heading3')
  assert.equal(blocks(html.json).join('|'), 'Hi|One|Deep')
})

test('Markdown export reads back the same', async () => {
  const f = await load()
  const { json } = await f.fileToJson('Plan.md', enc(MD))
  const md = f.toMarkdown(json)
  assert.ok(md.includes('# Weekly plan\n'))
  assert.ok(md.includes('Some **bold** words and a [link](https://example.com/page).'))
  assert.ok(md.includes('- Second\n  - Nested'))
  assert.ok(md.includes('- [ ] Open task\n- [x] Done task'))
  assert.ok(md.includes('| Name | Role |\n| --- | --- |\n| Ann | Owner |'))
  const again = await f.fileToJson('Plan.md', enc(md))
  assert.equal(JSON.stringify(again.json), JSON.stringify(json))
  assert.equal(f.toMarkdown(again.json), md)
})

test('Markdown export keeps marks apart and escapes text', async () => {
  const f = await load()
  const p = (content, attrs) => ({ type: 'paragraph', attrs, content })
  const t = (text, ...marks) => ({ type: 'text', text, marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) })
  const json = {
    type: 'doc',
    content: [
      p([t('Title'), t(' here')], { blockStyle: 'title' }),
      p([t('a '), t('bold ', 'bold'), t('both', 'bold', 'italic'), t(' plain *star* 1_2')]),
      p([t('# not a heading')]),
      p([t('code', 'code'), t(' and '), t('red', { type: 'textStyle', attrs: { color: '#ff0000' } })])
    ]
  }
  assert.equal(f.toMarkdown(json), '# Title here\n\na **bold _both_** plain \\*star\\* 1\\_2\n\n\\# not a heading\n\n`code` and red\n')
})

test('plain text export', async () => {
  const f = await load()
  const { json } = await f.fileToJson('Plan.md', enc(MD))
  const text = f.toText(json)
  assert.ok(text.startsWith('Weekly plan\n\nSome bold words and a link.\n\nLists\n\n- First\n- Second\n  - Nested\n\n1. One\n2. Two\n\n- [ ] Open task\n- [x] Done task\n\nA quote\n\nlet a = 1\n\n---\n\nName\tRole\nAnn\tOwner\n'))
  const back = await f.fileToJson('Plan.txt', enc(text))
  assert.equal(blocks(back.json)[0], 'Weekly plan')
})

test('Word export reads back with its headings, bold, lists and table', async () => {
  const f = await load()
  const { json } = await f.fileToJson('Plan.md', enc(MD))
  json.content.unshift(
    { type: 'paragraph', attrs: { blockStyle: 'title' }, content: [{ type: 'text', text: 'The title' }] },
    { type: 'paragraph', attrs: { blockStyle: 'subtitle' }, content: [{ type: 'text', text: 'The subtitle' }] }
  )
  const bytes = await f.toDocx(json, 'Plan')
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK')
  const back = (await f.fileToJson('Plan.docx', bytes)).json
  assert.equal(blocks(back).slice(0, 3).join('|'), 'The title|The subtitle|Weekly plan')
  assert.equal(back.content[0].attrs.blockStyle, 'title')
  assert.equal(back.content[1].attrs.blockStyle, 'subtitle')
  assert.equal(types(back).split(',').slice(2, 5).join(), 'heading1,paragraph,heading2')
  const bold = find(back, (n) => n.type === 'text' && (n.marks || []).some((m) => m.type === 'bold'))
  assert.equal(bold.text, 'bold')
  const link = find(back, (n) => n.type === 'text' && (n.marks || []).some((m) => m.type === 'link'))
  assert.equal(link.marks.find((m) => m.type === 'link').attrs.href, 'https://example.com/page')
  assert.equal(blocks(find(back, (n) => n.type === 'bulletList')).join('|'), 'First|Second|Nested')
  assert.equal(blocks(find(back, (n) => n.type === 'orderedList')).join('|'), 'One|Two')
  const tasks = find(back, (n) => n.type === 'taskList')
  assert.equal(blocks(tasks).join('|'), 'Open task|Done task')
  assert.equal(tasks.content.map((i) => String(i.attrs.checked)).join(), 'false,true')
  assert.equal(blocks(find(back, (n) => n.type === 'blockquote')).join('|'), 'A quote')
  assert.equal(blocks(find(back, (n) => n.type === 'codeBlock')).join('|'), 'let a = 1')
  assert.equal(blocks(find(back, (n) => n.type === 'table')).join('|'), 'Name|Role|Ann|Owner')
})

test('Word export writes formatting as Word properties', async () => {
  const f = await load()
  const json = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      attrs: { textAlign: 'center', indent: 2, lineHeight: '2', spaceAfter: 'none' },
      content: [
        { type: 'text', text: 'big', marks: [{ type: 'textStyle', attrs: { fontSize: '18pt', fontFamily: 'serif', color: '#1d4ed8' } }] },
        { type: 'text', text: 'lit', marks: [{ type: 'highlight', attrs: { color: '#bbf7d0' } }, { type: 'underline' }, { type: 'strike' }] },
        { type: 'text', text: '2', marks: [{ type: 'superscript' }] }
      ]
    }, { type: 'horizontalRule' }]
  }
  const files = fflate.unzipSync(await f.toDocx(json, 'Formats'))
  const xml = fflate.strFromU8(files['word/document.xml'])
  for (const want of ['<w:jc w:val="center"/>', 'w:left="880"', 'w:line="480"', 'w:after="0"', '<w:sz w:val="36"/>', 'Times New Roman', '<w:color w:val="1D4ED8"/>', '<w:highlight w:val="green"/>', '<w:u w:val="single"/>', '<w:strike/>', '<w:vertAlign w:val="superscript"/>', '<w:pBdr><w:bottom']) {
    assert.ok(xml.includes(want), 'document.xml has ' + want)
  }
  assert.ok(fflate.strFromU8(files['docProps/core.xml']).includes('<dc:title>Formats</dc:title>'))
})

test('Word import keeps colour, size, font, highlight and alignment', async () => {
  const f = await load()
  const style = (attrs) => ({ type: 'textStyle', attrs })
  const json = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: [
          { type: 'text', text: 'Big blue ', marks: [style({ fontSize: '18pt', color: '#1d4ed8', fontFamily: 'serif' })] },
          { type: 'text', text: 'lit', marks: [{ type: 'highlight', attrs: { color: '#bbf7d0' } }] },
          { type: 'text', text: ' plain' }
        ]
      },
      { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'Code font', marks: [style({ fontFamily: 'Consolas', fontSize: '13.5pt' })] }] },
      { type: 'heading', attrs: { level: 2, textAlign: 'justify' }, content: [{ type: 'text', text: 'Georgia red', marks: [style({ fontFamily: 'Georgia', color: '#b3261e' })] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Arial left', marks: [style({ fontFamily: 'Arial' })] }] }
    ]
  }
  const back = (await f.fileToJson('Formats.docx', await f.toDocx(json, 'Formats'))).json
  const runs = []
  const walk = (n) => { if (n.type === 'text') runs.push(n); else (n.content || []).forEach(walk) }
  walk(back)
  const show = (n) => n.text + ':' + (n.marks || []).map((m) => m.type + (m.attrs ? '=' + Object.entries(m.attrs).filter(([, v]) => v != null && v !== '').sort().map(([k, v]) => k + '/' + v).join('+') : '')).sort().join(',')
  assert.equal(runs.map(show).join('|'), [
    'Big blue :textStyle=color/#1d4ed8+fontFamily/serif+fontSize/18pt',
    'lit:highlight=color/#bbf7d0',
    ' plain:',
    'Code font:textStyle=fontFamily/monospace+fontSize/14pt',
    'Georgia red:textStyle=color/#b3261e+fontFamily/serif',
    'Arial left:'
  ].join('|'))
  assert.equal(back.content.map((b) => b.type + '/' + b.attrs.textAlign).join(), 'paragraph/center,paragraph/right,heading/justify,paragraph/null')
})

test('Word import reads run shading as a highlight and nearest sizes', async () => {
  const f = await load()
  const D = await import('docx')
  const doc = new D.Document({
    sections: [{
      children: [new D.Paragraph({
        children: [
          new D.TextRun({ text: 'shaded', shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: 'FED7AA' } }),
          new D.TextRun({ text: ' tiny', size: 11 }),
          new D.TextRun({ text: ' huge', size: 100, color: '000000' })
        ]
      })]
    }]
  })
  const bytes = new Uint8Array(await D.Packer.toArrayBuffer(doc))
  const back = (await f.fileToJson('Shade.docx', bytes)).json
  const p = back.content[0].content
  assert.equal(p.map((n) => n.text).join(), 'shaded, tiny, huge')
  assert.equal(p[0].marks.map((m) => m.type + '/' + m.attrs.color).join(), 'highlight/#fed7aa')
  assert.equal(p[1].marks.map((m) => m.attrs.fontSize).join(), '8pt')
  assert.equal(p[2].marks.map((m) => m.attrs.fontSize + '/' + (m.attrs.color || 'none')).join(), '36pt/none')
  assert.equal(f.fontFamily('Liberation Serif') + ',' + f.fontFamily('PT Sans') + ',' + f.fontFamily('JetBrains Mono'), 'serif,null,monospace')
})

test('Word highlight colours are the nearest by hue', async () => {
  const f = await load()
  const got = ['#fef08a', '#fed7aa', '#fecaca', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#ddd6fe', '#e5e7eb'].map(f.nearestHighlight).join()
  assert.equal(got, 'yellow,yellow,red,green,cyan,blue,blue,lightGray')
})

test('an import becomes the first update of a document body', async () => {
  const f = await load()
  const { json } = await f.fileToJson('Plan.md', enc(MD))
  const doc = new Y.Doc()
  Y.applyUpdate(doc, f.jsonToUpdate(json))
  const text = docModel.plainText(doc)
  assert.ok(text.startsWith('Weekly plan\nSome bold words and a link.\nLists\nFirst\nSecond\nNested'))
  doc.destroy()
  // docFiles.js has the ES module copy of Yjs; read it back with that one.
  const YM = await import('yjs')
  const mine = new YM.Doc()
  YM.applyUpdate(mine, f.jsonToUpdate(json))
  assert.equal(JSON.stringify(f.docToJson(mine)), JSON.stringify(json))
  mine.destroy()
})

test('doc:import makes a document from a file', async (t) => {
  const f = await load()
  const testnet = await createTestnet(3)
  const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  t.after(async () => {
    try { await e.close() } catch {}
    await testnet.destroy()
    cleanup()
  })
  await e.init({})
  const { json } = await f.fileToJson('Plan.md', enc(MD))
  const update = b4a.toString(f.jsonToUpdate(json), 'base64')
  const { sheetId } = await call(e, 'doc:import', { title: 'Plan', update })
  const s = await call(e, 'doc:state', { sheetId })
  assert.equal(s.title, 'Plan')
  assert.equal(s.myRole, 'owner')
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  assert.equal(doc.getMap('meta').get('kind'), 'doc')
  assert.ok(docModel.plainText(doc).includes('Name\nRole\nAnn\nOwner'))
  doc.destroy()
  const list = await call(e, 'sheet:list')
  assert.equal(list.filter((x) => x.sheetId === sheetId).map((x) => x.kind + ':' + x.title).join(), 'doc:Plan')
  await assert.rejects(call(e, 'doc:import', { title: 'Bad', update: b4a.toString(b4a.from([1, 2, 3, 250, 9]), 'base64') }))
})

// OpenDocument text (src/ui/doc/odt.js).
test('.odt export reads back with its headings, bold, lists, table and formatting', async () => {
  const f = await load()
  const { json } = await f.fileToJson('Plan.md', enc(MD))
  const style = (attrs) => ({ type: 'textStyle', attrs })
  json.content.unshift(
    { type: 'paragraph', attrs: { blockStyle: 'title' }, content: [{ type: 'text', text: 'The title' }] },
    { type: 'paragraph', attrs: { blockStyle: 'subtitle' }, content: [{ type: 'text', text: 'The subtitle' }] }
  )
  json.content.push(
    { type: 'paragraph', attrs: { textAlign: 'center', lineHeight: '2', indent: 2 }, content: [
      { type: 'text', text: 'Big blue ', marks: [style({ fontSize: '18pt', color: '#1d4ed8', fontFamily: 'serif' })] },
      { type: 'text', text: 'lit', marks: [{ type: 'highlight', attrs: { color: '#bbf7d0' } }] },
      { type: 'text', text: ' under', marks: [{ type: 'underline' }] },
      { type: 'text', text: ' gone', marks: [{ type: 'strike' }] },
      { type: 'text', text: '2', marks: [{ type: 'superscript' }] },
      { type: 'text', text: ' it', marks: [{ type: 'italic' }] }
    ] },
    { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'two  spaces', marks: [style({ fontFamily: 'monospace' })] }] }
  )
  const bytes = f.exportOdtForTest ? f.exportOdtForTest(json) : (await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'odt.js'))).toOdt(json, 'Plan')
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK')
  const back = (await f.fileToJson('Plan.odt', bytes)).json
  assert.equal(blocks(back).slice(0, 3).join('|'), 'The title|The subtitle|Weekly plan')
  assert.equal(back.content[0].attrs.blockStyle, 'title')
  assert.equal(back.content[1].attrs.blockStyle, 'subtitle')
  assert.equal(types(back).split(',').slice(2, 5).join(), 'heading1,paragraph,heading2')
  const bold = find(back, (n) => n.type === 'text' && (n.marks || []).some((m) => m.type === 'bold'))
  assert.equal(bold.text, 'bold')
  const link = find(back, (n) => n.type === 'text' && (n.marks || []).some((m) => m.type === 'link'))
  assert.equal(link.marks.find((m) => m.type === 'link').attrs.href, 'https://example.com/page')
  assert.equal(blocks(find(back, (n) => n.type === 'bulletList')).join('|'), 'First|Second|Nested')
  assert.equal(blocks(find(back, (n) => n.type === 'orderedList')).join('|'), 'One|Two')
  const tasks = find(back, (n) => n.type === 'taskList')
  assert.equal(blocks(tasks).join('|'), 'Open task|Done task')
  assert.equal(tasks.content.map((i) => String(i.attrs.checked)).join(), 'false,true')
  assert.equal(blocks(find(back, (n) => n.type === 'blockquote')).join('|'), 'A quote')
  assert.equal(blocks(find(back, (n) => n.type === 'codeBlock')).join('|'), 'let a = 1')
  assert.equal(blocks(find(back, (n) => n.type === 'table')).join('|'), 'Name|Role|Ann|Owner')
  const runs = []
  const walk = (n) => { if (n.type === 'text') runs.push(n); else (n.content || []).forEach(walk) }
  walk({ content: back.content.slice(-2) })
  const show = (n) => n.text + ':' + (n.marks || []).map((m) => m.type + (m.attrs ? '=' + Object.entries(m.attrs).filter(([, v]) => v != null && v !== '').sort().map(([k, v]) => k + '/' + v).join('+') : '')).sort().join(',')
  assert.equal(runs.map(show).join('|'), [
    'Big blue :textStyle=color/#1d4ed8+fontFamily/serif+fontSize/18pt',
    'lit:highlight=color/#bbf7d0',
    ' under:underline',
    ' gone:strike',
    '2:superscript',
    ' it:italic',
    'two  spaces:textStyle=fontFamily/monospace'
  ].join('|'))
  const [p1, p2] = back.content.slice(-2)
  assert.equal(p1.attrs.textAlign + '/' + p1.attrs.lineHeight + '/' + p1.attrs.indent, 'center/2/2')
  assert.equal(p2.attrs.textAlign, 'right')
})

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const soffice = (() => { try { execFileSync('soffice', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()
// A 2x1 red and blue PNG.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAN/gH/a1d6FAAAAABJRU5ErkJggg==', 'base64'))

test('LibreOffice opens our .odt, and we open what it saves', { skip: !soffice && 'needs soffice' }, async () => {
  const f = await load()
  const { toOdt } = await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'odt.js'))
  const { json } = await f.fileToJson('Plan.md', enc(MD))
  json.content.unshift({ type: 'paragraph', attrs: { blockStyle: 'title' }, content: [{ type: 'text', text: 'The title' }] })
  json.content.push({ type: 'image', attrs: { ref: 'p1', mime: 'image/png', w: 200, h: 100, width: 50, align: 'center', alt: 'A flag' } })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-odt-'))
  try {
    const ours = path.join(dir, 'plan.odt')
    fs.writeFileSync(ours, toOdt(json, 'Plan', new Map([['p1', { bytes: PNG, mime: 'image/png' }]])))
    const lo = (file, to, out = path.join(dir, 'lo')) => execFileSync('soffice', ['--headless', '-env:UserInstallation=file://' + path.join(dir, 'profile'), '--convert-to', to, '--outdir', out, file], { stdio: 'ignore', timeout: 120000 })
    // LibreOffice reads every block.
    lo(ours, 'txt:Text')
    const text = fs.readFileSync(path.join(dir, 'lo', 'plan.txt'), 'utf8').replace(/^﻿/, '')
    for (const want of ['The title', 'Weekly plan', 'Some bold words and a link.', 'First', 'Nested', 'One', 'Open task', 'A quote', 'let a = 1', 'Name', 'Owner']) assert.ok(text.includes(want), 'LibreOffice reads ' + want)
    // Saved again by LibreOffice, it comes back with the same blocks and the picture.
    lo(ours, 'odt', path.join(dir, 'again'))
    const back = (await f.fileToJson('plan.odt', fs.readFileSync(path.join(dir, 'again', 'plan.odt'))))
    assert.equal(back.json.content[0].attrs.blockStyle, 'title')
    assert.equal(types(back.json).split(',').slice(1, 4).join(), 'heading1,paragraph,heading2')
    assert.equal(blocks(find(back.json, (n) => n.type === 'bulletList')).join('|'), 'First|Second|Nested')
    assert.equal(blocks(find(back.json, (n) => n.type === 'orderedList')).join('|'), 'One|Two')
    assert.equal(blocks(find(back.json, (n) => n.type === 'taskList')).join('|'), 'Open task|Done task')
    assert.equal(blocks(find(back.json, (n) => n.type === 'blockquote')).join('|'), 'A quote')
    assert.equal(blocks(find(back.json, (n) => n.type === 'codeBlock')).join('|'), 'let a = 1')
    assert.equal(blocks(find(back.json, (n) => n.type === 'table')).join('|'), 'Name|Role|Ann|Owner')
    assert.equal(back.pictures.length, 1, 'the picture')
    const img = find(back.json, (n) => n.type === 'image')
    assert.equal(img.attrs.alt + '/' + img.attrs.width, 'A flag/50')
    // A Word file turned into .odt by LibreOffice (its own styles and lists).
    const docx = path.join(dir, 'word.docx')
    fs.writeFileSync(docx, await f.toDocx(json, 'Plan'))
    lo(docx, 'odt')
    const fromWord = (await f.fileToJson('word.odt', fs.readFileSync(path.join(dir, 'lo', 'word.odt')))).json
    assert.equal(fromWord.content[0].attrs.blockStyle, 'title')
    assert.equal(blocks(find(fromWord, (n) => n.type === 'bulletList')).join('|'), 'First|Second|Nested')
    assert.equal(blocks(find(fromWord, (n) => n.type === 'orderedList')).join('|'), 'One|Two')
    assert.equal(blocks(find(fromWord, (n) => n.type === 'table')).join('|'), 'Name|Role|Ann|Owner')
    assert.equal(find(fromWord, (n) => n.type === 'text' && (n.marks || []).some((m) => m.type === 'bold')).text, 'bold')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
