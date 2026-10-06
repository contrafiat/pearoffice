// The UI's only door to the worklet. The desktop preload and (later) the
// mobile WebView both provide window.pearoffice = { call, on, platform }.

const api = typeof window !== 'undefined' ? window.pearoffice : null

export function call (method, args = {}) {
  if (!api) return Promise.reject(new Error('PearOffice bridge is missing'))
  return api.call(method, args)
}

export function on (event, fn) {
  if (!api) return () => {}
  return api.on(event, fn)
}
