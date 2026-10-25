// The UI's only door to the worklet. The desktop preload and (later) the
// mobile WebView both provide window.pearoffice = { call, on, platform }.

const api = typeof window !== 'undefined' ? window.pearoffice : null

export function call (method, args = {}) {
  if (!api) return Promise.reject(new Error('PearOffice bridge is missing'))
  // Electron wraps a worklet error as "Error invoking remote method ...":
  // pass on the worklet's own message.
  return api.call(method, args).catch((err) => {
    const msg = String((err && err.message) || err || '')
    const plain = msg.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
    throw plain === msg ? err : new Error(plain)
  })
}

export function on (event, fn) {
  if (!api) return () => {}
  return api.on(event, fn)
}
