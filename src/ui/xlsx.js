// .xlsx import and export in the UI, with SheetJS (Community Edition, mini
// build, vendored in vendor/). The conversion itself is in src/shared/xlsxMap.js.
// On phones the shell does the file handling (share sheet, file picker).
import * as XLSX from 'xlsx/dist/xlsx.mini.min.js'
import { workbookToTabs, dumpToWorkbook, READ_OPTIONS } from '../shared/xlsxMap.js'
import { call } from './bridge.js'

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const isMobile = () => !!(window.pearsheet && window.pearsheet.platform === 'mobile')

function importWorkbook (wb, name) {
  const { tabs } = workbookToTabs(XLSX, wb)
  const title = String(name || '').replace(/\.[^.]+$/, '') || 'Imported sheet'
  return call('sheet:import', { title, tabs })
}

// Desktop: a File from an <input type=file>.
export async function importFile (file) {
  const data = new Uint8Array(await file.arrayBuffer())
  return importWorkbook(XLSX.read(data, { type: 'array', ...READ_OPTIONS }), file.name)
}

// Phones: the shell's file picker. Resolves to null if cancelled.
export async function pickAndImport () {
  const picked = await call('app:pickFile')
  if (!picked || picked.canceled) return null
  return importWorkbook(XLSX.read(picked.base64, { type: 'base64', ...READ_OPTIONS }), picked.name)
}

export async function exportSheet (sheetId) {
  const dump = await call('sheet:dump', { sheetId })
  const wb = dumpToWorkbook(XLSX, dump)
  const name = (dump.title || 'PearSheet').replace(/[\\/:*?"<>|]/g, ' ') + '.xlsx'
  if (isMobile()) {
    return call('app:shareFile', { name, mime: MIME, base64: XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) })
  }
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type: MIME }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
