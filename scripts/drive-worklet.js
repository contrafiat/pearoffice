// Drive a real worklet bundle from Node for manual cross-machine checks.
//   node scripts/drive-worklet.js <dataDir> <script.json>
// script.json is a list of steps:
//   { "call": "sheet:create", "args": {...}, "as": "name" }  saves the result
//   { "waitFor": "sheet:view", "args": {...}, "until": "js expression of r", "timeout": 60000 }
//   { "print": "js expression" }   { "sleep": ms }   { "readLine": "name" } reads a line from stdin
// Args may reference saved results as "$name.field".
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { root, barePath } = require('./bare')

const [dataDir, scriptPath] = process.argv.slice(2)
const steps = JSON.parse(fs.readFileSync(scriptPath, 'utf8'))
const p = spawn(barePath(), [path.join(root, 'dist', 'worklet', 'worklet.bundle')], { stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''; let id = 1; const pend = new Map()
p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) !== -1) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(l) } catch { continue } if (!m.event && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(m.error)) : q.res(m.result) } } })
const call = (method, args = {}) => new Promise((res, rej) => { const n = id++; pend.set(n, { res, rej }); p.stdin.write(JSON.stringify({ id: n, method, args }) + '\n') })
const saved = {}
const sub = (v) => typeof v === 'string' && v.startsWith('$') ? v.slice(1).split('.').reduce((o, k) => o[k], saved) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)])) : v
const lines = []; let lineWaiter = null
process.stdin.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) { if (lineWaiter) { const w = lineWaiter; lineWaiter = null; w(l) } else lines.push(l) } })
const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'
;(async () => {
  try {
    await call('init', { dataDir })
    for (const s of steps) {
      if (s.call) { const r = await call(s.call, sub(s.args || {})); if (s.as) saved[s.as] = r }
      else if (s.waitFor) {
        const until = new Function('r', 'return (' + s.until + ')')
        const end = Date.now() + (s.timeout || 60000); let ok = false; let r
        while (Date.now() < end && !ok) { try { r = await call(s.waitFor, sub(s.args || {})); ok = !!until(r) } catch {} if (!ok) await new Promise((x) => setTimeout(x, 500)) }
        console.log(T(), 'waitFor', s.waitFor, s.until, ok ? 'OK' : 'TIMED OUT')
        if (!ok) throw new Error('timed out')
      } else if (s.print) console.log(T(), new Function('s', 'return (' + s.print + ')')(saved))
      else if (s.sleep) await new Promise((x) => setTimeout(x, s.sleep))
      else if (s.readLine) saved[s.readLine] = lines.length ? lines.shift() : await new Promise((x) => { lineWaiter = x })
    }
  } catch (e) { console.log(T(), 'FAILED', e.message); process.exitCode = 1 } finally { p.kill() }
})()
