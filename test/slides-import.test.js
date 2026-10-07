// .pptx import (proposals/2026-10-06-slides.md, "Import and export";
// src/ui/slides/pptxImport.js). Decks are made here: with pptxgenjs, by hand
// (a small package with a master, layout and theme) and, when LibreOffice is
// installed, from its own presentation templates. The reader runs with
// happy-dom standing in for the page's DOM. Only strings, numbers and
// booleans are compared.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const Y = require('yjs')
const b4a = require('b4a')
const JSZip = require('jszip')
const PptxGenJS = require('pptxgenjs')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { Window } = require('happy-dom')
const { createSheetEngine } = require('../src/worklet/engine')
const sm = require('../src/slides/slidesModel')
const { tmpDir, cleanup, call } = require('./helpers')

globalThis.window = new Window()
const load = () => import(path.join(__dirname, '..', 'src', 'ui', 'slides', 'pptxImport.js'))

// --- helpers --------------------------------------------------------------------------

// A w x h PNG of one colour.
function png (w, h, [r, g, b]) {
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc = (buf) => {
    let c = 0xffffffff
    for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rows = []
  for (let y = 0; y < h; y++) {
    rows.push(0)
    for (let x = 0; x < w; x++) rows.push(r, g, b)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))])
}

// Pictures pass through unchanged: the page shrinks them with a canvas.
const prepare = async (bytes, mime) => {
  const b = Buffer.from(bytes)
  const isPng = b.readUInt32BE(0) === 0x89504e47
  return { bytes: new Uint8Array(b), mime: isPng ? 'image/png' : mime, w: isPng ? b.readUInt32BE(16) : 10, h: isPng ? b.readUInt32BE(20) : 10 }
}

// The imported deck read back with the deck model.
async function imported (bytes, pictures = true) {
  const f = await load()
  const parsed = await f.readPresentation(new Uint8Array(bytes))
  const ready = new Map()
  if (pictures) for (const [p, mime] of parsed.media) ready.set(p, await prepare(await parsed.readMedia(p), mime))
  const built = f.buildDeck(parsed, { Y, pictures: ready, title: 'Test' })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, built.update)
  return { f, parsed, built, doc }
}

const textOf = (map) => (map.get('text') instanceof Y.XmlFragment ? sm.plainOf(map.get('text')) : '')
const els = (doc, slideId) => sm.elements(doc, slideId).map((e) => ({ id: e.id, map: e.map, type: e.map.get('type'), role: e.map.get('role') || '', text: textOf(e.map), frame: sm.frame(e.map) }))

// The runs of a box's text as "text|marks" strings, marks as name=value.
function runs (map) {
  const out = []
  const walk = (node) => {
    if (node instanceof Y.XmlText) {
      for (const d of node.toDelta()) {
        const a = d.attributes || {}
        const marks = Object.keys(a).sort().map((k) => {
          if (k !== 'textStyle' && k !== 'link') return k
          const v = a[k]
          return k + '=' + Object.keys(v).filter((x) => v[x] != null).sort().map((x) => x + ':' + v[x]).join(',')
        })
        out.push(d.insert + '|' + marks.join(' '))
      }
      return
    }
    for (const c of node.toArray()) walk(c)
  }
  walk(map.get('text'))
  return out
}

const near = (a, b, span) => Math.abs(a - b) <= span * 0.02

// --- a hand-made package ---------------------------------------------------------------

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const rels = (list) => '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list.map(([id, type, target, ext]) => '<Relationship Id="' + id + '" Type="' + REL + type + '" Target="' + target + '"' + (ext ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>'
const xfrm = (x, y, w, h, extra = '') => '<a:xfrm' + extra + '><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm>'
const nv = (id, name, ph = '', tag = 'Sp') => '<p:nv' + tag + 'Pr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNv' + tag + 'Pr/><p:nvPr>' + ph + '</p:nvPr></p:nv' + tag + 'Pr>'
const para = (text, ppr = '', rpr = '') => '<a:p>' + (ppr ? '<a:pPr' + ppr + '/>' : '') + '<a:r><a:rPr lang="en-US"' + rpr + '/><a:t>' + text + '</a:t></a:r></a:p>'
const TREE_HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'

const THEME = '<a:theme ' + NS + ' name="T"><a:themeElements><a:clrScheme name="C">' +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="F"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="S"><a:fillStyleLst/><a:lnStyleLst><a:ln w="9525"/><a:ln w="25400"/><a:ln w="38100"/></a:lnStyleLst></a:fmtScheme></a:themeElements></a:theme>'

const MASTER = '<p:sldMaster ' + NS + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree>' + TREE_HEAD +
  '<p:sp>' + nv(2, 'Title', '<p:ph type="title"/>') + '<p:spPr>' + xfrm(457200, 274638, 8229600, 1143000) + '</p:spPr><p:txBody><a:bodyPr/>' + para('Master title prompt') + '</p:txBody></p:sp>' +
  '<p:sp>' + nv(3, 'Body', '<p:ph type="body" idx="1"/>') + '<p:spPr>' + xfrm(457200, 1600200, 8229600, 4525963) + '</p:spPr><p:txBody><a:bodyPr/>' + para('Master body prompt') + '</p:txBody></p:sp>' +
  // Decoration on every slide: a band (drawn) and a custom shape (left out).
  '<p:sp>' + nv(4, 'Band') + '<p:spPr>' + xfrm(0, 6400800, 9144000, 457200) + '<a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr></p:sp>' +
  '<p:sp>' + nv(5, 'Swoosh') + '<p:spPr>' + xfrm(0, 0, 914400, 914400) + '<a:custGeom><a:pathLst/></a:custGeom><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:spPr></p:sp>' +
  '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles>' +
  '<p:titleStyle><a:lvl1pPr algn="ctr"><a:buNone/><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
  '<p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="3200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>' +
  '<a:lvl2pPr><a:buChar char="–"/><a:defRPr sz="2800"/></a:lvl2pPr></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>'

