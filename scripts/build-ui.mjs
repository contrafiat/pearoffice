// Build the web UI into dist/ui (index.html, app.js, app.css). The desktop
// renderer loads it from disk; the mobile WebView will load the same files.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'ui')

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
  define: { 'process.env.NODE_ENV': JSON.stringify(process.argv.includes('--minify') ? 'production' : 'development') },
  logLevel: 'warning'
})

copyFileSync(join(root, 'src', 'ui', 'index.html'), join(out, 'index.html'))
copyFileSync(join(root, 'src', 'ui', 'app.css'), join(out, 'app.css'))
console.log('ui built to dist/ui')
