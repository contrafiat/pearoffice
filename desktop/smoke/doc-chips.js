// Smoke test part "doc-chips": @ chips in a document
// (proposals/2026-10-26-document-chips.md). @ then a person, whose pill
// follows a rename; @ then a file, opened from its pill; @ then Tomorrow,
// changed with the calendar; Escape leaving the typed @; the document's
// move to schema version 3; reopening. PEAROFFICE_SMOKE_DOC_CHIPS_SHOT=<png>
// saves the document with its pills.

module.exports = async function docChips (t) {
  const { js, step, waitFor, type, key, result, sleep, shot } = t
  const menuHas = (label) => `[...document.querySelectorAll('.at-menu .at-item > span:last-child')].some((x) => x.textContent === ${JSON.stringify(label)})`
  const pill = (kind) => `[...document.querySelectorAll('.doc-body .doc-chip-view[data-chip="${kind}"] .smart-chip-text')].map((x) => x.textContent)`
  const docId = () => js("window.pearoffice.call('sheet:list', {}).then((l) => l.find((x) => x.kind === 'doc').sheetId)")

  await js("window.pearoffice.call('app:setName', { name: 'Ada Pear' })")
  await js("window.pearoffice.call('sheet:create', { title: 'Budget' })")
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-doc:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-doc').click()")
  await waitFor('doc editor', "!!document.querySelector('.doc-body[contenteditable=\"true\"]')")
  await js("document.querySelector('.doc-body').focus()")
  await waitFor('doc focus', "document.activeElement === document.querySelector('.doc-body')")
  const id = await docId()
  if ((await js(`window.pearoffice.call('doc:state', { sheetId: ${JSON.stringify(id)}, withState: false }).then((r) => r.version)`)) !== 1) throw new Error('a new document should be version 1')

  // A person, picked with Enter; the pill follows a rename.
  await type('Ask @Ada')
  await waitFor('person offered', menuHas('Ada Pear'))
  await key('Return')
  await waitFor('person pill', `${pill('person')}.join() === 'Ada Pear'`)
  await js("window.pearoffice.call('app:setName', { name: 'Ada Lovelace' })")
  await waitFor('pill follows the rename', `${pill('person')}.join() === 'Ada Lovelace'`)
  await waitFor('version 3', `window.pearoffice.call('doc:state', { sheetId: ${JSON.stringify(id)}, withState: false }).then((r) => r.version === 3)`)
  result.person = true
  step('person')

  // A file, clicked in the menu.
  await type('about @Bud')
  await waitFor('file offered', menuHas('Budget'))
  await js("[...document.querySelectorAll('.at-menu .at-item')].find((x) => x.lastElementChild.textContent === 'Budget').click()")
  await waitFor('file pill', `${pill('file')}.join() === 'Budget' && !!document.querySelector('.doc-chip-view[data-chip="file"][data-href^="pearoffice://file/"] .smart-chip svg')`)
  result.file = true
  step('file')

  // Tomorrow, then a new date from the calendar's input.
  await type('by @Tom')
  await waitFor('Tomorrow offered', menuHas('Tomorrow'))
  await key('Return')
  const dateAttr = "(() => { let d = null; document.querySelector('.doc-body').editor.state.doc.descendants((n) => { if (n.type.name === 'chip' && n.attrs.kind === 'date') d = n.attrs.date }); return d })()"
  const tomorrow = await js("(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })()")
  await waitFor('date pill', `${dateAttr} === ${JSON.stringify(tomorrow)} && ${pill('date')}.length === 1 && !!document.querySelector('.doc-chip-view[data-chip="date"] .chip-calendar')`)
  await js("(() => { const i = document.querySelector('.doc-chip-view[data-chip=\"date\"] .chip-date-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '2030-05-17'); i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new Event('input', { bubbles: true })) })()")
  await waitFor('date changed', `${dateAttr} === '2030-05-17' && /2030/.test(${pill('date')}[0])`)
  result.date = true
  await shot('PEAROFFICE_SMOKE_DOC_CHIPS_SHOT', 300)
  step('date')

  // Escape keeps what was typed.
  await js("document.querySelector('.doc-body').editor.commands.focus('end')")
  await type(' @Ad')
  await waitFor('menu open', menuHas('Ada Lovelace'))
  await key('Escape')
  await waitFor('menu closed', "!document.querySelector('.at-menu')")
  await type('a')
  await sleep(200)
  if (await js("!!document.querySelector('.at-menu')")) throw new Error('the menu came back after Escape')
  if (!(await js("document.querySelector('.doc-body').textContent.endsWith('@Ada')"))) throw new Error('Escape lost the typed text')
  result.escape = true
  step('escape')

  // Reopened: the pills are kept; Ctrl+click on the file opens it.
  await sleep(500)
  await js("[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes('Budget')).click()")
  await waitFor('Budget open', "!!document.querySelector('.title') && document.querySelector('.title').value === 'Budget'")
  await js("[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes('Untitled document')).click()")
  await waitFor('pills kept', `${pill('person')}.join() === 'Ada Lovelace' && ${pill('file')}.join() === 'Budget' && /2030/.test(${pill('date')}[0] || '')`)
  await js("document.querySelector('.doc-chip-view[data-chip=\"file\"] .smart-chip').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))")
  await waitFor('file opened from its pill', "!!document.querySelector('.title') && document.querySelector('.title').value === 'Budget'")
  result.reopened = true
  step('reopened')

  return result.person && result.file && result.date && result.escape && result.reopened
}