// The layout's title has no position (it takes the master's); its body has
// its own and prompt text that must not come through.
const LAYOUT = '<p:sldLayout ' + NS + ' type="obj"><p:cSld><p:spTree>' + TREE_HEAD +
  '<p:sp>' + nv(2, 'Title', '<p:ph type="title"/>') + '<p:spPr/><p:txBody><a:bodyPr/>' + para('Click to edit title') + '</p:txBody></p:sp>' +
  '<p:sp>' + nv(3, 'Body', '<p:ph idx="1"/>') + '<p:spPr>' + xfrm(457200, 2000000, 4000000, 3000000) + '</p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle>' + para('Click to edit text') + '</p:txBody></p:sp>' +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'

function slideXml (tree, { bg = '', after = '', attrs = '' } = {}) {
  return '<p:sld ' + NS + attrs + '><p:cSld>' + bg + '<p:spTree>' + TREE_HEAD + tree + '</p:spTree></p:cSld>' + after + '</p:sld>'
}

// A package: `slides` is [{ xml, rels: [[id, type, target, ext]], notes }].
async function craft ({ size = [9144000, 6858000], slides, extraFiles = {}, presExtra = '' }) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  zip.file('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]))
  zip.file('ppt/presentation.xml', '<p:presentation ' + NS + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>' +
    slides.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="' + size[0] + '" cy="' + size[1] + '"/>' + presExtra + '</p:presentation>')
  zip.file('ppt/_rels/presentation.xml.rels', rels([...slides.map((s, i) => ['rId' + (i + 1), 'slide', 'slides/slide' + (i + 1) + '.xml']), ['rIdM', 'slideMaster', 'slideMasters/slideMaster1.xml']]))
  zip.file('ppt/slideMasters/slideMaster1.xml', MASTER)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme1.xml'], ['rId2', 'slideLayout', '../slideLayouts/slideLayout1.xml']]))
  zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]))
  zip.file('ppt/theme/theme1.xml', THEME)
  slides.forEach((s, i) => {
    const n = i + 1
    const r = [['rIdL', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...(s.rels || [])]
    if (s.notes) {
      r.push(['rIdN', 'notesSlide', '../notesSlides/notesSlide' + n + '.xml'])
      zip.file('ppt/notesSlides/notesSlide' + n + '.xml', '<p:notes ' + NS + '><p:cSld><p:spTree>' + TREE_HEAD +
        '<p:sp>' + nv(2, 'Image', '<p:ph type="sldImg"/>') + '<p:spPr/></p:sp>' +
        '<p:sp>' + nv(3, 'Notes', '<p:ph type="body" idx="1"/>') + '<p:spPr/><p:txBody><a:bodyPr/>' + s.notes + '</p:txBody></p:sp></p:spTree></p:cSld></p:notes>')
    }
    zip.file('ppt/slides/slide' + n + '.xml', s.xml)
    zip.file('ppt/slides/_rels/slide' + n + '.xml.rels', rels(r))
  })
  for (const [name, data] of Object.entries(extraFiles)) zip.file(name, data)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

function craftedDeck () {
  const slide1 = slideXml(
    // The title and body have no position of their own.
    '<p:sp>' + nv(2, 'Title 1', '<p:ph type="title"/>') + '<p:spPr/><p:txBody><a:bodyPr/>' + para('Crafted title') + '</p:txBody></p:sp>' +
    '<p:sp>' + nv(3, 'Body 2', '<p:ph idx="1"/>') + '<p:spPr/><p:txBody><a:bodyPr/>' +
      '<a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>First</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t> point</a:t></a:r></a:p>' +
      para('Sub point', ' lvl="1"') + '</p:txBody></p:sp>' +
    // A group at half scale holding a darkened accent ellipse.
    '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>' +
      '<p:sp>' + nv(5, 'Dot') + '<p:spPr>' + xfrm(0, 0, 2000000, 2000000) + '<a:prstGeom prst="ellipse"/><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></p:spPr></p:sp>' +
    '</p:grpSp>' +
    '<p:sp>' + nv(6, 'Grad') + '<p:spPr>' + xfrm(4000000, 1000000, 1000000, 1000000) + '<a:prstGeom prst="rect"/><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="112233"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst></a:gradFill><a:ln w="38100"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></p:spPr></p:sp>' +
    '<p:sp>' + nv(7, 'Free') + '<p:spPr>' + xfrm(5500000, 1000000, 1000000, 1000000) + '<a:custGeom><a:pathLst/></a:custGeom><a:solidFill><a:srgbClr val="FF00FF"/></a:solidFill></p:spPr></p:sp>' +
    '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="8" name="Link"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>' + xfrm(0, 0, 914400, 914400) + '<a:prstGeom prst="straightConnector1"/><a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr></p:cxnSp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Hidden" hidden="1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>' + xfrm(0, 0, 100000, 100000) + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>' +
    '<p:sp>' + nv(10, 'Up') + '<p:spPr>' + xfrm(7000000, 1000000, 1000000, 2000000) + '<a:prstGeom prst="upArrow"/><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></p:spPr></p:sp>' +
    // A custom outline that is only a square standing on its corner.
    '<p:sp>' + nv(11, 'Diamond') + '<p:spPr>' + xfrm(2000000, 4000000, 1000000, 1000000) + '<a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="50" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:lnTo><a:pt x="50" y="100"/></a:lnTo><a:lnTo><a:pt x="25" y="75"/></a:lnTo><a:lnTo><a:pt x="0" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="00FFFF"/></a:solidFill></p:spPr></p:sp>',
    {}
  )
  const slide2 = slideXml(
    // A see-through tint: kept, with its opacity.
    '<p:sp>' + nv(3, 'Tint') + '<p:spPr>' + xfrm(0, 0, 9144000, 6858000) + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="0D84A1"><a:alpha val="30000"/></a:srgbClr></a:solidFill></p:spPr></p:sp>' +
    '<p:sp>' + nv(2, 'Box', '', 'Sp') + '<p:spPr>' + xfrm(914400, 914400, 4572000, 914400) + '<a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr/>' +
      '<a:p><a:r><a:rPr lang="en-US" sz="2000"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr><a:t>Light on dark</a:t></a:r></a:p></p:txBody></p:sp>',
    {
      bg: '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="161A26"/></a:solidFill></p:bgPr></p:bg>',
      after: '<p:transition spd="med"><p:fade/></p:transition><p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:par><p:cTn id="2" presetClass="entr" presetID="10"/></p:par><p:par><p:cTn id="3" presetClass="exit" presetID="10"/></p:par></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
    }
  )
  return craft({
    slides: [
      { xml: slide1, notes: para('Crafted notes', '', ' b="1"') + para('Second line') },
      { xml: slide2 }
    ],
    presExtra: '<p:embeddedFontLst><p:embeddedFont><p:font typeface="X"/></p:embeddedFont></p:embeddedFontLst>'
  })
}

// --- tests ------------------------------------------------------------------------------

test('a hand-made deck: size, inheritance, groups, shapes, notes and what was lost', async () => {
  const { doc, built, f } = await imported(await craftedDeck())
  assert.equal(sm.size(doc).join('x'), '1440x1080') // 4:3
  const k = 1440 / 9144000
  const ids = sm.slideIds(doc)
  assert.equal(ids.length, 2)
  assert.equal(sm.slides(doc, { gone: true }).length, 2)

  const one = els(doc, ids[0])
  assert.equal(sm.slide(doc, ids[0]).get('layout'), 'content')
  const title = one.find((e) => e.role === 'title')
  assert.equal(title.text, 'Crafted title')
  // The title takes its place from the master, through the layout.
  assert.ok(near(title.frame.x, 457200 * k, 1440) && near(title.frame.y, 274638 * k, 1080), JSON.stringify(title.frame))
  assert.ok(near(title.frame.w, 8229600 * k, 1440) && near(title.frame.h, 1143000 * k, 1080))
  // The body takes the layout's place, not the master's; prompt text stays out.
  const body = one.find((e) => e.role === 'body')
  assert.ok(near(body.frame.x, 457200 * k, 1440) && near(body.frame.y, 2000000 * k, 1080) && near(body.frame.w, 4000000 * k, 1440), JSON.stringify(body.frame))
  assert.equal(body.text, 'First point\nSub point')
  assert.ok(!sm.plainText(doc).includes('Click to edit') && !sm.plainText(doc).includes('prompt'))
  // Master style: 32 pt bullets, the layout centres them, the second level is nested.
  assert.equal(runs(body.map).join(' / '), 'First|bold textStyle=fontSize:32pt /  point|textStyle=fontSize:32pt / Sub point|textStyle=fontSize:28pt')
  const list = body.map.get('text').toArray()[0]
  assert.equal(list.nodeName, 'bulletList')
  assert.equal(list.toArray().length, 1)
  assert.equal(list.toArray()[0].toArray().map((n) => n.nodeName).join(), 'paragraph,bulletList')
  assert.equal(list.toArray()[0].toArray()[0].getAttribute('textAlign'), 'center')
  // The title's font is the theme's heading font, a serif; its size is the default.
  assert.equal(runs(title.map).join(), 'Crafted title|textStyle=fontFamily:serif')

  // Back to front: the master's band, then the slide's shapes in file order.
  const shapes = one.filter((e) => e.type === 'shape')
  const style = (e) => { const s = sm.style(e.map); return s.shape + ':' + s.fill + ':' + s.line + ':' + s.lineW }
  assert.equal(shapes.map(style).join(' '), 'rect:#c0504d:none:0 ellipse:#254061:none:0 rect:#112233:#0000ff:6 rect:#ff00ff:none:0 line:none:#ff0000:4 arrow:#00aa00:none:0 rect:#00ffff:none:0')
  assert.equal(one.map((e) => e.role || e.type).join(), 'shape,title,body,shape,shape,shape,shape,shape,shape')
  // The group's ellipse at half scale.
  const dot = shapes[1].frame
  assert.ok(near(dot.x, 1000000 * k, 1440) && near(dot.y, 1000000 * k, 1080) && near(dot.w, 1000000 * k, 1440) && near(dot.h, 1000000 * k, 1080), JSON.stringify(dot))
  // The connector is a line turned 45 degrees across its box's diagonal.
  const line = shapes[4].frame
  assert.equal(line.rot, 45)
  assert.ok(near(line.w, Math.hypot(914400, 914400) * k, 1440))
  // An up arrow is our right arrow turned, its box turned with it.
  const up = shapes[5].frame
  assert.equal(up.rot, 270)
  assert.ok(near(up.w, 2000000 * k, 1440) && near(up.h, 1000000 * k, 1080))
  assert.ok(near(up.x + up.w / 2, 7500000 * k, 1440) && near(up.y + up.h / 2, 2000000 * k, 1080))
  // The diamond is a square turned 45 degrees about the same centre.
  const dia = shapes[6].frame
  assert.equal(dia.rot, 45)
  assert.ok(near(dia.w, 707107 * k, 1440) && near(dia.h, 707107 * k, 1080), JSON.stringify(dia))
  assert.ok(near(dia.x + dia.w / 2, 2500000 * k, 1440) && near(dia.y + dia.h / 2, 4500000 * k, 1080))

  // Notes, with bold kept.
  const notes = sm.slide(doc, ids[0]).get('notes')
  assert.equal(sm.plainOf(notes), 'Crafted notes\nSecond line')
  assert.equal(notes.toArray()[0].toArray()[0].toDelta()[0].attributes.bold !== undefined, true)

  // Slide 2: no title, so blank; a dark background drawn as a rectangle
  // (the deck's theme comes from the first slide, which is white).
  assert.equal(built.theme, 'plain')
  const two = els(doc, ids[1])
  assert.equal(sm.slide(doc, ids[1]).get('layout'), 'blank')
  assert.equal(two.map((e) => e.type).join(), 'shape,shape,shape,text')
  assert.equal(style(two[0]) + ' ' + JSON.stringify(two[0].frame), 'rect:#161a26:none:0 {"x":0,"y":0,"w":1440,"h":1080,"rot":0}')
  assert.equal(style(two[2]) + ' ' + sm.style(two[2].map).fillOpacity, 'rect:#0d84a1:none:0 0.3')
  assert.equal(runs(two[3].map).join(), 'Light on dark|textStyle=color:#ffffff,fontSize:20pt')

  // What was lost, each counted once.
  const lost = built.lost
  assert.equal(JSON.stringify(Object.keys(lost).sort().map((x) => x + '=' + lost[x])), JSON.stringify(['animations=2', 'customShapes=1', 'designShapes=1', 'fonts=1', 'gradients=1', 'transitions=1']))
  assert.equal(f.noticeFor(lost), 'Left out: 2 animations, 1 slide transition, 1 drawn shape from the slide design and 1 embedded font. Drawn as boxes: 1 custom shape PearOffice cannot read. Filled with their first colour: 1 gradient. Fonts and the theme are the closest PearOffice has.')
})

test('the text reads back in the editor schema', async () => {
  const { built } = await imported(await craftedDeck())
  // The editor has the ES module copy of Yjs and y-tiptap.
  const YM = await import('yjs')
  const { yXmlFragmentToProseMirrorRootNode } = await import('@tiptap/y-tiptap')
  const { getSchema } = await import('@tiptap/core')
  const { slideExtensions } = await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'extensions.js'))
  const doc = new YM.Doc()
  YM.applyUpdate(doc, built.update)
  const schema = getSchema(slideExtensions())
  const texts = []
  for (const [, s] of doc.getMap('slides')) {
    for (const [, el] of s.get('els')) {
      if (!el.get('text') || !el.get('text').length) continue // empty layout boxes
      const node = yXmlFragmentToProseMirrorRootNode(el.get('text'), schema)
      node.check()
      if (node.textContent) texts.push(node.textContent)
    }
  }
  assert.equal(texts.sort().join('|'), 'Crafted title|First pointSub point|Light on dark')
  doc.destroy()
})

