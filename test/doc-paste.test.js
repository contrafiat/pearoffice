// Pasting into a document (src/ui/doc/docFiles.js tidyPaste): clipboard HTML
// as Google Docs, Word, LibreOffice and a browser put it there, turned into
// the editor's nodes. Only strings, numbers and booleans are compared.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { Window } = require('happy-dom')

globalThis.window = new Window()
const load = () => import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'docFiles.js'))

async function paste (html) {
  const f = await load()
  const t = f.tidyPaste(html)
  return { json: f.htmlToJson(t.html), dropped: t.dropped }
}

// Every block in order as type[:extra]=text, lists as their items with depth.
function outline (json) {
  const out = []
  const text = (n) => (n.content || []).map((c) => (c.type === 'text' ? c.text : text(c))).join('')
  const walk = (nodes, depth) => {
    for (const n of nodes || []) {
      const a = n.attrs || {}
      if (n.type === 'heading') out.push('h' + a.level + '=' + text(n))
      else if (n.type === 'paragraph') out.push((a.blockStyle || 'p') + (a.textAlign && a.textAlign !== 'left' ? ':' + a.textAlign : '') + (a.indent ? ':indent' + a.indent : '') + '=' + text(n))
      else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') {
        for (const item of n.content || []) {
          const [first, ...rest] = item.content || []
          out.push('-'.repeat(depth + 1) + (n.type === 'orderedList' ? '1' : n.type === 'taskList' ? (item.attrs.checked ? 'x' : 'o') : '*') + ' ' + text(first || {}))
          walk(rest, depth + 1)
        }
      } else if (n.type === 'table') out.push('table=' + (n.content || []).map((r) => (r.content || []).map(text).join('/')).join('|'))
      else if (n.type === 'blockquote') { out.push('quote'); walk(n.content, depth) } else out.push(n.type + '=' + text(n))
    }
  }
  walk(json.content, 0)
  return out.join('\n')
}

// Each run of text with its marks, as text[mark,mark:attr].
function runs (json) {
  const out = []
  const walk = (n) => {
    if (n.type === 'text') {
      const marks = (n.marks || []).map((m) => {
        const a = m.attrs || {}
        if (m.type === 'textStyle') return ['color', 'fontSize', 'fontFamily'].filter((k) => a[k]).map((k) => k + ':' + a[k]).join(',')
        if (m.type === 'link') return 'link:' + a.href
        if (m.type === 'highlight') return 'highlight:' + a.color
        return m.type
      }).filter(Boolean)
      out.push(n.text + (marks.length ? '[' + marks.join(',') + ']' : ''))
    }
    ;(n.content || []).forEach(walk)
  }
  walk(json)
  return out
}

const GOOGLE = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-5c1e7a3f-7fff-4c1a-9d3e-0f2b7a6c1d22">' +
  '<p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:3pt;"><span style="font-size:26pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Trip notes</span></p>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:16pt;"><span style="font-size:15pt;font-family:Arial,sans-serif;color:#666666;background-color:transparent;font-weight:400;">For the long weekend</span></p>' +
  '<h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;">Plan</span></h1>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;">Leave at </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;">nine</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;"> and </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:italic;">do not</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;"> </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;">be late</span><span style="font-size:11pt;color:#000000;font-weight:400;">, </span><span style="font-size:11pt;color:#000000;font-weight:400;text-decoration:line-through;">maybe</span><span style="font-size:11pt;color:#cc0000;font-weight:400;"> red</span><span style="font-size:11pt;color:#000000;background-color:#ffff00;font-weight:400;"> marked</span></p>' +
  '<br>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;text-align:center;"><a href="https://example.com/map" style="text-decoration:none;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;font-weight:400;text-decoration:underline;">The map</span></a></p>' +
  '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;color:#000000;font-weight:400;">Tent</span></p></li>' +
  '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;" aria-level="2"><p dir="ltr" role="presentation"><span style="font-size:11pt;font-weight:400;">Pegs</span></p></li></ul>' +
  '<li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;font-weight:400;">Stove</span></p></li></ul>' +
  '<ol style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:decimal;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;font-weight:400;">Pack</span></p></li></ol>' +
  '<p dir="ltr" style="line-height:1.38;margin-left:36pt;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-weight:400;">Indented once</span></p>' +
  '<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="200"><col width="200"></colgroup><tbody><tr style="height:0pt"><td style="border-left:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-weight:400;">Item</span></p></td><td style="vertical-align:top;"><p dir="ltr"><span style="font-size:11pt;font-weight:400;">Cost</span></p></td></tr></tbody></table></div>' +
  '<p dir="ltr"><span style="font-size:11pt;font-weight:400;"><span style="border:none;display:inline-block;overflow:hidden;width:100px;height:80px;"><img src="https://lh7-us.googleusercontent.com/abc" width="100" height="80" style="margin-left:0px;margin-top:0px;"></span></span></p>' +
  '</b><br class="Apple-interchange-newline">'

