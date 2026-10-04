// Charts in .xlsx files (proposals/2026-10-04-charts.md). SheetJS Community
// Edition writes no charts, so after it has written the workbook this adds,
// per chart, a DrawingML chart part; per tab with charts, a drawing part that
// places them; and the relationships and content types that join them up.
// Each series refers to its cells and carries their current values, so
// Excel and LibreOffice draw the chart at once and redraw it from the cells.
//
// `fflate` (zip) and the chart data are passed in; nothing here reads the
// clock or the device.

const { parseRange } = require('./charts')
const { numToCol } = require('./a1')

const PALETTE = ['5B8C3A', '2F7D8C', 'D9822B', '6A4C93', 'A23E48', '3A5F8C', '8C7A2F', 'C45A8A']
const EMU = 9525 // per pixel
const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const quoteSheet = (name) => "'" + String(name).replace(/'/g, "''") + "'"
const ref = (sheet, r1, c1, r2, c2) => quoteSheet(sheet) + '!$' + numToCol(c1) + '$' + r1 + (r2 === r1 && c2 === c1 ? '' : ':$' + numToCol(c2) + '$' + r2)
const num = (v) => (typeof v === 'number' && isFinite(v) ? String(v) : null)

function strRef (f, values) {
  return '<c:strRef><c:f>' + esc(f) + '</c:f><c:strCache><c:ptCount val="' + values.length + '"/>' +
    values.map((v, i) => '<c:pt idx="' + i + '"><c:v>' + esc(v) + '</c:v></c:pt>').join('') + '</c:strCache></c:strRef>'
}
function numRef (f, values) {
  return '<c:numRef><c:f>' + esc(f) + '</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="' + values.length + '"/>' +
    values.map((v, i) => (num(v) === null ? '' : '<c:pt idx="' + i + '"><c:v>' + num(v) + '</c:v></c:pt>')).join('') + '</c:numCache></c:numRef>'
}
const text = (t) => '<c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>' + esc(t) + '</a:t></a:r></a:p></c:rich></c:tx>'
const title = (t) => '<c:title>' + text(t) + '<c:overlay val="0"/></c:title>'
const fill = (i) => '<c:spPr><a:solidFill><a:srgbClr val="' + PALETTE[i % PALETTE.length] + '"/></a:solidFill></c:spPr>'
const line = (i) => '<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="' + PALETTE[i % PALETTE.length] + '"/></a:solidFill></a:ln></c:spPr>'

// Where each series, its name and the categories sit in the sheet.
function layout (chart, sheet) {
  const range = parseRange(chart.data)
  const d = chart.resolved
  const rows = chart.seriesIn === 'rows'
  const labels = chart.labels || {}
  const nameLine = rows ? !!labels.col : !!labels.row // names at the start of each series
  const catLine = rows ? !!labels.row : !!labels.col // categories before the first series
  const firstSeries = catLine || chart.type === 'scatter' ? 1 : 0
  const n = d.categories.length
  const start = rows ? range.c1 : range.r1 // along a series
  const across = rows ? range.r1 : range.c1 // series after series
  const at = (along, k) => (rows ? [across + k, along] : [along, across + k]) // [row, col]
  const span = (k) => {
    const [r1, c1] = at(start + (nameLine ? 1 : 0), k)
    const [r2, c2] = at(start + (nameLine ? 1 : 0) + n - 1, k)
    return ref(range.sheet || sheet, r1, c1, r2, c2)
  }
  return {
    categories: catLine || chart.type === 'scatter' ? span(0) : null,
    series: d.series.map((s, i) => {
      const [nr, nc] = at(start, firstSeries + i)
      return { ...s, name: s.name, nameRef: nameLine ? ref(range.sheet || sheet, nr, nc, nr, nc) : null, valuesRef: span(firstSeries + i) }
    })
  }
}

function seriesXml (chart, s, i, place, kind) {
  const tx = s.nameRef ? '<c:tx>' + strRef(s.nameRef, [s.name]) + '</c:tx>' : '<c:tx><c:v>' + esc(s.name) + '</c:v></c:tx>'
  const cats = chart.resolved.categories
  let xml = '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + tx
  if (kind === 'scatter') {
    // Points only: no line between them, a filled circle each.
    xml += '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/>' + fill(i) + '</c:marker>'
  } else {
    xml += kind === 'line' ? line(i) : (kind === 'pie' ? '' : fill(i))
    if (kind === 'line') xml += '<c:marker><c:symbol val="none"/></c:marker>'
  }
  if (kind === 'pie') xml += cats.map((_, k) => '<c:dPt><c:idx val="' + k + '"/><c:bubble3D val="0"/>' + fill(k) + '</c:dPt>').join('')
  if (chart.dataLabels) xml += '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
  if ((chart.trendline || []).includes(i) && kind !== 'pie') xml += '<c:trendline><c:trendlineType val="linear"/><c:dispRSqr val="1"/><c:dispEq val="0"/></c:trendline>'
  if (kind === 'scatter') {
    xml += '<c:xVal>' + numRef(place.categories, cats) + '</c:xVal><c:yVal>' + numRef(s.valuesRef, s.values) + '</c:yVal><c:smooth val="0"/>'
  } else {
    if (place.categories) xml += '<c:cat>' + strRef(place.categories, cats.map(String)) + '</c:cat>'
    else xml += '<c:cat>' + '<c:strLit><c:ptCount val="' + cats.length + '"/>' + cats.map((c, k) => '<c:pt idx="' + k + '"><c:v>' + esc(c) + '</c:v></c:pt>').join('') + '</c:strLit></c:cat>'
    xml += '<c:val>' + numRef(s.valuesRef, s.values) + '</c:val>'
    if (kind === 'line') xml += '<c:smooth val="0"/>'
  }
  return xml + '</c:ser>'
}

function axes (chart, catId, valId, { secondary = false, horizontal = false, scatter = false } = {}) {
  const valPos = horizontal ? 'b' : secondary ? 'r' : 'l'
  const catPos = horizontal ? 'l' : 'b'
  const scaling = '<c:scaling>' + (chart.logScale ? '<c:logBase val="10"/>' : '') + '<c:orientation val="minMax"/>' +
    (chart.percent ? '<c:max val="1"/><c:min val="0"/>' : (num(chart.yMax) ? '<c:max val="' + num(chart.yMax) + '"/>' : '') + (num(chart.yMin) ? '<c:min val="' + num(chart.yMin) + '"/>' : '')) + '</c:scaling>'
  const cat = scatter
    ? '<c:valAx><c:axId val="' + catId + '"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>' + (chart.xTitle ? title(chart.xTitle) : '') + '<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="' + valId + '"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>'
    : '<c:catAx><c:axId val="' + catId + '"/><c:scaling><c:orientation val="' + (horizontal ? 'maxMin' : 'minMax') + '"/></c:scaling><c:delete val="' + (secondary ? 1 : 0) + '"/><c:axPos val="' + catPos + '"/>' + (!secondary && chart.xTitle ? title(chart.xTitle) : '') + '<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="' + valId + '"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
  const val = '<c:valAx><c:axId val="' + valId + '"/>' + scaling + '<c:delete val="0"/><c:axPos val="' + valPos + '"/>' + (secondary ? '' : '<c:majorGridlines/>') +
    (!secondary && chart.yTitle ? title(chart.yTitle) : '') +
    '<c:numFmt formatCode="' + esc(chart.percent ? '0%' : chart.yFormat || 'General') + '" sourceLinked="' + (chart.yFormat || chart.percent ? 0 : 1) + '"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="' + catId + '"/><c:crosses val="' + (secondary ? 'max' : 'autoZero') + '"/><c:crossBetween val="' + (scatter ? 'midCat' : 'between') + '"/></c:valAx>'
  return cat + val
}

// The chart part for one chart.
function chartXml (chart, sheet) {
  const place = layout(chart, sheet)
  const type = chart.type || 'column'
  const grouping = chart.percent ? 'percentStacked' : chart.stacked ? 'stacked' : null
  const all = place.series.map((s, i) => ({ s, i }))
  let plot = ''
  const ids = (a, b) => '<c:axId val="' + a + '"/><c:axId val="' + b + '"/>'
  const bars = (list, horizontal, axA, axB) => '<c:barChart><c:barDir val="' + (horizontal ? 'bar' : 'col') + '"/><c:grouping val="' + (grouping || 'clustered') + '"/><c:varyColors val="' + (list.length === 1 && type !== 'combo' ? 1 : 0) + '"/>' +
    list.map(({ s, i }) => seriesXml(chart, s, i, place, 'bar')).join('') + '<c:gapWidth val="80"/>' + (grouping ? '<c:overlap val="100"/>' : '') + ids(axA, axB) + '</c:barChart>'
  const lines = (list, area, axA, axB) => '<c:' + (area ? 'area' : 'line') + 'Chart><c:grouping val="' + (grouping || 'standard') + '"/><c:varyColors val="0"/>' +
    list.map(({ s, i }) => seriesXml(chart, s, i, place, area ? 'bar' : 'line')).join('') + (area ? '' : '<c:marker val="1"/>') + ids(axA, axB) + '</c:' + (area ? 'area' : 'line') + 'Chart>'
  if (type === 'pie' || type === 'doughnut') {
    const s = place.series[0]
    plot = '<c:' + (type === 'pie' ? 'pie' : 'doughnut') + 'Chart><c:varyColors val="1"/>' + (s ? seriesXml(chart, s, 0, place, 'pie') : '') +
      (type === 'doughnut' ? '<c:firstSliceAng val="0"/><c:holeSize val="50"/>' : '<c:firstSliceAng val="0"/>') + '</c:' + (type === 'pie' ? 'pie' : 'doughnut') + 'Chart>'
  } else if (type === 'scatter') {
    plot = '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>' +
      all.map(({ s, i }) => seriesXml(chart, s, i, place, 'scatter')).join('') +
      ids(500, 600) + '</c:scatterChart>' + axes(chart, 500, 600, { scatter: true })
  } else if (type === 'combo') {
    const lineSet = new Set(chart.lineSeries || [])
    const second = new Set(chart.secondAxis || [])
    const group = (isLine, onSecond) => all.filter(({ i }) => lineSet.has(i) === isLine && second.has(i) === onSecond)
    for (const onSecond of [false, true]) {
      const [a, b] = onSecond ? [300, 400] : [100, 200]
      const barList = group(false, onSecond)
      const lineList = group(true, onSecond)
      if (barList.length) plot += bars(barList, false, a, b)
      if (lineList.length) plot += lines(lineList, false, a, b)
    }
    plot += axes(chart, 100, 200)
    if (all.some(({ i }) => second.has(i))) plot += axes(chart, 300, 400, { secondary: true })
  } else if (type === 'line' || type === 'area') {
    plot = lines(all, type === 'area', 100, 200) + axes(chart, 100, 200)
  } else {
    plot = bars(all, type === 'bar', 100, 200) + axes(chart, 100, 200, { horizontal: type === 'bar' })
  }
  const legendPos = chart.legend === 'right' ? 'r' : 'b'
  const showLegend = chart.legend ? chart.legend !== 'none' : place.series.length > 1 || type === 'pie' || type === 'doughnut'
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ' + NS + '><c:roundedCorners val="0"/><c:chart>' +
    (chart.title ? title(chart.title) + '<c:autoTitleDeleted val="0"/>' : '<c:autoTitleDeleted val="1"/>') +
    '<c:plotArea><c:layout/>' + plot + '</c:plotArea>' +
    (showLegend ? '<c:legend><c:legendPos val="' + legendPos + '"/><c:overlay val="0"/></c:legend>' : '') +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>'
}

// Where a chart starts: its anchor cell and offset, in EMUs.
function anchorXml (chart, rid, n) {
  const a = chart.anchor
  return '<xdr:oneCellAnchor><xdr:from><xdr:col>' + (a.col - 1) + '</xdr:col><xdr:colOff>' + Math.round(a.dx * EMU) + '</xdr:colOff><xdr:row>' + (a.row - 1) +
    '</xdr:row><xdr:rowOff>' + Math.round(a.dy * EMU) + '</xdr:rowOff></xdr:from><xdr:ext cx="' + Math.round(chart.size.w * EMU) + '" cy="' + Math.round(chart.size.h * EMU) + '"/>' +
    '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (n + 1) + '" name="' + esc(chart.title || 'Chart ' + n) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="' + rid + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>'
}

const DRAWING_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
const CHART_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'
const rels = (list) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list.map(([id, type, target]) => '<Relationship Id="' + id + '" Type="' + type + '" Target="' + target + '"/>').join('') + '</Relationships>'

// bytes: the workbook SheetJS wrote. tabs: [{ name, charts }] in sheet
// order; only charts with data are written. Returns the new bytes.
function addChartsToXlsx (bytes, tabs, { unzipSync, zipSync, strToU8, strFromU8 }) {
  if (!tabs.some((t) => (t.charts || []).some((c) => c.resolved && !c.resolved.error))) return bytes
  const files = unzipSync(bytes)
  let types = strFromU8(files['[Content_Types].xml'])
  let chartNo = 0
  let drawingNo = 0
  tabs.forEach((tab, t) => {
    const charts = (tab.charts || []).filter((c) => c.resolved && !c.resolved.error && parseRange(c.data))
    if (!charts.length) return
    const sheetPath = 'xl/worksheets/sheet' + (t + 1) + '.xml'
    if (!files[sheetPath]) return
    drawingNo++
    const anchors = []
    const drawingRels = []
    charts.forEach((chart, k) => {
      chartNo++
      files['xl/charts/chart' + chartNo + '.xml'] = strToU8(chartXml(chart, tab.name))
      types = types.replace('</Types>', '<Override PartName="/xl/charts/chart' + chartNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>')
      drawingRels.push(['rId' + (k + 1), CHART_TYPE, '../charts/chart' + chartNo + '.xml'])
      anchors.push(anchorXml(chart, 'rId' + (k + 1), k + 1))
    })
    files['xl/drawings/drawing' + drawingNo + '.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + anchors.join('') + '</xdr:wsDr>')
    files['xl/drawings/_rels/drawing' + drawingNo + '.xml.rels'] = strToU8(rels(drawingRels))
    types = types.replace('</Types>', '<Override PartName="/xl/drawings/drawing' + drawingNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>')
    // The tab points at its drawing, in the place the schema wants it.
    const relsPath = 'xl/worksheets/_rels/sheet' + (t + 1) + '.xml.rels'
    const existing = files[relsPath] ? strFromU8(files[relsPath]) : rels([])
    const rid = 'rIdDrawing' + drawingNo
    files[relsPath] = strToU8(existing.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + DRAWING_TYPE + '" Target="../drawings/drawing' + drawingNo + '.xml"/></Relationships>'))
    let sheet = strFromU8(files[sheetPath])
    const before = /<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/.exec(sheet)
    sheet = sheet.slice(0, before.index) + '<drawing r:id="' + rid + '"/>' + sheet.slice(before.index)
    files[sheetPath] = strToU8(sheet)
  })
  files['[Content_Types].xml'] = strToU8(types)
  return zipSync(files)
}

module.exports = { addChartsToXlsx, chartXml }