// The follow-ups (proposals/2026-10-06-slides-followups.md): see-through
// fills and outlines, where text sits, no wrapping, a crop, line ends,
// custom shapes and SmartArt with and without its drawing.
const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
const DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram'
const smartArt = (id, name, x, dm) => '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
  '<p:xfrm><a:off x="' + x + '" y="4000000"/><a:ext cx="3000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="' + DGM + '"><dgm:relIds xmlns:dgm="' + DGM + '" r:dm="' + dm + '" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/></a:graphicData></a:graphic></p:graphicFrame>'
const dataModel = (texts, drawingRel) => '<dgm:dataModel xmlns:dgm="' + DGM + '" ' + NS + '><dgm:ptLst>' +
  texts.map((t, i) => '<dgm:pt modelId="' + (i + 1) + '"><dgm:t><a:bodyPr/>' + para(t) + '</dgm:t></dgm:pt>').join('') + '</dgm:ptLst>' +
  (drawingRel ? '<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="' + DSP + '" relId="' + drawingRel + '" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst>' : '') + '</dgm:dataModel>'
// The drawing: shapes placed from the graphic frame's corner.
const DRAWING = '<dsp:drawing xmlns:dsp="' + DSP + '" ' + NS + '><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>' +
  '<dsp:sp modelId="{A}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr>' + xfrm(0, 0, 1000000, 800000) + '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="2266AA"/></a:solidFill></dsp:spPr>' +
    '<dsp:txBody><a:bodyPr anchor="ctr"/>' + para('Step A') + '</dsp:txBody></dsp:sp>' +
  '<dsp:sp modelId="{B}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr>' + xfrm(1500000, 0, 1000000, 800000) + '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="AA6622"/></a:solidFill></dsp:spPr>' +
    '<dsp:txBody><a:bodyPr/>' + para('Step B') + '</dsp:txBody></dsp:sp>' +
  '</dsp:spTree></dsp:drawing>'

