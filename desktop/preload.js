// The bridge the web UI talks through. The mobile WebView will expose the same
// `window.pearsheet` shape, so the UI never knows which shell it runs in.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pearsheet', {
  call: (method, args) => ipcRenderer.invoke('worklet:call', method, args),
  on: (event, fn) => {
    const listener = (_e, msg) => { if (msg.name === event) fn(msg.data) }
    ipcRenderer.on('worklet:event', listener)
    return () => ipcRenderer.removeListener('worklet:event', listener)
  },
  platform: 'desktop'
})
