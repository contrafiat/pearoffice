// PearSheet mobile shell. Starts the Bare worklet (the same engine as the
// desktop), loads the same web UI into a WebView and relays calls and events
// between them. The UI talks to window.pearsheet, set up by
// src/ui/mobile-entry.js on top of the WebView bridge.

import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { Worklet } from 'react-native-bare-kit'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import b4a from 'b4a'

const ALLOWED = /^(sheet|app|seeder):[A-Za-z]+$/

// The most recent pearsheet:// link, kept until the UI asks for it
// (app:takeLink), so a link that arrives before the UI is listening is not lost.
let pendingLink = null

let worklet = null
let started = null
const pending = new Map()
const listeners = new Set()
let nextId = 1

function startWorklet () {
  if (started) return started
  started = (async () => {
    const asset = Asset.fromModule(require('../assets/bare-universal.bundle'))
    await asset.downloadAsync()
    const bundle = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 })
    worklet = new Worklet()
    await worklet.start('/app.bundle', b4a.from(bundle, 'base64'))
    let buf = ''
    worklet.IPC.on('data', (chunk) => {
      buf += b4a.toString(chunk)
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } else if (msg.event) for (const fn of listeners) fn(msg.event, msg.data)
      }
    })
    const dataDir = FileSystem.documentDirectory.replace(/^file:\/\//, '').replace(/\/$/, '')
    const init = await callWorklet('init', { dataDir })
    if (init.error) throw new Error(init.error)
  })()
  return started
}

function callWorklet (method, args) {
  return new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    worklet.IPC.write(b4a.from(JSON.stringify({ id, method, args }) + '\n'))
  })
}

async function loadHtml (dark) {
  const asset = Asset.fromModule(require('../assets/app-ui.bundle'))
  await asset.downloadAsync()
  const js = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.UTF8 })
  const bg = dark ? '#171a17' : '#f7f7f4'
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<style>html,body,#root{height:100%;margin:0;background:' + bg + '}</style></head>' +
    '<body><div id="root"></div><script>' + js + '</script></body></html>'
}

export default function App () {
  const dark = useColorScheme() === 'dark'
  const [html, setHtml] = useState(null)
  const [error, setError] = useState(null)
  const web = useRef(null)
  const loaded = useRef(false)
  const queued = useRef([])

  const inject = (code) => {
    if (loaded.current && web.current) web.current.injectJavaScript(code + ';true;')
    else queued.current.push(code)
  }

  useEffect(() => {
    let alive = true
    Promise.all([startWorklet(), loadHtml(dark)])
      .then(([, h]) => { if (alive) setHtml(h) })
      .catch((err) => { if (alive) setError(String(err && err.message ? err.message : err)) })
    const onEvent = (name, data) => inject('window.__psEvent && window.__psEvent(' + JSON.stringify(name) + ',' + JSON.stringify(data ?? null) + ')')
    listeners.add(onEvent)
    // pearsheet:// links (invites, seeder pairing) go to the UI.
    const sendLink = (url) => {
      if (!url || !url.startsWith('pearsheet://')) return
      console.log('[pearsheet] link ' + url.slice(0, 40))
      pendingLink = url
      onEvent('app:deeplink', { url })
    }
    Linking.getInitialURL().then(sendLink).catch(() => {})
    const sub = Linking.addEventListener('url', ({ url }) => sendLink(url))
    return () => { alive = false; listeners.delete(onEvent); sub.remove() }
  }, [])

  const onMessage = async (e) => {
    let msg
    try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
    const { id, method, args } = msg
    const reply = (body) => inject('window.__psResponse(' + JSON.stringify({ id, ...body }) + ')')
    if (method === 'app:takeLink') { const url = pendingLink; pendingLink = null; return reply({ result: { url } }) }
    if (typeof method !== 'string' || !ALLOWED.test(method)) return reply({ error: 'bad method' })
    const res = await callWorklet(method, args || {})
    reply(res.error ? { error: res.error } : { result: res.result ?? null })
  }

  const bg = dark ? '#171a17' : '#f7f7f4'
  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <Text style={{ color: dark ? '#e6e8e3' : '#1f2420', padding: 24 }}>PearSheet could not start: {error}</Text>
      </View>
    )
  }
  if (!html) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator color='#5b8c3a' />
      </View>
    )
  }
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={bg} />
      <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'bottom']}>
        <WebView
          ref={web}
          source={{ html, baseUrl: 'https://localhost/' }}
          originWhitelist={['*']}
          onMessage={onMessage}
          onLoad={() => {
            loaded.current = true
            for (const code of queued.current.splice(0)) web.current.injectJavaScript(code + ';true;')
          }}
          onRenderProcessGone={() => { loaded.current = false; web.current && web.current.reload() }}
          keyboardDisplayRequiresUserAction={false}
          style={{ flex: 1, backgroundColor: bg }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center' } })