function followUpsDeck () {
  const geom = (paths, gd = '') => '<a:custGeom><a:avLst/><a:gdLst>' + gd + '</a:gdLst><a:pathLst>' + paths + '</a:pathLst></a:custGeom>'
  const slide = slideXml(
    // A see-through fill and outline.
    '<p:sp>' + nv(2, 'Glass') + '<p:spPr>' + xfrm(500000, 500000, 2000000, 1000000) + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="40000"/></a:srgbClr></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="0000FF"><a:alpha val="60000"/></a:srgbClr></a:solidFill></a:ln></p:spPr></p:sp>' +
    // A text box at the bottom that does not wrap.
    '<p:sp>' + nv(3, 'Low', '', 'Sp') + '<p:spPr>' + xfrm(3000000, 500000, 2000000, 1500000) + '<a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="b" wrap="none"/>' + para('Low text') + '</p:txBody></p:sp>' +
    // A shape with its text at the top.
    '<p:sp>' + nv(4, 'Top') + '<p:spPr>' + xfrm(5500000, 500000, 1000000, 1000000) + '<a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></p:spPr><p:txBody><a:bodyPr anchor="t"/>' + para('Up here') + '</p:txBody></p:sp>' +
    // A cropped picture.
    '<p:pic><p:nvPicPr><p:cNvPr id="5" name="Pic" descr="Cropped"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdP"/><a:srcRect l="10000" t="20000" r="30000" b="-5000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' + xfrm(7000000, 500000, 1000000, 1000000) + '<a:prstGeom prst="rect"/></p:spPr></p:pic>' +
    // A connector with a triangle at its start and a stealth arrow at its end.
    '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="Ends"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>' + xfrm(500000, 2000000, 2000000, 0) + '<a:prstGeom prst="straightConnector1"/><a:ln w="19050"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:headEnd type="triangle"/><a:tailEnd type="stealth" w="med" len="med"/></a:ln></p:spPr></p:cxnSp>' +
    // An isosceles triangle as a custom shape: our triangle.
    '<p:sp>' + nv(7, 'Tri') + '<p:spPr>' + xfrm(500000, 2500000, 1000000, 1000000) + geom('<a:path w="2" h="2"><a:moveTo><a:pt x="1" y="0"/></a:moveTo><a:lnTo><a:pt x="2" y="2"/></a:lnTo><a:lnTo><a:pt x="0" y="2"/></a:lnTo><a:close/></a:path>') + '<a:solidFill><a:srgbClr val="AA00AA"/></a:solidFill></p:spPr></p:sp>' +
    // A lopsided triangle, flipped: a custom shape.
    '<p:sp>' + nv(8, 'Lop') + '<p:spPr>' + xfrm(2000000, 2500000, 1000000, 1000000, ' flipH="1"') + geom('<a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path>') + '<a:solidFill><a:srgbClr val="00AAAA"/></a:solidFill></p:spPr></p:sp>' +
    // Curves: a cubic, a quadratic and a quarter arc, points from guides,
    // plus an unfilled path that goes.
    '<p:sp>' + nv(9, 'Wave') + '<p:spPr>' + xfrm(3500000, 2500000, 2000000, 1000000) +
      geom('<a:path><a:moveTo><a:pt x="l" y="b"/></a:moveTo><a:cubicBezTo><a:pt x="l" y="t"/><a:pt x="hc" y="t"/><a:pt x="hc" y="vc"/></a:cubicBezTo><a:quadBezTo><a:pt x="x1" y="b"/><a:pt x="r" y="vc"/></a:quadBezTo>' +
        '<a:arcTo wR="wd4" hR="hd2" stAng="0" swAng="5400000"/><a:close/></a:path><a:path fill="none"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="r" y="t"/></a:lnTo></a:path>',
      '<a:gd name="x1" fmla="*/ w 3 4"/>') + '<a:solidFill><a:srgbClr val="FFAA00"/></a:solidFill></p:spPr><p:txBody><a:bodyPr anchor="b"/>' + para('Wave text') + '</p:txBody></p:sp>' +
    // SmartArt with its drawing, and one without.
    smartArt(10, 'Diagram', 500000, 'rIdD1') + smartArt(11, 'Plain', 5000000, 'rIdD2')
  )
  return craft({
    size: [12192000, 6858000],
    slides: [{
      xml: slide,
      rels: [['rIdP', 'image', '../media/pic.png'], ['rIdD1', 'diagramData', '../diagrams/data1.xml'], ['rIdD2', 'diagramData', '../diagrams/data2.xml']]
    }],
    extraFiles: {
      'ppt/media/pic.png': png(40, 40, [10, 200, 10]),
      'ppt/diagrams/data1.xml': dataModel(['Step A', 'Step B'], 'rIdDr'),
      'ppt/diagrams/data2.xml': dataModel(['Only text'], null),
      'ppt/diagrams/drawing1.xml': DRAWING
    }
  }).then(async (bytes) => {
    // The drawing's relationship has Microsoft's own type.
    const zip = await JSZip.loadAsync(bytes)
    const relsName = 'ppt/slides/_rels/slide1.xml.rels'
    const xml = await zip.file(relsName).async('string')
    zip.file(relsName, xml.replace('</Relationships>', '<Relationship Id="rIdDr" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/></Relationships>'))
    return zip.generateAsync({ type: 'uint8array' })
  })
}