test('Google Docs: structure and marks without the bold wrapper', async () => {
  const { json, dropped } = await paste(GOOGLE)
  assert.equal(dropped, true) // the picture
  assert.equal(outline(json), [
    'title=Trip notes',
    'subtitle=For the long weekend',
    'h1=Plan',
    'p=Leave at nine and do not be late, maybe red marked',
    'p=',
    'p:center=The map',
    '-* Tent',
    '--* Pegs',
    '-* Stove',
    '-1 Pack',
    'p:indent1=Indented once',
    'table=Item/Cost',
    'p='
  ].join('\n'))
  assert.equal(runs(json).join(' | '), [
    'Trip notes', 'For the long weekend', 'Plan', 'Leave at ', 'nine[bold]', ' and ', 'do not[italic]', ' ', 'be late[underline]', ', ',
    'maybe[strike]', ' red[color:#cc0000]', ' marked[highlight:#fef08a]', 'The map[link:https://example.com/map]',
    'Tent', 'Pegs', 'Stove', 'Pack', 'Indented once', 'Item', 'Cost'
  ].join(' | '))
})

test('Google Docs checklists become task lists', async () => {
  const html = '<b style="font-weight:normal;" id="docs-internal-guid-1"><ul><li role="checkbox" aria-checked="true" aria-level="1"><p role="presentation"><span>Book</span></p></li><li role="checkbox" aria-checked="false" aria-level="1"><p role="presentation"><span>Pay</span></p></li></ul></b>'
  const { json } = await paste(html)
  assert.equal(outline(json), '-x Book\n-o Pay')
})

const WORD = '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
  '<head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=Generator content="Microsoft Word 15"><style><!--\n/* Style Definitions */\np.MsoNormal {margin:0cm; font-size:11.0pt; font-family:"Calibri",sans-serif;}\n.MsoChpDefault {font-size:11.0pt;}\n--></style><!--[if gte mso 9]><xml><o:shapedefaults v:ext="edit" spidmax="1026"/></xml><![endif]--></head>' +
  '<body lang=EN-GB style=\'tab-interval:36.0pt;word-wrap:break-word\'><!--StartFragment-->' +
  '<p class=MsoTitle><span lang=EN-US>Quarterly report<o:p></o:p></span></p>' +
  '<p class=MsoSubtitle><span lang=EN-US>Draft two<o:p></o:p></span></p>' +
  '<h1><span lang=EN-US>Summary<o:p></o:p></span></h1>' +
  '<p class=MsoNormal><span lang=EN-US>Sales were <b>up</b>, costs <i>down</i>, <u>staff</u> <s>steady</s> and <span style=\'color:#C00000\'>one risk</span> <span style=\'font-size:16.0pt\'>large</span> <span style=\'font-family:"Courier New"\'>code</span> <span style=\'background:yellow;mso-highlight:yellow\'>noted</span>.<o:p></o:p></span></p>' +
  '<p class=MsoListParagraphCxSpFirst style=\'text-indent:-18.0pt;mso-list:l0 level1 lfo1\'><![if !supportLists]><span lang=EN-US style=\'font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol\'><span style=\'mso-list:Ignore\'>·<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-US>North<o:p></o:p></span></p>' +
  '<p class=MsoListParagraphCxSpMiddle style=\'margin-left:72.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level2 lfo1\'><![if !supportLists]><span lang=EN-US style=\'font-family:"Courier New";mso-fareast-font-family:"Courier New"\'><span style=\'mso-list:Ignore\'>o<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-US>Leeds<o:p></o:p></span></p>' +
  '<p class=MsoListParagraphCxSpMiddle style=\'margin-left:72.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level2 lfo1\'><![if !supportLists]><span lang=EN-US style=\'font-family:"Courier New"\'><span style=\'mso-list:Ignore\'>o<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-US>York<o:p></o:p></span></p>' +
  '<p class=MsoListParagraphCxSpLast style=\'text-indent:-18.0pt;mso-list:l0 level1 lfo1\'><![if !supportLists]><span lang=EN-US style=\'font-family:Symbol\'><span style=\'mso-list:Ignore\'>·<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-US>South<o:p></o:p></span></p>' +
  '<p class=MsoNormal><o:p>&nbsp;</o:p></p>' +
  '<p class=MsoListParagraphCxSpFirst style=\'text-indent:-18.0pt;mso-list:l1 level1 lfo2\'><![if !supportLists]><span lang=EN-US><span style=\'mso-list:Ignore\'>1.<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-US>Hire<o:p></o:p></span></p>' +
  '<p class=MsoListParagraphCxSpMiddle style=\'margin-left:72.0pt;text-indent:-18.0pt;mso-list:l1 level2 lfo2\'><![if !supportLists]><span lang=EN-US><span style=\'mso-list:Ignore\'>a.<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-US>Advertise<o:p></o:p></span></p>' +
  '<p class=MsoListParagraphCxSpLast style=\'text-indent:-18.0pt;mso-list:l1 level1 lfo2\'><![if !supportLists]><span lang=EN-US><span style=\'mso-list:Ignore\'>2.<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-US>Train<o:p></o:p></span></p>' +
  '<p class=MsoNormal align=center style=\'text-align:center\'><span lang=EN-US>Centred <a href="https://example.com/q3">link</a><o:p></o:p></span></p>' +
  '<p class=MsoNormal><!--[if gte vml 1]><v:shape id="Picture_x0020_1" type="#_x0000_t75" style=\'width:100pt;height:50pt\'><v:imagedata src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" o:title=""/></v:shape><![endif]--><![if !vml]><img width=133 height=67 src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png" v:shapes="Picture_x0020_1"><![endif]><o:p></o:p></p>' +
  '<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style=\'border-collapse:collapse;border:none\'><tr><td width=301 valign=top style=\'width:225.4pt;border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt\'><p class=MsoNormal><b><span lang=EN-US>Region<o:p></o:p></span></b></p></td><td width=301 valign=top style=\'width:225.4pt\'><p class=MsoNormal><span lang=EN-US>Total<o:p></o:p></span></p></td></tr></table>' +
  '<!--EndFragment--></body></html>'

