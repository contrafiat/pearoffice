// The UI's only door to the worklet. The desktop preload and (later) the
// mobile WebView both provide window.pearsheet = { call, on, platform }.

const api = typeof window !== 'undefined' ? window.pearsheet : null

export function call (method, args = {}) {
  if (!api) return Promise.reject(new Error('PearSheet bridge is missing'))
  return api.call(method, args)
}

export function on (event, fn) {
  if (!api) return () => {}
  return api.on(event, fn)
}
