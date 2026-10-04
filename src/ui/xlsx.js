// .xlsx import and export in the UI, with SheetJS (Community Edition, mini
// build, vendored in vendor/). The conversion itself is in src/shared/xlsxMap.js.
import * as XLSX from 'xlsx/dist/xlsx.mini.min.js'
import { workbookToTabs, dumpToWorkbook, READ_OPTIONS } from '../shared/xlsxMap.js'
import { call } from './bridge.js'

export async function importFile (file) {
  const data = new Uint8Array(await file.arrayBuffer())
  const wb = XLSX.read(data, { type: 'array', ...READ_OPTIONS })
  const { tabs } = workbookToTabs(XLSX, wb)
  const title = file.name.replace(/\.[^.]+$/, '') || 'Imported sheet'
  return call('sheet:import', { title, tabs })
}

export async function exportSheet (sheetId) {
  const dump = await call('sheet:dump', { sheetId })
  const wb = dumpToWorkbook(XLSX, dump)
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (dump.title || 'PearSheet').replace(/[\\/:*?"<>|]/g, ' ') + '.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