test('Word: Mso classes, mso-list paragraphs and o:p tags', async () => {
  const { json, dropped } = await paste(WORD)
  assert.equal(dropped, true) // the picture
  assert.equal(outline(json), [
    'title=Quarterly report',
    'subtitle=Draft two',
    'h1=Summary',
    'p=Sales were up, costs down, staff steady and one risk large code noted.',
    '-* North',
    '--* Leeds',
    '--* York',
    '-* South',
    'p=',
    '-1 Hire',
    '--1 Advertise',
    '-1 Train',
    'p:center=Centred link',
    'p=',
    'table=Region/Total'
  ].join('\n'))
  const r = runs(json).join(' | ')
  assert.ok(r.includes('up[bold] | , costs  | down[italic] | ,  | staff[underline] |   | steady[strike]'), r)
  assert.ok(r.includes('one risk[color:#c00000]'), r)
  assert.ok(r.includes('large[fontSize:16pt]'), r)
  assert.ok(r.includes('code[fontFamily:monospace]'), r)
  assert.ok(r.includes('noted[highlight:#fef08a]'), r)
  assert.ok(r.includes('link[link:https://example.com/q3]'), r)
  assert.ok(r.includes('Region[bold]'), r)
  assert.ok(!r.includes('·') && !r.includes('Times'), r)
})

test('Word: a numbered list starting later keeps its start', async () => {
  const p = (n, text) => '<p class=MsoListParagraph style=\'mso-list:l3 level1 lfo4\'><![if !supportLists]><span><span style=\'mso-list:Ignore\'>' + n + '.<span>&nbsp; </span></span></span><![endif]>' + text + '<o:p></o:p></p>'
  const f = await load()
  const json = f.htmlToJson(f.tidyPaste(p(3, 'Third') + p(4, 'Fourth')).html)
  assert.equal(json.content[0].type, 'orderedList')
  assert.equal(json.content[0].attrs.start, 3)
  assert.equal(json.content[0].content.length, 2)
})

