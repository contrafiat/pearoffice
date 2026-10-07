// Smoke test part "slides-import": a .pptx made here (by hand, with Node's
// zlib, so the packaged app can run it too) imported through Import a file
// (src/ui/slides/pptxImport.js). The deck must open with its two slides in
// order, the title in the title box, the bullets, a shape, a see-through
// custom shape, the picture drawn from its stored bytes, a chart drawn in
// the editor and the show (proposals/2026-10-06-slides-followups.md) and
// the notice of what was left out.
//
// PEAROFFICE_SMOKE_IMPORT_FILE=<a .pptx> imports that file instead (only
// checks that it opens) and PEAROFFICE_SMOKE_IMPORT_SHOTS=<folder> saves a
// screenshot of each slide's stage there, to compare with the original.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const CRC = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC[n] = c >>> 0
}
function crc32 (buf) {
  let c = 0xffffffff
  for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// A zip of [name, Buffer] entries, deflated.
function zip (entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data] of entries) {
    const n = Buffer.from(name)
    const packed = zlib.deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(n.length, 26)
    parts.push(local, n, packed)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(8, 10)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(packed.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += 30 + n.length + packed.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

// A w x h PNG of one colour.
function png (w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, c])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(w, 0)
  head.writeUInt32BE(h, 4)
  head[8] = 8
  head[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const rels = (list) => '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}${type}" Target="${target}"/>`).join('') + '</Relationships>'
const HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`
const ph = (id, type, idx, body) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="P${id}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${idx ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr/>${body ? `<p:txBody><a:bodyPr/>${body}</p:txBody>` : ''}</p:sp>`
const p = (text, lvl = 0) => `<a:p><a:pPr lvl="${lvl}"/><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p>`

// Two 16:9 slides: a title and bullets placed by the layout, then a
// picture, a shape, a text box and a column chart, with a transition that
// is left out.
function smokeDeck () {
  const pic = png(64, 32, [200, 40, 40])
  const master = `<p:sldMaster ${NS}><p:cSld><p:spTree>${HEAD}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(838200, 365125, 10515600, 1325563)}</p:spPr></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(838200, 1825625, 10515600, 4351338)}</p:spPr></p:sp>` +
    '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr><a:buChar char="•"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle></p:txStyles></p:sldMaster>'
  const layout = `<p:sldLayout ${NS} type="obj"><p:cSld><p:spTree>${HEAD}${ph(2, 'title')}${ph(3, 'body', 1)}</p:spTree></p:cSld></p:sldLayout>`
  const slide1 = `<p:sld ${NS}><p:cSld><p:spTree>${HEAD}${ph(2, 'title', null, p('Imported deck'))}${ph(3, 'body', 1, p('First point') + p('Second point') + p('Deeper', 1))}</p:spTree></p:cSld></p:sld>`
  const slide2 = `<p:sld ${NS}><p:cSld><p:spTree>${HEAD}` +
    `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Pic" descr="A red box"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdP"/></p:blipFill><p:spPr>${xfrm(1000000, 1000000, 4000000, 2000000)}</p:spPr></p:pic>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="5" name="E"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(7000000, 1000000, 2000000, 2000000)}<a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="2266CC"/></a:solidFill></p:spPr></p:sp>` +
    // A custom shape with a curve (proposals/2026-10-06-slides-followups.md).
    `<p:sp><p:nvSpPr><p:cNvPr id="7" name="C"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(9500000, 1000000, 2000000, 2000000)}<a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:cubicBezTo><a:pt x="0" y="0"/><a:pt x="100" y="0"/><a:pt x="100" y="100"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="CC8822"><a:alpha val="50000"/></a:srgbClr></a:solidFill></p:spPr></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="6" name="X"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(1000000, 4000000, 6000000, 800000)}<a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="2400" b="1"/><a:t>Picture slide</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="7000000" y="3500000"/><a:ext cx="4500000" cy="2800000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdC"/></a:graphicData></a:graphic></p:graphicFrame>` +
    '</p:spTree></p:cSld><p:transition><p:fade/></p:transition></p:sld>'
  const pt = (vals) => `<c:ptCount val="${vals.length}"/>` + vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')
  const chart = '<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>' +
    '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Imported chart</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
    `<c:ser><c:idx val="0"/><c:tx><c:v>Sales</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="2266CC"/></a:solidFill></c:spPr><c:cat><c:strRef><c:strCache>${pt(['Q1', 'Q2', 'Q3'])}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache>${pt([3, 5, 2])}</c:numCache></c:numRef></c:val></c:ser>` +
    '</c:barChart></c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>'
  const theme = `<a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="C"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1></a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])],
    ['ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', rels([['rId1', 'slide', 'slides/slide1.xml'], ['rId2', 'slide', 'slides/slide2.xml'], ['rId3', 'slideMaster', 'slideMasters/slideMaster1.xml']])],
    ['ppt/slideMasters/slideMaster1.xml', master],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', layout],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])],
    ['ppt/theme/theme1.xml', theme],
    ['ppt/slides/slide1.xml', slide1],
    ['ppt/slides/_rels/slide1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])],
    ['ppt/slides/slide2.xml', slide2],
    ['ppt/slides/_rels/slide2.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rIdP', 'image', '../media/image1.png'], ['rIdC', 'chart', '../charts/chart1.xml']])],
    ['ppt/charts/chart1.xml', chart]
  ].map(([n, s]) => [n, Buffer.from(s)])
  files.push(['ppt/media/image1.png', pic])
  return zip(files)
}

module.exports = async function slidesImport (t) {
  await t.js("window.__slideErrors = []; window.addEventListener('error', (e) => window.__slideErrors.push(String(e.message)))")
  try {
    return await run(t)
  } catch (err) {
    const errors = await t.js('window.__slideErrors').catch(() => null)
    throw new Error(err.message + (errors && errors.length ? ' (page errors: ' + errors.slice(0, 3).join(' | ') + ')' : ''))
  }
}

async function run (t) {
  const { wc, js, step, waitFor, result, sleep } = t
  const own = process.env.PEAROFFICE_SMOKE_IMPORT_FILE
  const shots = process.env.PEAROFFICE_SMOKE_IMPORT_SHOTS
  const bytes = own ? fs.readFileSync(own) : smokeDeck()
  const name = own ? path.basename(own) : 'Smoke deck.pptx'
  const title = name.replace(/\.[^.]+$/, '')
  const count = "document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]').length"

  await js(`(() => {
    const b = atob(${JSON.stringify(bytes.toString('base64'))})
    const u = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([u], ${JSON.stringify(name)}))
    const input = document.querySelector('.import input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor('imported deck open', `!!document.querySelector('.slides .slide-stage .slide') && document.querySelector('.toolbar .title').value === ${JSON.stringify(title)}`, 40000)
  step('deck open')

  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    const n = await js(count)
    for (let i = 0; i < n; i++) {
      await js(`document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]')[${i}].click()`)
      await sleep(1500) // pictures arrive
      const r = await js("(() => { const b = document.querySelector('.slide-stage .slide').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) } })()")
      fs.writeFileSync(path.join(shots, 'slide' + (i + 1) + '.png'), (await wc.capturePage(r)).toPNG())
    }
    step('screenshots', n)
  }
  if (own) {
    result.importedSlides = await js(count)
    result.notice = await js("(document.querySelector('.banner.info') || {}).textContent || ''")
    return true
  }

  await waitFor('two slides', `${count} === 2`)
  const titles = await js("(document.querySelector('.slide-stage .slide-el[data-role=title]') || {}).textContent")
  if (titles !== 'Imported deck') throw new Error('title box shows ' + JSON.stringify(titles))
  await waitFor('bullets', "document.querySelectorAll('.slide-stage .slide-el[data-role=body] ul li').length === 3 && document.querySelectorAll('.slide-stage .slide-el[data-role=body] ul ul li').length === 1")
  result.importTitle = true
  step('slide 1: title and bullets')

  await js("document.querySelectorAll('.slide-thumbs .slide-thumb[data-id]')[1].click()")
  await waitFor('slide 2', "!!document.querySelector('.slide-stage .slide-el[data-type=shape] [data-shape=ellipse]') && [...document.querySelectorAll('.slide-stage .slide-el[data-type=text]')].some((e) => e.textContent === 'Picture slide')")
  // The picture comes from its stored bytes: drawn and 64 by 32.
  await waitFor('picture drawn', "(() => { const i = document.querySelector('.slide-stage img.slide-picture'); return !!i && i.complete && i.naturalWidth === 64 && i.naturalHeight === 32 && i.alt === 'A red box' })()", 20000)
  result.importPicture = true
  // The custom shape: its curve drawn at half opacity.
  result.importCustom = await js("(() => { const p = document.querySelector('.slide-stage .slide-el[data-type=shape] svg[data-shape=custom] path'); return !!p && /C/.test(p.getAttribute('d')) && p.parentNode.getAttribute('fill') === '#cc8822' && p.parentNode.getAttribute('fill-opacity') === '0.5' })()")
  if (!result.importCustom) throw new Error('custom shape not drawn')
  step('slide 2: picture, shapes and text')

  // The chart: its title and three bars in its own colour, in the editor
  // and the show.
  const chartDrawn = (root) => `(() => { const s = document.querySelector('${root} .slide-el[data-type=chart] .slide-chart svg'); return !!s && [...s.querySelectorAll('text')].some((x) => x.textContent === 'Imported chart') && [...s.querySelectorAll('path[ecmeta_ssr_type=chart]')].filter((x) => x.getAttribute('fill') === '#2266cc').length === 3 })()`
  await waitFor('chart drawn', chartDrawn('.slide-stage'))
  process.env.PEAROFFICE_FAKE_DISPLAYS = '1'
  await js("document.querySelector('.present-button').click()")
  await waitFor('chart in the show', chartDrawn('.show'))
  await t.key('Escape')
  await waitFor('show ended', "!document.querySelector('.show')")
  result.importChart = true
  step('chart in the editor and the show')

  const notice = await js("(document.querySelector('.banner.info') || {}).textContent || ''")
  if (!notice.includes('Left out: 1 slide transition.')) throw new Error('notice: ' + JSON.stringify(notice))
  result.importNotice = true
  step('notice')

  // Reopened from the file list, it is the same deck.
  await js("document.querySelector('.sheet-link.all-files').click()")
  await waitFor('deck in all files', `[...document.querySelectorAll('.file-card')].some((c) => !!c.querySelector('.kind-icon.kind-slides') && c.querySelector('.file-title').textContent === ${JSON.stringify(title)})`)
  await js(`[...document.querySelectorAll('.file-card')].find((c) => c.querySelector('.file-title').textContent === ${JSON.stringify(title)}).click()`)
  await waitFor('deck reopened', `${count} === 2 && (document.querySelector('.slide-stage .slide-el[data-role=title]') || {}).textContent === 'Imported deck'`)
  step('reopened')
  return true
}