test('follow-ups: opacity, text position, no wrap, crop, line ends, custom shapes and SmartArt', async () => {
  const { doc, built, f } = await imported(await followUpsDeck())
  const [id] = sm.slideIds(doc)
  const all = els(doc, id)
  const named = (text) => all.find((e) => e.text === text)
  const shapes = all.filter((e) => e.type === 'shape')
  const st = (e) => sm.style(e.map)

  const glass = shapes.find((e) => st(e).fill === '#ff0000')
  assert.equal([st(glass).fillOpacity, st(glass).line, st(glass).lineOpacity].join(), '0.4,#0000ff,0.6')

  const low = named('Low text')
  assert.equal(low.type, 'text')
  const lowLayout = sm.textLayout(low.map)
  assert.equal(lowLayout.anchor + ' ' + lowLayout.wrap, 'bottom false')
  const up = named('Up here')
  assert.equal(up.type + ' ' + sm.textLayout(up.map).anchor, 'shape top')

  const pic = all.find((e) => e.type === 'picture')
  const c = sm.crop(pic.map)
  assert.equal([c.l, c.t, c.r, c.b].join(), '0.1,0.2,0.3,0')

  const line = shapes.find((e) => st(e).shape === 'line')
  assert.equal(st(line).head + ' ' + st(line).tail, 'triangle arrow')

  assert.equal(shapes.find((e) => st(e).fill === '#aa00aa').map.get('shape'), 'triangle')
  const lop = shapes.find((e) => st(e).fill === '#00aaaa')
  // Flipped left to right: the right angle is at the bottom right.
  assert.equal(st(lop).shape + ' ' + st(lop).path, 'custom M1000 0L0 1000L1000 1000Z')
  const wave = named('Wave text')
  assert.equal(st(wave).shape, 'custom')
  // l,b; cubic to the middle; quadratic to the right edge at 3/4 across;
  // a quarter of an ellipse a quarter wide and half high, from its right
  // end downwards; the unfilled path is left out.
  const path = st(wave).path
  assert.ok(path.startsWith('M0 1000C0 0 500 0 500 500Q750 1000 1000 500C'), path)
  assert.ok(path.endsWith('750 1000Z'), path)
  assert.equal(sm.textLayout(wave.map).anchor, 'bottom')
  assert.equal(built.lost.approximated, 1) // the unfilled path

  // SmartArt with its drawing: its shapes and text, from the frame's corner.
  const k = 1920 / 12192000
  const stepA = named('Step A')
  const stepB = named('Step B')
  assert.equal(st(stepA).shape + ' ' + st(stepA).fill + ' ' + st(stepB).shape, 'roundRect #2266aa ellipse')
  assert.ok(near(stepA.frame.x, 500000 * k, 1920) && near(stepA.frame.y, 4000000 * k, 1080), JSON.stringify(stepA.frame))
  assert.ok(near(stepB.frame.x, 2000000 * k, 1920) && near(stepB.frame.w, 1000000 * k, 1920), JSON.stringify(stepB.frame))
  // Without one: its text only.
  assert.equal(named('Only text').type, 'text')
  assert.equal(built.lost.smartArt, 1)
  // The master's empty custom shape (craft's MASTER) is the design shape.
  assert.equal(JSON.stringify(Object.keys(built.lost).sort()), JSON.stringify(['approximated', 'designShapes', 'smartArt']))
  assert.equal(f.noticeFor(built.lost), 'Left out: 1 drawn shape from the slide design. Kept as text only: 1 SmartArt graphic. Drawn close to the original: 1 custom shape. Fonts and the theme are the closest PearOffice has.')
})

