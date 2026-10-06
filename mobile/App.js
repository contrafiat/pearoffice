// PearOffice mobile shell. Starts the Bare worklet (the same engine as the
// desktop), loads the same web UI into a WebView and relays calls and events
// between them. The UI talks to window.pearoffice, set up by
// src/ui/mobile-entry.js on top of the WebView bridge.

import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Keyboard, Linking, Modal, Platform, Share, StatusBar, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { Worklet } from 'react-native-bare-kit'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import * as Clipboard from 'expo-clipboard'
import b4a from 'b4a'
import { requestLocalNetworkPermission } from '../modules/local-network'

const ALLOWED = /^(sheet|app|seeder|link):[A-Za-z]+$/
// iOS file types for the share sheet, by MIME type.
const UTIS = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'org.openxmlformats.spreadsheetml.sheet',
  'text/csv': 'public.comma-separated-values-text',
  'application/json': 'public.json',
  'image/png': 'public.png',
  'image/svg+xml': 'public.svg-image'
}

// Phone features the web UI cannot reach on its own, answered by the shell.
async function shellMethod (method, args) {
  if (method === 'app:shareFile') {
    // Export: write the file to the cache and open the share sheet (save to
    // Files or Drive, send it, ...). A WebView cannot download a blob itself.
    const safe = String(args.name || 'PearOffice.xlsx').replace(/[\\/:*?"<>|]/g, ' ')
    const uri = FileSystem.cacheDirectory + safe
    await FileSystem.writeAsStringAsync(uri, args.base64, { encoding: FileSystem.EncodingType.Base64 })
    await Sharing.shareAsync(uri, { mimeType: args.mime, dialogTitle: safe, UTI: UTIS[args.mime] || 'public.data' })
    return { ok: true }
  }
  if (method === 'app:pickFile') {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/comma-separated-values', 'text/tab-separated-values', 'application/json', 'text/json', 'application/octet-stream'],
      copyToCacheDirectory: true
    })
    if (res.canceled || !res.assets || !res.assets[0]) return { canceled: true }
    const file = res.assets[0]
    const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 })
    return { name: file.name, base64 }
  }
  if (method === 'app:openUrl') {
    const url = String(args.url || '')
    if (/^(https:|mailto:|lightning:)/.test(url)) await Linking.openURL(url)
    return { ok: true }
  }
  // Is a Lightning wallet installed (the donation sheet offers it)?
  if (method === 'app:canOpenUrl') {
    const url = String(args.url || '')
    return { can: /^lightning:/.test(url) ? await Linking.canOpenURL(url).catch(() => false) : false }
  }
  if (method === 'app:share') {
    await Share.share({ message: String(args.text || '') }).catch(() => {})
    return { ok: true }
  }
  if (method === 'app:setClipboard') { await Clipboard.setStringAsync(String(args.text || '')); return { ok: true } }
  if (method === 'app:getClipboard') return { text: await Clipboard.getStringAsync() }
  return null
}

// The most recent pearoffice:// link, kept until the UI asks for it
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
    // iOS links its addons per framework, so it has its own bundle (covers
    // devices and the Simulator).
    const asset = Asset.fromModule(Platform.OS === 'ios' ? require('../assets/bare-ios.bundle') : require('../assets/bare-universal.bundle'))
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

// After a device link or a phrase restore the identity changed: throw the
// worklet away and start a fresh one.
async function restartWorklet () {
  try { if (worklet) worklet.terminate() } catch {}
  worklet = null
  started = null
  for (const resolve of pending.values()) resolve({ error: 'restarting' })
  pending.clear()
  await startWorklet()
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
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">' +
    '<style>html,body,#root{height:100%;margin:0;background:' + bg + '}</style></head>' +
    '<body><div id="root"></div><script>' + js + '</script></body></html>'
}

