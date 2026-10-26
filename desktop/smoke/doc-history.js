// Smoke test part "doc-history": version history in a document
// (proposals/2026-10-26-version-history.md). Type, pause, type again; the
// panel lists two versions, the newest marks what it added, the older one
// shows the text as it was; Copy; Restore brings the older one back.
// A version ends after 1.5 s here (window.__historyPauseMs), not 5 minutes.
// PEAROFFICE_SMOKE_HISTORY_SHOT=<png> saves the panel.

module.exports = async function docHistory (t) {
  const { js, step, waitFor, type, key, result, sleep, shot } = t
  const page = "((document.querySelector('.history-page') || {}).textContent || '')"
  const items = "document.querySelectorAll('.history-item').length"

  await js('window.__historyPauseMs = 1500')
  await js("document.querySelector('.sidebar .new-sheet').click()")
  await waitFor('kind choices', "!!document.querySelector('.kind-choice.kind-doc:not(:disabled)')")
  await js("document.querySelector('.kind-choice.kind-doc').click()")
  await waitFor('doc editor', "!!document.querySelector('.doc-body[contenteditable=\"true\"]')")
  await js("document.querySelector('.doc-body').focus()")
  await waitFor('doc focus', "document.activeElement === document.querySelector('.doc-body')")
  await type('First line')
  await waitFor('typed', "document.querySelector('.doc-body').textContent === 'First line'")
  await sleep(2500) // longer than the pause: a new version starts
  await key('Return')
  await type('Second line')
  await waitFor('typed again', "document.querySelector('.doc-body').textContent === 'First lineSecond line'")
  await sleep(800) // the editor sends its edits a moment later

  const open = async () => {
    await js("document.querySelector('.more-button').click()")
    await waitFor('file menu', "!!document.querySelector('.more-menu .version-history')")
    await js("document.querySelector('.more-menu .version-history').click()")
    await waitFor('history open', `!!document.querySelector('.history') && ${items} >= 2`)
  }
  await open()
  await waitFor('newest marks the second line', `${page}.includes('Second line') && [...document.querySelectorAll('.history-page ins')].some((x) => x.textContent.includes('Second line'))`)
  if (await js("!!document.querySelector('.doc-body[contenteditable=\"true\"]') && document.querySelector('.doc-live').offsetParent !== null")) throw new Error('the editor still shows')
  await shot('PEAROFFICE_SMOKE_HISTORY_SHOT', 300)
  await js("document.querySelectorAll('.history-item')[1].click()")
  await waitFor('older shows the first line only', `${page}.includes('First line') && !${page}.includes('Second line')`)
  result.list = true
  step('versions listed and shown')

  const { clipboard } = require('electron')
  await js("document.querySelector('.history-copy').click()")
  await waitFor('copied note', "!!document.querySelector('.history .toast')")
  const copied = String(await clipboard.readText())
  if (copied.trim() !== 'First line') throw new Error('copied ' + JSON.stringify(copied))
  result.copy = true
  step('copy')

  await sleep(1600) // so the restore is a version of its own
  await js("document.querySelector('.history-restore').click()")
  await waitFor('asks first', "!!document.querySelector('.history-restore-yes')")
  await js("document.querySelector('.history-restore-yes').click()")
  await waitFor('restored', "!document.querySelector('.history') && document.querySelector('.doc-body').textContent === 'First line' && !!document.querySelector('.doc .toast')")
  // The restore is an edit like any other: kept after the history reopens.
  await sleep(800)
  await open()
  await waitFor('current is the restored text', `${page}.includes('First line') && [...document.querySelectorAll('.history-page del')].some((x) => x.textContent.includes('Second line'))`)
  await js("document.querySelector('.history-close').click()")
  await waitFor('closed', "!document.querySelector('.history') && document.querySelector('.doc-body').textContent === 'First line'")
  result.restore = true
  step('restore')

  return result.list && result.copy && result.restore
}