async function pptxgenDeck () {
  const red = png(40, 20, [220, 30, 30])
  const p = new PptxGenJS()
  p.layout = 'LAYOUT_WIDE' // 13.333 x 7.5 in
  p.defineSlideMaster({
    title: 'M',
    background: { color: 'FFFFFF' },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 12.3, h: 1 }, text: '' } },
      { placeholder: { options: { name: 'body', type: 'body', x: 1, y: 2, w: 8, h: 3 }, text: 'Prompt here' } }
    ]
  })
  const s1 = p.addSlide({ masterName: 'M' })
  s1.addText('Quarterly review', { placeholder: 'title' })
  s1.addText([
    { text: 'One', options: { bullet: true } },
    { text: 'Two', options: { bullet: true, indentLevel: 1 } },
    { text: 'Three', options: { bullet: { type: 'number' } } }
  ], { placeholder: 'body' })
  s1.addText([
    { text: 'Bold ', options: { bold: true } },
    { text: 'italic ', options: { italic: true } },
    { text: 'under ', options: { underline: { style: 'sng' } } },
    { text: 'struck ', options: { strike: 'sngStrike' } },
    { text: 'serif ', options: { fontFace: 'Georgia' } },
    { text: 'link', options: { hyperlink: { url: 'https://example.com/a' } } }
  ], { x: 1, y: 5.5, w: 6, h: 1, fontSize: 30, color: 'CC0000', align: 'center', lineSpacingMultiple: 1.5 })
  s1.addShape(p.ShapeType.ellipse, { x: 10, y: 1, w: 2, h: 2, fill: { color: '00FF00' } })
  s1.addShape(p.ShapeType.rect, { x: 10, y: 3.5, w: 2, h: 1, fill: { color: 'FFFF00' }, line: { color: '0000FF', width: 3 }, rotate: 45 })
  s1.addShape(p.ShapeType.roundRect, { x: 10, y: 5, w: 2, h: 1, fill: { color: '123456' } })
  s1.addShape(p.ShapeType.triangle, { x: 8, y: 5, w: 1, h: 1, fill: { color: 'ABCDEF' } })
  s1.addShape(p.ShapeType.rightArrow, { x: 8, y: 6.2, w: 1.5, h: 0.8, fill: { color: '654321' } })
  s1.addShape(p.ShapeType.leftArrow, { x: 10, y: 6.2, w: 1.5, h: 0.8, fill: { color: '654321' } })
  s1.addShape(p.ShapeType.line, { x: 1, y: 7, w: 5, h: 0, line: { color: 'FF0000', width: 2 } })
  s1.addShape(p.ShapeType.star5, { x: 7, y: 1, w: 1, h: 1, fill: { color: 'FF8800' } })
  s1.addImage({ data: 'image/png;base64,' + red.toString('base64'), x: 7, y: 2.2, w: 2, h: 1, altText: 'A red box' })
  s1.addNotes('Speaker notes here')
  const s2 = p.addSlide({ masterName: 'M' })
  s2.background = { color: '161A26' }
  s2.addText('Dark slide', { placeholder: 'title', color: 'FFFFFF' })
  s2.addTable([['Name', 'Role'], ['Ann', 'Owner']], { x: 1, y: 2, w: 6 })
  s2.addChart(p.ChartType.bar, [{ name: 'S', labels: ['a', 'b'], values: [1, 2] }], { x: 7, y: 2, w: 4, h: 3 })
  const s3 = p.addSlide({ masterName: 'M' })
  s3.addText('Only a title', { placeholder: 'title' })
  const bytes = await p.write({ outputType: 'nodebuffer' })
  // Take the body placeholder's position off slide 1: it must come from the layout.
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('ppt/slides/slide1.xml').async('string')
  const at = xml.indexOf('type="body"')
  const start = xml.indexOf('<a:xfrm', at)
  const end = xml.indexOf('</a:xfrm>', start) + '</a:xfrm>'.length
  assert.ok(at > 0 && start > at && end > start)
  zip.file('ppt/slides/slide1.xml', xml.slice(0, start) + xml.slice(end))
  return { bytes: await zip.generateAsync({ type: 'uint8array' }), red }
}

