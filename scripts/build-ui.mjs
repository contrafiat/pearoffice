// Build the web UI into dist/ui (index.html, app.js, app.css). The desktop
// renderer loads it from disk; the mobile WebView will load the same files.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'ui')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'ui', 'main.jsx')],
  outfile: join(out, 'app.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'safari16'],
  jsx: 'automatic',
  minify: process.argv.includes('--minify'),
  sourcemap: process.argv.includes('--minify') ? false : 'inline',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.argv.includes('--minify') ? 'production' : 'development'), __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'warning'
})

copyFileSync(join(root, 'src', 'ui', 'index.html'), join(out, 'index.html'))
copyFileSync(join(root, 'src', 'ui', 'app.css'), join(out, 'app.css'))
console.log('ui built to dist/ui')

// Mobile: one self-contained script for the WebView, with the bridge and the
// stylesheet inside it, written where Metro picks it up as an asset.
if (process.argv.includes('--mobile')) {
  const result = await build({
    entryPoints: [join(root, 'src', 'ui', 'mobile-entry.js')],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['chrome100', 'safari15'],
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"', __APP_VERSION__: JSON.stringify(version) },
    logLevel: 'warning'
  })
  const css = readFileSync(join(root, 'src', 'ui', 'app.css'), 'utf8')
  const js = 'document.head.insertAdjacentHTML("beforeend",' + JSON.stringify('<style>' + css + '</style>') + ');\n' + result.outputFiles[0].text
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'assets', 'app-ui.bundle'), js)
  console.log('mobile ui built to assets/app-ui.bundle')
}
