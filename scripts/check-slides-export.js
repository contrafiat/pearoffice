// Exports a deck with every kind of element to .pptx the way the app does
// (src/ui/slides/pptxExport.js), then has LibreOffice turn it into a PDF and
// checks each text is on the right page in about the right place (within 5
// percent of the slide), and reads the .pptx's XML for the six shapes, the
// picture, rotation, notes and the slide size. Needs `soffice` and
// `pdftotext` (poppler).
// Usage: node scripts/check-slides-export.js [out-dir]
// With an out-dir it also keeps the .pptx, LibreOffice's PDF and a PNG of
// each page for a look.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { Window } = require('happy-dom')
const esbuild = require('esbuild')

globalThis.window = new Window()
globalThis.document = window.document

const root = path.join(__dirname, '..')

// A w x h PNG: green with a yellow box in the middle.
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
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3
      const inner = x > w / 4 && x < w * 3 / 4 && y > h / 4 && y < h * 3 / 4
      raw[i] = inner ? 250 : 40; raw[i + 1] = inner ? 204 : 160; raw[i + 2] = inner ? 21 : 70
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// The exporter with the model and Yjs, bundled once so that both use the
// same copy of Yjs (Node would load its CommonJS and ES builds side by side).
async function load (dir) {
  const file = path.join(dir, 'export-bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        "export * as Y from 'yjs'",
        "export { default as slidesModel } from './src/slides/slidesModel.js'",
        "export { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'",
        "export { slideSchema } from './src/ui/slides/text.js'",
        "export * from './src/ui/slides/pptxExport.js'"
      ].join('\n'),
      resolveDir: root,
      loader: 'js'
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    mainFields: ['module', 'main'],
    conditions: ['module'],
    outfile: file,
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: 'error'
  })
  return import(file)
}

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const p = (content, attrs) => ({ type: 'paragraph', attrs, content })
const li = (...content) => ({ type: 'listItem', content })

// Slide 2's formatted text box.
const FORMATTED = {
  type: 'doc',
  content: [
    p([
      t('Formatted ', [{ type: 'bold' }]),
      t('words ', [{ type: 'italic' }, { type: 'underline' }]),
      t('struck ', [{ type: 'strike' }]),
      t('big blue ', [{ type: 'textStyle', attrs: { color: '#1d4ed8', fontSize: '36pt', fontFamily: 'serif' } }, { type: 'highlight', attrs: { color: '#fef08a' } }]),
      t('link', [{ type: 'link', attrs: { href: 'https://example.com/deck' } }])
    ]),
    { type: 'bulletList', content: [li(p([t('First point')])), li(p([t('Second point')]), { type: 'bulletList', content: [li(p([t('Nested point')]))] })] },
    { type: 'orderedList', attrs: { start: 1 }, content: [li(p([t('Step one')])), li(p([t('Step two')]))] },
    p([t('Right side')], { textAlign: 'right', lineHeight: '1.5' })
  ]
}