test('a pptxgenjs deck with every feature the reader handles', async () => {
  const { bytes, red } = await pptxgenDeck()
  const { doc, built, parsed } = await imported(bytes)
  assert.equal(sm.size(doc).join('x'), '1920x1080')
  const k = 1920 / 12192000
  const ids = sm.slideIds(doc)
  assert.equal(ids.length, 3)
  assert.equal(ids.map((id) => els(doc, id).find((e) => e.role === 'title')?.text).join('|'), 'Quarterly review|Dark slide|Only a title')
  // pptxgenjs puts the master's (empty) body placeholder on every slide.
  assert.equal(ids.map((id) => sm.slide(doc, id).get('layout')).join(), 'content,content,content')

  const one = els(doc, ids[0])
  const body = one.find((e) => e.role === 'body')
  assert.equal(body.text, 'One\nTwo\nThree')
  assert.ok(near(body.frame.x, 914400 * k, 1920) && near(body.frame.y, 1828800 * k, 1080) && near(body.frame.w, 7315200 * k, 1920), JSON.stringify(body.frame))
  assert.ok(!sm.plainText(doc).includes('Prompt here'))
  const kinds = body.map.get('text').toArray().map((n) => n.nodeName).join()
  assert.equal(kinds, 'bulletList,orderedList')

  const box = one.find((e) => e.type === 'text' && e.text.startsWith('Bold'))
  assert.ok(near(box.frame.x, 1 * 914400 * k, 1920) && near(box.frame.y, 5.5 * 914400 * k, 1080) && near(box.frame.w, 6 * 914400 * k, 1920))
  const r = runs(box.map)
  assert.equal(r[0], 'Bold |bold textStyle=color:#cc0000,fontSize:30pt')
  assert.equal(r[1], 'italic |italic textStyle=color:#cc0000,fontSize:30pt')
  assert.equal(r[2], 'under |textStyle=color:#cc0000,fontSize:30pt underline')
  assert.equal(r[3], 'struck |strike textStyle=color:#cc0000,fontSize:30pt')
  assert.equal(r[4], 'serif |textStyle=color:#cc0000,fontFamily:serif,fontSize:30pt')
  assert.ok(r[5].startsWith('link|link=href:https://example.com/a'), r[5])
  const p0 = box.map.get('text').toArray()[0]
  assert.equal(p0.getAttribute('textAlign') + ' ' + p0.getAttribute('lineHeight'), 'center 1.5')

  const shapes = one.filter((e) => e.type === 'shape')
  const style = (e) => { const s = sm.style(e.map); return s.shape + ':' + s.fill + ':' + s.line + ':' + s.lineW + ':' + e.frame.rot }
  assert.equal(shapes.map(style).join(' '), 'ellipse:#00ff00:none:0:0 rect:#ffff00:#0000ff:6:45 roundRect:#123456:none:0:0 triangle:#abcdef:none:0:0 arrow:#654321:none:0:0 arrow:#654321:none:0:180 line:none:#ff0000:4:0 rect:#ff8800:none:0:0')
  const ell = shapes[0].frame
  assert.ok(near(ell.x, 10 * 914400 * k, 1920) && near(ell.y, 914400 * k, 1080) && near(ell.w, 2 * 914400 * k, 1920))

  const pic = one.find((e) => e.type === 'picture')
  assert.equal(pic.map.get('alt'), 'A red box')
  assert.equal(pic.map.get('ref'), 'import:0')
  assert.equal(pic.map.get('pw') + 'x' + pic.map.get('ph'), '40x20')
  assert.ok(near(pic.frame.x, 7 * 914400 * k, 1920) && near(pic.frame.w, 2 * 914400 * k, 1920))
  const media = built.refs.get('import:0')
  assert.equal(b4a.toString(await parsed.readMedia(media), 'hex'), red.toString('hex'))
  assert.equal(sm.plainOf(sm.slide(doc, ids[0]).get('notes')), 'Speaker notes here')

  // Slide 2: its dark background as a rectangle, the table's text kept.
  const two = els(doc, ids[1])
  assert.equal(sm.style(two[0].map).fill + ' ' + two[0].frame.w, '#161a26 1920')
  assert.ok(two.some((e) => e.type === 'text' && e.text === 'Name\tRole\nAnn\tOwner'))
  assert.equal(runs(two.find((e) => e.role === 'title').map).join(), 'Dark slide|textStyle=color:#ffffff')

  const lost = built.lost
  assert.equal(JSON.stringify(Object.keys(lost).sort().map((x) => x + '=' + lost[x])), JSON.stringify(['charts=1', 'otherShapes=1', 'tables=1']))
})

