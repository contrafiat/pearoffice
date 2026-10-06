// Starts the Bare worklet as a child process and talks newline-delimited JSON
// over its stdin/stdout, the IPC format @peerloom/core already uses. Adapted
// from pearcircle/seeder-launcher/host/worklet.js.
//
//   const wl = new Worklet({ barePath, bundlePath, dataDir })
//   await wl.start()                     // spawns and sends init
//   await wl.call('sheet:list', {})
//   wl.on('event', ({ name, data }) => ...)
//   await wl.stop()

const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')

class Worklet extends EventEmitter {
  constructor ({ barePath, bundlePath, dataDir, onLog }) {
    super()
    this._barePath = barePath
    this._bundlePath = bundlePath
    this._dataDir = dataDir
    this._onLog = onLog || (() => {})
    this._proc = null
    this._buf = ''
    this._nextId = 1
    this._pending = new Map()
    this._readyP = null
  }

  start () {
    if (this._proc) return this._readyP
    // barePath is one executable path. Never split it on spaces: Windows
    // install paths contain them.
    this._proc = spawn(this._barePath, [this._bundlePath], { stdio: ['pipe', 'pipe', 'pipe'] })
    this._proc.stdout.on('data', (chunk) => this._onStdout(chunk))
    this._proc.stderr.on('data', (chunk) => this._onLog('stderr', chunk.toString()))
    this._proc.on('exit', (code, signal) => {
      this._failPending(new Error(`worklet exited (code=${code} signal=${signal})`))
      this._proc = null
      this.emit('exit', { code, signal })
    })
    this._proc.on('error', (err) => {
      this._failPending(err)
      this.emit('error', err)
    })
    this._readyP = this.call('init', { dataDir: this._dataDir }, { timeoutMs: 60000 })
    return this._readyP
  }

  // Resolves once init has finished: methods called earlier find no local
  // database yet.
  ready () {
    return (this._readyP || Promise.resolve()).catch(() => {})
  }

  call (method, args = {}, { timeoutMs = 15000 } = {}) {
    if (!this._proc) return Promise.reject(new Error('worklet not running'))
    const id = this._nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error(`worklet ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this._pending.set(id, { resolve, reject, timer })
      this._proc.stdin.write(JSON.stringify({ id, method, args }) + '\n')
    })
  }

  _onStdout (chunk) {
    this._buf += chunk.toString('utf8')
    let nl
    while ((nl = this._buf.indexOf('\n')) !== -1) {
      const line = this._buf.slice(0, nl)
      this._buf = this._buf.slice(nl + 1)
      if (!line.trim()) continue
      let msg
      try { msg = JSON.parse(line) } catch {
        this._onLog('worklet', line) // core's mark() lines and other output
        continue
      }
      if (msg.event) {
        this.emit('event', { name: msg.event, data: msg.data })
        continue
      }
      const pending = msg.id != null && this._pending.get(msg.id)
      if (!pending) { this._onLog('worklet', line); continue }
      this._pending.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.error) pending.reject(new Error(msg.error))
      else pending.resolve(msg.result)
    }
  }

  _failPending (err) {
    for (const { reject, timer } of this._pending.values()) {
      clearTimeout(timer)
      reject(err)
    }
    this._pending.clear()
  }

  // Ask the worklet to close its stores cleanly, then make sure it is gone.
  async stop () {
    const p = this._proc
    if (!p) return
    try { await this.call('app:close', {}, { timeoutMs: 5000 }) } catch {}
    await new Promise((resolve) => {
      if (p.exitCode !== null) return resolve()
      const t = setTimeout(() => { try { p.kill('SIGKILL') } catch {} resolve() }, 3000)
      p.once('exit', () => { clearTimeout(t); resolve() })
      try { p.kill('SIGTERM') } catch {}
    })
  }
}

module.exports = { Worklet }
