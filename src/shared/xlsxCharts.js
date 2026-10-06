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
const { chartStyleXml, CHART_COLORS_XML } = require('./xlsxChartexStyle')

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
function numRef (f, values, format) {
  return '<c:numRef><c:f>' + esc(f) + '</c:f><c:numCache><c:formatCode>' + esc(format || 'General') + '</c:formatCode><c:ptCount val="' + values.length + '"/>' +
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
  const xFirst = chart.type === 'scatter' || chart.type === 'bubble'
  const firstSeries = catLine || xFirst ? 1 : 0
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
    categories: catLine || xFirst ? span(0) : null,
    series: d.series.map((s, i) => {
      const [nr, nc] = at(start, firstSeries + i)
      return { ...s, name: s.name, nameRef: nameLine ? ref(range.sheet || sheet, nr, nc, nr, nc) : null, valuesRef: span(firstSeries + i) }
    })
  }
}

function seriesXml (chart, s, i, place, kind, size) {
  const tx = s.nameRef ? '<c:tx>' + strRef(s.nameRef, [s.name]) + '</c:tx>' : '<c:tx><c:v>' + esc(s.name) + '</c:v></c:tx>'
  const cats = chart.resolved.categories
  let xml = '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + tx
  if (kind === 'bubble') {
    // X, Y and size; no data labels or trend lines here.
    return xml + fill(i) + '<c:invertIfNegative val="0"/><c:xVal>' + numRef(place.categories, cats, chart.resolved.xFormat) + '</c:xVal><c:yVal>' + numRef(s.valuesRef, s.values, s.format) + '</c:yVal>' +
      '<c:bubbleSize>' + numRef(size.valuesRef, size.values, size.format) + '</c:bubbleSize><c:bubble3D val="0"/></c:ser>'
  }
  if (kind === 'stock' || kind === 'radar') {
    xml += kind === 'stock' ? '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>' : line(i)
    xml += '<c:marker><c:symbol val="none"/></c:marker>'
    if (place.categories) xml += '<c:cat>' + strRef(place.categories, cats.map(String)) + '</c:cat>'
    return xml + '<c:val>' + numRef(s.valuesRef, s.values, s.format) + '</c:val>' + (kind === 'stock' ? '<c:smooth val="0"/>' : '') + '</c:ser>'
  }
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
    xml += '<c:xVal>' + numRef(place.categories, cats, chart.resolved.xFormat) + '</c:xVal><c:yVal>' + numRef(s.valuesRef, s.values, s.format) + '</c:yVal><c:smooth val="0"/>'
  } else {
    if (place.categories) xml += '<c:cat>' + strRef(place.categories, cats.map(String)) + '</c:cat>'
    else xml += '<c:cat>' + '<c:strLit><c:ptCount val="' + cats.length + '"/>' + cats.map((c, k) => '<c:pt idx="' + k + '"><c:v>' + esc(c) + '</c:v></c:pt>').join('') + '</c:strLit></c:cat>'
    xml += '<c:val>' + numRef(s.valuesRef, s.values, s.format) + '</c:val>'
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
  if (type === 'radar') {
    plot = '<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>' + all.map(({ s, i }) => seriesXml(chart, s, i, place, 'radar')).join('') +
      ids(100, 200) + '</c:radarChart>' + axes(chart, 100, 200)
  } else if (type === 'bubble') {
    const pairs = []
    for (let k = 0; k + 1 < place.series.length; k += 2) pairs.push([place.series[k], place.series[k + 1]])
    plot = '<c:bubbleChart><c:varyColors val="0"/>' + pairs.map(([y, z], i) => seriesXml(chart, y, i, place, 'bubble', z)).join('') +
      '<c:bubbleScale val="100"/><c:showNegBubbles val="0"/>' + ids(500, 600) + '</c:bubbleChart>' + axes(chart, 500, 600, { scatter: true })
  } else if (type === 'stock') {
    const solid = (hex) => '<c:spPr><a:solidFill><a:srgbClr val="' + hex + '"/></a:solidFill></c:spPr>'
    plot = '<c:stockChart>' + place.series.slice(0, 4).map((s, i) => seriesXml(chart, s, i, place, 'stock')).join('') +
      '<c:hiLowLines/><c:upDownBars><c:gapWidth val="150"/><c:upBars>' + solid('3C9A5F') + '</c:upBars><c:downBars>' + solid('C0392B') + '</c:downBars></c:upDownBars>' +
      ids(100, 200) + '</c:stockChart>' + axes(chart, 100, 200)
  } else if (type === 'pie' || type === 'doughnut') {
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
  const showLegend = type === 'stock' ? false : chart.legend ? chart.legend !== 'none' : place.series.length > 1 || type === 'pie' || type === 'doughnut'
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ' + NS + '><c:roundedCorners val="0"/><c:chart>' +
    (chart.title ? title(chart.title) + '<c:autoTitleDeleted val="0"/>' : '<c:autoTitleDeleted val="1"/>') +
    '<c:plotArea><c:layout/>' + plot + '</c:plotArea>' +
    (showLegend ? '<c:legend><c:legendPos val="' + legendPos + '"/><c:overlay val="0"/></c:legend>' : '') +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>'
}

// Histogram and waterfall (proposals/2026-10-05-more-chart-types.md) go out
// only in Excel's newer chart format (chartex), reading the cells.
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex'
// nameFor(ref): Excel points these charts at hidden workbook names
// (_xlchart.v1.N) rather than at cells; the caller adds the names.
function chartexXml (chart, sheet, nameFor = (ref) => ref) {
  const place = layout(chart, sheet)
  const d = chart.resolved
  const pts = (values, str) => values.map((v, k) => (str || num(v) !== null ? '<cx:pt idx="' + k + '">' + esc(str ? String(v) : num(v)) + '</cx:pt>' : '')).join('')
  const series = chart.type === 'histogram' ? place.series : place.series.slice(0, 1)
  let data = ''
  series.forEach((s, i) => {
    data += '<cx:data id="' + i + '">'
    if (chart.type === 'waterfall' && place.categories) data += '<cx:strDim type="cat"><cx:f>' + esc(nameFor(place.categories)) + '</cx:f><cx:lvl ptCount="' + d.categories.length + '">' + pts(d.categories, true) + '</cx:lvl></cx:strDim>'
    data += '<cx:numDim type="val"><cx:f>' + esc(nameFor(s.valuesRef)) + '</cx:f><cx:lvl ptCount="' + s.values.length + '" formatCode="General">' + pts(s.values) + '</cx:lvl></cx:numDim></cx:data>'
  })
  const layoutPr = chart.type === 'histogram'
    ? '<cx:layoutPr><cx:binning intervalClosed="r">' + (Number(chart.binWidth) > 0 ? '<cx:binSize val="' + Number(chart.binWidth) + '"/>' : '') + '</cx:binning></cx:layoutPr>'
    : '<cx:layoutPr><cx:subtotals>' + (chart.totals || []).map((k) => '<cx:idx val="' + k + '"/>').join('') + '</cx:subtotals></cx:layoutPr>'
  const ser = series.map((s, i) => '<cx:series layoutId="' + (chart.type === 'histogram' ? 'clusteredColumn' : 'waterfall') + '" uniqueId="{0000000' + i + '-0000-4000-8000-000000000000}">' +
    '<cx:tx><cx:txData>' + (s.nameRef ? '<cx:f>' + esc(nameFor(s.nameRef)) + '</cx:f>' : '') + '<cx:v>' + esc(s.name) + '</cx:v></cx:txData></cx:tx><cx:dataId val="' + i + '"/>' + layoutPr + '</cx:series>').join('')
  const ctitle = chart.title ? '<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>' + esc(chart.title) + '</cx:v></cx:txData></cx:tx></cx:title>' : ''
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cx:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:cx="' + CX + '">' +
    '<cx:chartData>' + data + '</cx:chartData><cx:chart>' + ctitle + '<cx:plotArea><cx:plotAreaRegion>' + ser + '</cx:plotAreaRegion>' +
    '<cx:axis id="0"><cx:catScaling gapWidth="' + (chart.type === 'histogram' ? '0' : '0.5') + '"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>' +
    '</cx:plotArea></cx:chart></cx:chartSpace>'
}

// Where a chart starts: its anchor cell and offset, in EMUs.
// ex: the chart is in Excel's newer format (rid points at its chartex part).
// Its fallback is a text box, as Excel writes it: Excel for the web refused
// a classic chart there. LibreOffice reads the chartex part itself.
function anchorXml (chart, rid, n, ex) {
  const a = chart.anchor
  const frame = (uri, inner) => '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (n + 1) + '" name="' + esc(chart.title || 'Chart ' + n) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="' + uri + '">' + inner + '</a:graphicData></a:graphic></xdr:graphicFrame>'
  const w = Math.round(chart.size.w * EMU)
  const h = Math.round(chart.size.h * EMU)
  const textBox = '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr>' +
    '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
    '<xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>This chart needs a newer version of Excel.</a:t></a:r></a:p></xdr:txBody></xdr:sp>'
  const body = ex
    ? '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1">' +
      frame(CX, '<cx:chart xmlns:cx="' + CX + '" r:id="' + rid + '"/>') + '</mc:Choice><mc:Fallback>' + textBox + '</mc:Fallback></mc:AlternateContent>'
    : frame('http://schemas.openxmlformats.org/drawingml/2006/chart', '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="' + rid + '"/>')
  return '<xdr:oneCellAnchor><xdr:from><xdr:col>' + (a.col - 1) + '</xdr:col><xdr:colOff>' + Math.round(a.dx * EMU) + '</xdr:colOff><xdr:row>' + (a.row - 1) +
    '</xdr:row><xdr:rowOff>' + Math.round(a.dy * EMU) + '</xdr:rowOff></xdr:from><xdr:ext cx="' + w + '" cy="' + h + '"/>' +
    body + '<xdr:clientData/></xdr:oneCellAnchor>'
}

const DRAWING_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
const CHART_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'
const CHARTEX_TYPE = 'http://schemas.microsoft.com/office/2014/relationships/chartEx'
const CHART_STYLE_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/chartStyle'
const CHART_COLORS_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle'
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
  const xlNames = [] // [name, ref] for Excel's newer charts
  const nameFor = (ref) => { const n = '_xlchart.v1.' + xlNames.length; xlNames.push([n, ref]); return n }
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
      const rid = 'rId' + (k + 1)
      const ex = chart.type === 'histogram' || chart.type === 'waterfall'
      if (ex) {
        // Excel's newer format, with the style and colour parts Excel adds.
        files['xl/charts/chartEx' + chartNo + '.xml'] = strToU8(chartexXml(chart, tab.name, nameFor))
        files['xl/charts/style' + chartNo + '.xml'] = strToU8(chartStyleXml(chart.type))
        files['xl/charts/colors' + chartNo + '.xml'] = strToU8(CHART_COLORS_XML)
        files['xl/charts/_rels/chartEx' + chartNo + '.xml.rels'] = strToU8(rels([['rId1', CHART_STYLE_TYPE, 'style' + chartNo + '.xml'], ['rId2', CHART_COLORS_TYPE, 'colors' + chartNo + '.xml']]))
        types = types.replace('</Types>', '<Override PartName="/xl/charts/chartEx' + chartNo + '.xml" ContentType="application/vnd.ms-office.chartex+xml"/>' +
          '<Override PartName="/xl/charts/style' + chartNo + '.xml" ContentType="application/vnd.ms-office.chartstyle+xml"/>' +
          '<Override PartName="/xl/charts/colors' + chartNo + '.xml" ContentType="application/vnd.ms-office.chartcolorstyle+xml"/></Types>')
        drawingRels.push([rid, CHARTEX_TYPE, '../charts/chartEx' + chartNo + '.xml'])
      } else {
        files['xl/charts/chart' + chartNo + '.xml'] = strToU8(chartXml(chart, tab.name))
        types = types.replace('</Types>', '<Override PartName="/xl/charts/chart' + chartNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>')
        drawingRels.push([rid, CHART_TYPE, '../charts/chart' + chartNo + '.xml'])
      }
      anchors.push(anchorXml(chart, rid, k + 1, ex))
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
  if (xlNames.length && files['xl/workbook.xml']) {
    const defs = xlNames.map(([n, ref]) => '<definedName name="' + n + '" hidden="1">' + esc(ref) + '</definedName>').join('')
    let wb = strFromU8(files['xl/workbook.xml'])
    wb = /<definedNames>/.test(wb) ? wb.replace('</definedNames>', defs + '</definedNames>') : wb.replace('</sheets>', '</sheets><definedNames>' + defs + '</definedNames>')
    files['xl/workbook.xml'] = strToU8(wb)
  }
  return zipSync(files)
}

module.exports = { addChartsToXlsx, chartXml }