test('bounds: too big, too many slides, a part that unpacks too far and elements past the limit', async () => {
  const f = await load()
  await assert.rejects(f.readPresentation(new Uint8Array(100 * 1024 * 1024 + 1)), /too big/)
  await assert.rejects(f.readPresentation(new Uint8Array([1, 2, 3, 4])), /not a PowerPoint file/)

  const many = await craft({ slides: Array.from({ length: 501 }, () => ({ xml: slideXml('') })) })
  await assert.rejects(f.readPresentation(many), /more than 500 slides/)
  const fine = await craft({ slides: Array.from({ length: 500 }, () => ({ xml: slideXml('') })) })
  assert.equal((await f.readPresentation(fine)).slides.length, 500)

  // A zip that says it unpacks to 4 GB.
  const small = await craft({ slides: [{ xml: slideXml('') }] })
  const big = Buffer.from(small)
  for (let i = big.length - 22; i >= 0; i--) {
    if (big.readUInt32LE(i) === 0x02014b50) big.writeUInt32LE(0xf0000000, i + 24) // central directory: uncompressed size
  }
  await assert.rejects(f.readPresentation(new Uint8Array(big)), /unpacks to more|not a PowerPoint file/)

  // A slide part that says it is small but unpacks to 50 MB.
  const zip = await JSZip.loadAsync(small)
  zip.file('ppt/slides/slide1.xml', slideXml('') + ' '.repeat(50 * 1024 * 1024))
  const lying = Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
  for (let i = 0; i < lying.length - 4; i++) {
    if (lying.readUInt32LE(i) !== 0x02014b50) continue
    const nameLen = lying.readUInt16LE(i + 28)
    if (lying.toString('utf8', i + 46, i + 46 + nameLen) === 'ppt/slides/slide1.xml') lying.writeUInt32LE(1000, i + 24)
  }
  const parsed = await f.readPresentation(new Uint8Array(lying))
  assert.equal(parsed.slides.length, 0)

  // 1005 shapes on a slide: 1000 come in, the rest are counted.
  let tree = ''
  for (let i = 0; i < 1005; i++) tree += '<p:sp>' + nv(100 + i, 'S' + i) + '<p:spPr>' + xfrm(i * 1000, 0, 100000, 100000) + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>'
  const { doc, built } = await imported(await craft({ slides: [{ xml: slideXml(tree, { attrs: ' showMasterSp="0"' }) }] }))
  assert.equal(sm.elements(doc, sm.slideIds(doc)[0]).length, 1000)
  assert.equal(built.lost.elements, 5)
})

test('slides:import makes the deck, stores its pictures and points them at it', async (t) => {
  const f = await load()
  const testnet = await createTestnet(3)
  const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  t.after(async () => {
    try { await e.close() } catch {}
    await testnet.destroy()
    cleanup()
  })
  await e.init({})
  const { bytes, red } = await pptxgenDeck()
  const r = await f.importPresentation(bytes, 'Quarterly.pptx', { prepare, Y, call: (method, args) => call(e, method, args) })
  assert.equal(r.slides, 3)
  assert.equal(r.dropped, true)
  assert.equal(r.notice, 'Left out: 1 chart. Kept as text only: 1 table. Drawn as boxes: 1 shape PearOffice does not have. Fonts and the theme are the closest PearOffice has.')
  const s = await call(e, 'slides:state', { sheetId: r.sheetId })
  assert.equal(s.title, 'Quarterly')
  assert.equal(s.myRole, 'owner')
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  assert.equal(doc.getMap('meta').get('kind'), 'slides')
  assert.equal(sm.slideIds(doc).length, 3)
  const pics = sm.pictureRefs(doc)
  assert.equal(pics.length, 1)
  assert.equal(/^[0-9a-f]{64}:/.test(pics[0].ref), true)
  assert.equal(pics[0].hash.length > 0, true)
  const back = await call(e, 'slides:picture', { sheetId: r.sheetId, ref: pics[0].ref })
  assert.equal(b4a.toString(b4a.from(back.data, 'base64'), 'hex'), red.toString('hex'))
  const list = await call(e, 'sheet:list')
  assert.equal(list.filter((x) => x.sheetId === r.sheetId).map((x) => x.kind + ':' + x.title).join(), 'slides:Quarterly')
  doc.destroy()
})

// LibreOffice's own templates, converted to .pptx by LibreOffice.
const TEMPLATES = '/usr/lib64/libreoffice/share/template/common/presnt'
function soffice () {
  for (const p of ['/usr/bin/soffice', '/usr/local/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']) if (fs.existsSync(p)) return p
  return null
}
const templateDir = [TEMPLATES, '/usr/lib/libreoffice/share/template/common/presnt'].find((d) => fs.existsSync(d))

test('LibreOffice templates', { skip: !soffice() || !templateDir ? 'needs LibreOffice and its templates' : false, timeout: 120000 }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-pptx-'))
  try {
    const names = ['Candy', 'Forestbird', 'Freshes', 'Vintage', 'Yellow_Idea'].filter((n) => fs.existsSync(path.join(templateDir, n + '.otp')))
    execFileSync(soffice(), ['--headless', '-env:UserInstallation=file://' + path.join(out, 'profile'), '--convert-to', 'pptx', '--outdir', out, ...names.map((n) => path.join(templateDir, n + '.otp'))], { stdio: 'ignore', timeout: 100000 })
    for (const n of names) {
      const bytes = fs.readFileSync(path.join(out, n + '.pptx'))
      const zip = await JSZip.loadAsync(bytes)
      const pres = await zip.file('ppt/presentation.xml').async('string')
      const count = (pres.match(/<p:sldId /g) || []).length
      const [cx, cy] = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres).slice(1).map(Number)
      const { doc, built } = await imported(bytes)
      const ids = sm.slideIds(doc)
      assert.equal(ids.length, count, n)
      const [w, h] = sm.size(doc)
      // Each slide's title placeholder, where LibreOffice put it.
      for (let i = 0; i < count; i++) {
        const xml = await zip.file('ppt/slides/slide' + (i + 1) + '.xml').async('string')
        const m = /<p:ph type="(?:title|ctrTitle)"\/><\/p:nvPr><\/p:nvSpPr><p:spPr><a:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(xml)
        if (!m) continue
        const title = els(doc, ids[i]).find((e) => e.role === 'title')
        assert.ok(title, n + ' slide ' + (i + 1) + ' has a title box')
        const [x, y, tw] = m.slice(1).map(Number)
        assert.ok(near(title.frame.x, x * w / cx, w) && near(title.frame.y, y * h / cy, h) && near(title.frame.w, tw * w / cx, w), n + ' ' + JSON.stringify(title.frame))
      }
      assert.equal(typeof built.lost, 'object')
      // Custom shapes and design shapes are drawn now (Candy lost 57 custom
      // shapes and Forestbird 177 design shapes before the follow-ups).
      assert.equal(built.lost.customShapes || 0, 0, n)
      assert.ok((built.lost.designShapes || 0) <= 2, n + ' ' + JSON.stringify(built.lost))
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})
