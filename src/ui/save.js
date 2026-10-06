// Saving a file the person asked for: the share sheet on phones (the shell's
// app:shareFile), a download on desktop.
import { call } from './bridge.js'

export const isMobile = () => !!(window.pearoffice && window.pearoffice.platform === 'mobile')

export const fileName = (s) => String(s || 'PearOffice').replace(/[\\/:*?"<>|]/g, ' ')

// `data` is text or bytes.
export async function saveFile (name, mime, data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  if (isMobile()) {
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return call('app:shareFile', { name, mime, base64: btoa(bin) })
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