export default function App () {
  const dark = useColorScheme() === 'dark'
  const [html, setHtml] = useState(null)
  const [error, setError] = useState(null)
  const web = useRef(null)
  const [scanning, setScanning] = useState(false)
  const scanDone = useRef(null) // resolves the pending app:scanQr call
  const loaded = useRef(false)
  const queued = useRef([])

  const inject = (code) => {
    if (loaded.current && web.current) web.current.injectJavaScript(code + ';true;')
    else queued.current.push(code)
  }

  // Android draws the app edge to edge, so the keyboard covers the WebView
  // instead of shrinking it. Tell the page how much of it is covered (--kb),
  // and bottom sheets move up by that much (src/ui/app.css).
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const setKb = (px) => inject("document.documentElement.style.setProperty('--kb', '" + Math.max(0, Math.round(px)) + "px')")
    // The keyboard and the WebView both end just above the navigation bar,
    // so the keyboard's height is how much of the page it covers.
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0))
    return () => { show.remove(); hide.remove() }
  }, [])

  useEffect(() => {
    let alive = true
    // iOS: ask for Local Network access up front, so people on the same Wi-Fi
    // can connect directly (modules/local-network). No-op elsewhere.
    requestLocalNetworkPermission()
    Promise.all([startWorklet(), loadHtml(dark)])
      .then(([, h]) => { if (alive) setHtml(h) })
      .catch((err) => { if (alive) setError(String(err && err.message ? err.message : err)) })
    const onEvent = (name, data) => inject('window.__psEvent && window.__psEvent(' + JSON.stringify(name) + ',' + JSON.stringify(data ?? null) + ')')
    listeners.add(onEvent)
    // pearoffice:// links (invites, seeder pairing) go to the UI.
    const sendLink = (url) => {
      if (!url || !url.startsWith('pearoffice://')) return
      console.log('[pearoffice] link ' + url.slice(0, 40))
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
    if (method === 'app:scanQr') {
      // Open the camera and answer with the first QR code read, or null if
      // the person cancels or refuses the camera.
      const text = await new Promise((resolve) => { scanDone.current = resolve; setScanning(true) })
      return reply({ result: { text } })
    }
    if (method === 'app:restart') {
      try { await restartWorklet() } catch (err) { return reply({ error: String(err && err.message ? err.message : err) }) }
      reply({ result: { ok: true } })
      if (web.current) { loaded.current = false; web.current.reload() }
      return
    }
    try {
      const own = await shellMethod(method, args || {})
      if (own) return reply({ result: own })
    } catch (err) {
      return reply({ error: String(err && err.message ? err.message : err) })
    }
    if (typeof method !== 'string' || !ALLOWED.test(method)) return reply({ error: 'bad method' })
    const res = await callWorklet(method, args || {})
    reply(res.error ? { error: res.error } : { result: res.result ?? null })
  }

  const bg = dark ? '#171a17' : '#f7f7f4'
  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <Text style={{ color: dark ? '#e6e8e3' : '#1f2420', padding: 24 }}>PearOffice could not start: {error}</Text>
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
          injectedJavaScriptBeforeContentLoaded={'window.__pearPlatform = ' + JSON.stringify(Platform.OS) + ';true;'}
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
      {scanning && <Scanner onDone={(text) => { setScanning(false); const done = scanDone.current; scanDone.current = null; if (done) done(text) }} />}
    </SafeAreaProvider>
  )
}

// Full-screen QR scanner (the pattern PearCircle uses).
function Scanner ({ onDone }) {
  const [permission, requestPermission] = useCameraPermissions()
  const read = useRef(false)
  useEffect(() => {
    if (!permission) return
    if (!permission.granted && permission.canAskAgain) requestPermission()
    else if (!permission.granted) onDone(null)
  }, [permission])
  return (
    <Modal visible animationType='slide' onRequestClose={() => onDone(null)}>
      {permission && permission.granted
        ? (
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing='back'
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => { if (!read.current && data) { read.current = true; onDone(String(data)) } }}
            />
            <View style={styles.scanHint}><Text style={styles.scanText}>Point at a PearOffice QR code</Text></View>
            <TouchableOpacity accessibilityRole='button' style={styles.scanCancel} onPress={() => onDone(null)}>
              <Text style={styles.scanText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          )
        : <View style={[styles.center, { backgroundColor: '#000' }]}><Text style={styles.scanText}>Waiting for camera permission...</Text></View>}
    </Modal>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanHint: { position: 'absolute', top: 70, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  scanCancel: { position: 'absolute', bottom: 60, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 28, paddingVertical: 14 },
  scanText: { color: '#fff', fontSize: 16 }
})
