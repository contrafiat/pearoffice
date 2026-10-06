// Spreadsheet helpers shared by the sheets and sheet-files smoke parts.

module.exports = function gridHelpers ({ js, type, key, waitFor }) {
  const cellText = (row, col) => js(`(() => {
    const el = [...document.querySelectorAll('.cell')].find((c) => c.style.top === '${(row - 1) * 24}px' && c.style.left === document.querySelectorAll('.col-head')[${col - 1}].style.left)
    return el ? el.textContent : null
  })()`)
  const hasCell = (text) => `[...document.querySelectorAll('.cell')].some((c) => c.textContent === ${JSON.stringify(text)})`
  async function enter (text, then, shows = text) {
    await type(text)
    await key(then)
    await waitFor('cell ' + text, hasCell(shows))
    await waitFor('grid focus', "document.activeElement === document.querySelector('.grid .body')")
  }
  const cellNode = (r, c) => "[...document.querySelectorAll('.cell')].find((x) => x.dataset.r === '" + r + "' && x.dataset.c === '" + c + "')"
  const rowHead = (r) => "[...document.querySelectorAll('.row-head')].find((h) => h.firstChild && h.firstChild.textContent === '" + r + "')"
  const typeInto = (sel, text) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const setInput = (sel, text) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const setSelect = (sel, value) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  return { cellText, hasCell, enter, cellNode, rowHead, typeInto, setInput, setSelect }
}