const WEB = '<meta charset=\'utf-8\'><h2 style="color: rgb(32, 33, 36); font-family: Georgia, serif; font-size: 24px; font-weight: 700; margin: 0px;">Getting started</h2>' +
  '<p style="color: rgb(32, 33, 36); font-family: Georgia, serif; font-size: 16px; font-weight: 400; background-color: rgb(255, 255, 255);">Install the <a href="https://example.org/app" style="color: rgb(26, 115, 232); text-decoration: underline;">app</a> and <strong>sign in</strong>. Then <em>wait</em>.</p>' +
  '<img src="https://example.org/hero.png" alt="Hero">' +
  '<ul style="color: rgb(32, 33, 36);"><li>Fast</li><li>Free<ul><li>Really</li></ul></li></ul>' +
  '<h5>Small print</h5>' +
  '<blockquote><p>A quote</p></blockquote>' +
  '<pre><code>npm install app\n</code></pre>' +
  '<script>alert(1)</script><style>p { color: red }</style><button>Subscribe</button><!-- tracking -->'

test('a web page: headings, links, lists, quotes and code; no scripts or pictures', async () => {
  const { json, dropped } = await paste(WEB)
  assert.equal(dropped, true)
  assert.equal(outline(json), [
    'h2=Getting started',
    'p=Install the app and sign in. Then wait.',
    '-* Fast',
    '-* Free',
    '--* Really',
    'h3=Small print',
    'quote',
    'p=A quote',
    'codeBlock=npm install app'
  ].join('\n'))
  assert.equal(runs(json).slice(0, 7).join(' | '), 'Getting started | Install the  | app[link:https://example.org/app] |  and  | sign in[bold] | . Then  | wait[italic]')
  const all = JSON.stringify(json)
  assert.equal(all.includes('alert'), false)
  assert.equal(all.includes('Subscribe'), false)
  assert.equal(all.includes('rgb(32'), false)
})

const LIBRE = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN"><html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/><title></title><meta name="generator" content="LibreOffice 24.2.7.2 (Linux)"/><style type="text/css">@page { size: 21cm 29.7cm; margin: 2cm } p { line-height: 115%; margin-bottom: 0.25cm; background: transparent } h1 { margin-bottom: 0.21cm; background: transparent; page-break-after: avoid } h1.western { font-family: "Liberation Serif", serif; font-size: 24pt; font-weight: bold }</style></head>' +
  '<body lang="en-GB" link="#000080" vlink="#800000" dir="ltr">' +
  '<p class="title" align="center" style="margin-bottom: 0.21cm"><font face="Liberation Sans, sans-serif"><font size="6" style="font-size: 28pt"><b>Minutes</b></font></font></p>' +
  '<h1 class="western">Attendees</h1>' +
  '<p style="line-height: 150%; margin-bottom: 0cm"><b>Ann</b> and <i>Bo</i> and <font color="#c9211e">Cy</font> and <font size="5" style="font-size: 18pt">Di</font> and <span style="background: #ffff00">Ed</span> and <strike>Fay</strike> and <u>Gus</u> and H<sub>2</sub>O and x<sup>2</sup></p>' +
  '<ul><li><p style="margin-bottom: 0cm; line-height: 100%">Agreed</p><ul><li><p style="margin-bottom: 0cm">Budget</p></li></ul></li><li><p>Deferred</p></li></ul>' +
  '<p align="right" style="margin-bottom: 0cm"><font face="DejaVu Sans Mono, monospace">Signed</font></p>' +
  '</body></html>'

test('LibreOffice: font tags, align attributes and nested lists', async () => {
  const { json, dropped } = await paste(LIBRE)
  assert.equal(dropped, false)
  assert.equal(outline(json), [
    'title:center=Minutes',
    'h1=Attendees',
    'p=Ann and Bo and Cy and Di and Ed and Fay and Gus and H2O and x2',
    '-* Agreed',
    '--* Budget',
    '-* Deferred',
    'p:right=Signed'
  ].join('\n'))
  const r = runs(json).join(' | ')
  for (const want of ['Ann[bold]', 'Bo[italic]', 'Cy[color:#c9211e]', 'Di[fontSize:18pt]', 'Ed[highlight:#fef08a]', 'Fay[strike]', 'Gus[underline]', '2[subscript]', '2[superscript]', 'Signed[fontFamily:monospace]']) {
    assert.ok(r.includes(want), want + ' in ' + r)
  }
  assert.equal(json.content[2].attrs.lineHeight, '1.5')
})

test('a paste with nothing left out says so', async () => {
  const { dropped } = await paste('<p>Just <b>text</b></p>')
  assert.equal(dropped, false)
})