;(async () => {
  const keep = process.argv[2]
  const out = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-slides-'))
  fs.mkdirSync(out, { recursive: true })
  const t0 = Date.now()
  const m = await load(out)
  const { Y, slidesModel: S } = m
  const doc = new Y.Doc()
  const schema = m.slideSchema()
  const fill = (map, json) => m.prosemirrorJSONToYXmlFragment(schema, json, map.get('text'))
  const els = (slideId) => S.elements(doc, slideId)
  let s1, s2, s3
  const picRef = 'core0:blob0'
  const PIC = png(320, 160)

  doc.transact(() => {
    s1 = S.initDeck(doc, { title: 'Export check' })
    S.setTheme(doc, 'paper')
    const [titleEl, subEl] = els(s1)
    fill(titleEl.map, { type: 'doc', content: [p([t('Quarterly review')])] })
    fill(subEl.map, { type: 'doc', content: [p([t('Prepared by Ana')])] })
    const tilted = S.addText(doc, s1, { x: 1300, y: 860, w: 500, h: 120, rot: 15 })
    fill(S.element(doc, s1, tilted), { type: 'doc', content: [p([t('Tilted note')])] })
    const notes = S.slide(doc, s1).get('notes')
    const para = (text) => { const e = new Y.XmlElement('paragraph'); e.insert(0, [new Y.XmlText(text)]); return e }
    notes.insert(0, [para('Speak slowly'), para('Mention the budget')])

    s2 = S.addSlide(doc, { after: s1, layout: 'blank' })
    const box = S.addText(doc, s2, { x: 100, y: 60, w: 900, h: 460, rot: 0 })
    fill(S.element(doc, s2, box), FORMATTED)
    const spots = {
      rect: { x: 1100, y: 80, w: 300, h: 200, rot: 0 },
      roundRect: { x: 1450, y: 80, w: 300, h: 200, rot: 0 },
      ellipse: { x: 1100, y: 330, w: 300, h: 200, rot: 0 },
      triangle: { x: 1450, y: 330, w: 300, h: 200, rot: 0 },
      arrow: { x: 1100, y: 600, w: 300, h: 200, rot: 30 },
      line: { x: 1450, y: 680, w: 300, h: 40, rot: 0 }
    }
    for (const [shape, f] of Object.entries(spots)) {
      const id = S.addShape(doc, s2, shape, f)
      if (shape === 'rect') fill(S.element(doc, s2, id), { type: 'doc', content: [p([t('Box text')])] })
      if (shape === 'roundRect') S.setStyle(doc, s2, id, { fill: '#fef08a', line: 'accent2', lineW: 8 })
      if (shape === 'line') S.setStyle(doc, s2, id, { lineW: 8 })
    }
    S.addPicture(doc, s2, { ref: picRef, hash: 'h', mime: 'image/png', w: 320, h: 160, alt: 'Green box' }, { x: 100, y: 640, w: 400, h: 200, rot: 0 })

    s3 = S.addSlide(doc, { after: s2, layout: 'blank' })
    const gone = S.addText(doc, s3)
    fill(S.element(doc, s3, gone), { type: 'doc', content: [p([t('Deleted slide')])] })
    S.deleteSlide(doc, s3)
  })

  const pictures = new Map([[picRef, { bytes: new Uint8Array(PIC), mime: 'image/png' }]])
  const bytes = await m.deckToPptx(doc, { title: 'Export check', pictures })
  const file = path.join(out, 'Export check.pptx')
  fs.writeFileSync(file, bytes)
  const exportMs = Date.now() - t0

  // LibreOffice's PDF of it.
  execFileSync('soffice', ['--headless', '-env:UserInstallation=file://' + path.join(out, 'lo-profile'), '--convert-to', 'pdf', '--outdir', out, file], { stdio: 'pipe', timeout: 120000 })
  const pdf = path.join(out, 'Export check.pdf')
  const bbox = execFileSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8' })
  const pages = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)].map((pg) => ({
    w: Number(pg[1]),
    h: Number(pg[2]),
    words: [...pg[3].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((w) => ({ x0: Number(w[1]), y0: Number(w[2]), x1: Number(w[3]), y1: Number(w[4]), text: w[5] }))
  }))
  // Where a phrase is on a page, as fractions of the slide: { x0, y0, x1, y1 }.
  const find = (page, phrase) => {
    const want = phrase.split(' ')
    const pg = pages[page]
    if (!pg) return null
    for (let i = 0; i + want.length <= pg.words.length; i++) {
      if (!want.every((w, k) => pg.words[i + k].text === w)) continue
      const ws = pg.words.slice(i, i + want.length)
      return { x0: Math.min(...ws.map((w) => w.x0)) / pg.w, y0: Math.min(...ws.map((w) => w.y0)) / pg.h, x1: Math.max(...ws.map((w) => w.x1)) / pg.w, y1: Math.max(...ws.map((w) => w.y1)) / pg.h }
    }
    return null
  }
  const near = (a, b) => Math.abs(a - b) <= 0.05
  // Expected spots in slide units: left/top edges, or a centre.
  const at = (page, phrase, want) => {
    const r = find(page, phrase)
    if (!r) return false
    const ok = []
    if ('left' in want) ok.push(near(r.x0, want.left / 1920))
    if ('right' in want) ok.push(near(r.x1, want.right / 1920))
    if ('top' in want) ok.push(near(r.y0, want.top / 1080))
    if ('cx' in want) ok.push(near((r.x0 + r.x1) / 2, want.cx / 1920))
    if ('cy' in want) ok.push(near((r.y0 + r.y1) / 2, want.cy / 1080))
    if (!ok.every(Boolean)) console.log('  ' + phrase + ' found at ' + JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))))
    return ok.every(Boolean)
  }

  const zip = await (await import('jszip')).default.loadAsync(bytes)
  const xml = async (name) => (zip.file(name) ? zip.file(name).async('string') : '')
  const pres = await xml('ppt/presentation.xml')
  const slide1 = await xml('ppt/slides/slide1.xml')
  const slide2 = await xml('ppt/slides/slide2.xml')
  const notes = (await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map(xml))).join('')
  const allSlides = slide1 + slide2
  const twoPPr = [...allSlides.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].some((x) => (x[1].match(/<a:pPr\b/g) || []).length > 1)

  const checks = {
    'two pages (deleted slide left out)': pages.length === 2 && !bbox.includes('Deleted'),
    'pages are 13.333 x 7.5 in': pages.every((pg) => Math.round(pg.w) === 960 && Math.round(pg.h) === 540),
    'title centred on page 1': at(0, 'Quarterly review', { cx: 960, cy: 440 }),
    'subtitle centred under it': at(0, 'Prepared by Ana', { cx: 960, top: 629 }),
    'rotated box on page 1': (pages[0] || { words: [] }).words.some((w) => w.text.startsWith('Tilt')),
    'notes not on the slide': !bbox.includes('Speak'),
    'formatted text top left of page 2': at(1, 'Formatted words struck', { left: 115, top: 69 }),
    'list items on page 2': ['First point', 'Second point', 'Nested point', 'Step one', 'Step two'].every((s) => !!find(1, s)),
    'nested item indented further': (() => { const a = find(1, 'Second point'); const b = find(1, 'Nested point'); return !!a && !!b && b.x0 > a.x0 + 0.01 })(),
    'right aligned paragraph': at(1, 'Right side', { right: 985 }),
    'text in the rectangle centred': at(1, 'Box text', { cx: 1250, cy: 180 }),
    'slide size 13.333 x 7.5 in': /<p:sldSz cx="12192000" cy="6858000"/.test(pres),
    'six preset shapes': ['rect', 'roundRect', 'ellipse', 'triangle', 'rightArrow', 'line'].every((s) => slide2.includes('prst="' + s + '"')),
    'arrow head and shaft': /prst="rightArrow"><a:avLst><a:gd name="adj1" fmla="val 40000"\/><a:gd name="adj2"/.test(slide2),
    'outline colour and width': /<a:ln w="50800"><a:solidFill><a:srgbClr val="6F7F46"\/>/.test(slide2),
    picture: /<p:pic>[\s\S]*descr="Green box"/.test(slide2) && Object.keys(zip.files).some((n) => /^ppt\/media\/.+\.png$/.test(n)),
    rotation: slide1.includes('rot="900000"') && slide2.includes('rot="1800000"'),
    'theme background': slide1.includes('<a:srgbClr val="F6EFE2"/>'),
    'runs formatted': slide2.includes('b="1"') && slide2.includes('i="1"') && slide2.includes('u="sng"') && slide2.includes('strike="sngStrike"') && slide2.includes('sz="3600"') && slide2.includes('<a:highlight><a:srgbClr val="FEF08A"/>') && slide2.includes('typeface="Times New Roman"'),
    link: Object.keys(zip.files).some((n) => /slide2\.xml\.rels$/.test(n)) && (await xml('ppt/slides/_rels/slide2.xml.rels')).includes('https://example.com/deck'),
    'bullets and numbering': slide2.includes('<a:buChar char="&#x2022;"/>') && slide2.includes('<a:buAutoNum type="arabicPeriod"') && slide2.includes('lvl="1"'),
    'one paragraph property block per paragraph': !twoPPr,
    'speaker notes': notes.includes('Speak slowly') && notes.includes('Mention the budget')
  }
  for (const [name, ok] of Object.entries(checks)) console.log((ok ? 'ok   ' : 'FAIL ') + name)
  const failed = Object.values(checks).filter((x) => !x).length
  console.log((failed ? failed + ' check(s) failed' : 'LibreOffice read the .pptx: all ' + Object.keys(checks).length + ' checks pass') + ' (export ' + exportMs + ' ms, total ' + (Date.now() - t0) + ' ms)')
  if (keep) {
    execFileSync('pdftoppm', ['-png', '-r', '48', pdf, path.join(out, 'lo-page')])
    console.log('kept in ' + out)
  } else fs.rmSync(out, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
})().catch((err) => { console.error(err); process.exit(1) })
