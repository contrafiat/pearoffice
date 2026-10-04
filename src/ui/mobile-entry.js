// Entry for the mobile WebView build. Sets up window.pearsheet on top of the
// React Native WebView bridge, then starts the same UI as the desktop.
//
//   UI -> shell:  ReactNativeWebView.postMessage({ id, method, args })
//   shell -> UI:  window.__psResponse({ id, result | error })
//                 window.__psEvent(name, data)

if (!window.pearsheet) {
  let next = 0
  const pending = new Map()
  const subs = new Map()
  window.__psResponse = (msg) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  }
  window.__psEvent = (name, data) => {
    for (const fn of subs.get(name) || []) { try { fn(data) } catch {} }
  }
  window.pearsheet = {
    platform: 'mobile',
    call (method, args) {
      return new Promise((resolve, reject) => {
        const id = ++next
        pending.set(id, { resolve, reject })
        window.ReactNativeWebView.postMessage(JSON.stringify({ id, method, args: args || {} }))
      })
    },
    on (event, fn) {
      if (!subs.has(event)) subs.set(event, new Set())
      subs.get(event).add(fn)
      return () => subs.get(event).delete(fn)
    }
  }
}

require('./main.jsx')
