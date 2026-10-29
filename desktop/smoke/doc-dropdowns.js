// Smoke test part "doc-dropdowns": dropdowns in a document
// (proposals/2026-10-29-document-dropdowns.md). A checklist with a new list
// from the toolbar (Yes and No to start), renamed, with Not in store added
// in orange; a choice picked; Enter carrying the dropdown to the next item
// and leaving the list on an empty one; a choice renamed showing on its
// pill; the move to schema version 4; reopening.
// PEAROFFICE_SMOKE_DOC_DROPDOWNS_SHOT=<png> saves the list and
// PEAROFFICE_SMOKE_DOC_DROPDOWNS_PANEL_SHOT=<png> Edit choices.

module.exports = async function docDropdowns (t) {
  const { js, step, waitFor, type, key, result, sleep, shot } = t
  const pills = "[...document.querySelectorAll('.doc-body .doc-dropdown-view .chip')].map((x) => x.textContent + ':' + (x.className.match(/chip-(\\w+)/) || [])[1])"
  const setInput = (sel, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  // The offscreen window may not have focus, so blur() sends nothing.
  const leave = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  const pickChoice = async (n, text) => {
    await js(`document.querySelectorAll('.doc-body .doc-dropdown-view .chip')[${n}].click()`)
    await waitFor('choices open', `[...document.querySelectorAll('.doc-choices li')].some((l) => l.textContent === ${JSON.stringify(text)})`)
    await js(`[...document.querySelectorAll('.doc-choices li')].find((l) => l.textContent === ${JSON.stringify(text)}).click()`)
  }

  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-doc:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-doc').click()")
  await waitFor('doc editor', "!!document.querySelector('.doc-body[contenteditable=\"true\"]')")
  await js("document.querySelector('.doc-body').focus()")
  await waitFor('doc focus', "document.activeElement === document.querySelector('.doc-body')")
  const id = await js("window.pearoffice.call('sheet:list', {}).then((l) => l.find((x) => x.kind === 'doc').sheetId)")

  // A checklist, Beans, then a new list from the toolbar.
  await js("document.querySelector('.doc-tools button[aria-label=\"Checklist\"]').click()")
  await type('Beans')
  await js("document.querySelector('.doc-tools .dropdown-button').click()")
  await waitFor('dropdown menu', "!!document.querySelector('.dropdown-menu .dropdown-new')")
  await js("document.querySelector('.dropdown-menu .dropdown-new').click()")
  await waitFor('pill and panel', `${pills}.join() === 'Choose:grey' && !!document.querySelector('.panel.list-panel')`)
  await waitFor('Yes and No', "[...document.querySelectorAll('.list-panel .list-item')].map((x) => x.value).join() === 'Yes,No'")
  await setInput('.list-panel .list-name', 'Shopping')
  await leave('.list-panel .list-name')
  await setInput('.list-panel .list-new', 'Not in store')
  await js("document.querySelector('.list-panel .list-new').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))")
  await waitFor('added', "[...document.querySelectorAll('.list-panel .list-item')].map((x) => x.value).join() === 'Yes,No,Not in store'")
  await js("document.querySelectorAll('.list-panel .chip-dot')[2].click()")
  await waitFor('swatches', "!!document.querySelector('.list-panel .chip-swatches')")
  await js("document.querySelector('.list-panel .chip-swatches button[aria-label=\"orange\"]').click()")
  await waitFor('orange', "document.querySelectorAll('.list-panel .chip-dot')[2].classList.contains('chip-orange')")
  await shot('PEAROFFICE_SMOKE_DOC_DROPDOWNS_PANEL_SHOT', 300)
  await js("[...document.querySelectorAll('.list-panel button')].find((b) => b.textContent === 'Done').click()")
  await waitFor('panel closed', "!document.querySelector('.panel.list-panel')")
  await waitFor('version 4', `window.pearoffice.call('doc:state', { sheetId: ${JSON.stringify(id)}, withState: false }).then((r) => r.version === 4)`)
  result.list = true
  step('new list')

  // Yes on Beans.
  await pickChoice(0, 'Yes')
  await waitFor('Yes picked', `${pills}.join() === 'Yes:green'`)
  result.pick = true
  step('pick')

  // Enter carries the dropdown; Milk goes before it. On the third, empty
  // item Enter leaves the list.
  await js("document.querySelector('.doc-body').editor.commands.focus('end')")
  await waitFor('doc focus', "document.activeElement === document.querySelector('.doc-body')")
  await key('Return')
  await waitFor('carried', `${pills}.join() === 'Yes:green,Choose:grey'`)
  await type('Milk')
  await key('Return')
  await waitFor('carried again', `${pills}.length === 3`)
  await key('Return')
  await waitFor('left the list', `${pills}.length === 2 && document.querySelectorAll('.doc-body ul[data-type="taskList"] > li').length === 2`)
  const items = await js("[...document.querySelectorAll('.doc-body ul[data-type=\"taskList\"] > li')].map((li) => li.querySelector(\"div\").textContent.replace(/\\s+/g, ' ').trim())")
  if (!/^Beans ?Yes$/.test(items[0]) || !/^Milk ?Choose$/.test(items[1])) throw new Error('list items: ' + JSON.stringify(items))
  await pickChoice(1, 'Not in store')
  await waitFor('Not in store picked', `${pills}.join() === 'Yes:green,Not in store:orange'`)
  result.carry = true
  await shot('PEAROFFICE_SMOKE_DOC_DROPDOWNS_SHOT', 300)
  step('enter carries')

  // Edit choices from a pill: Yes renamed, shown on its pill.
  await js("document.querySelectorAll('.doc-body .doc-dropdown-view .chip')[0].click()")
  await waitFor('choices open', "[...document.querySelectorAll('.doc-choices li')].some((l) => l.textContent === 'Edit choices...')")
  await js("[...document.querySelectorAll('.doc-choices li')].find((l) => l.textContent === 'Edit choices...').click()")
  await waitFor('panel', "!!document.querySelector('.panel.list-panel') && document.querySelector('.list-panel .list-name').value === 'Shopping'")
  await setInput('.list-panel .list-item', 'Got it')
  await leave('.list-panel .list-item')
  await js("[...document.querySelectorAll('.list-panel button')].find((b) => b.textContent === 'Done').click()")
  await waitFor('renamed', `${pills}.join() === 'Got it:green,Not in store:orange'`)
  result.rename = true
  step('rename')

  // The toolbar menu lists Shopping; reopening keeps it all.
  await js("document.querySelector('.doc-tools .dropdown-button').click()")
  await waitFor('Shopping listed', "[...document.querySelectorAll('.dropdown-menu .dropdown-list-name')].map((x) => x.textContent).join() === 'Shopping'")
  await key('Escape')
  await js("document.querySelector('.doc-scrim') && document.querySelector('.doc-scrim').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))")
  await sleep(500)
  await t.sendMod('W', ['control'])
  await js("[...document.querySelectorAll('.sheet-link')].find((b) => b.textContent.includes('Untitled document')).click()")
  await waitFor('kept', `${pills}.join() === 'Got it:green,Not in store:orange'`)
  result.reopen = true
  step('reopen')
  return true
}
