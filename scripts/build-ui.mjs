// Build the web UI into dist/ui (index.html, app.js, app.css). The desktop
// renderer loads it from disk; the mobile WebView will load the same files.
import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'ui')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const ui = await build({
  entryPoints: [join(root, 'src', 'ui', 'main.jsx')],
  outfile: join(out, 'app.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'safari16'],
  jsx: 'automatic',
  minify: process.argv.includes('--minify'),
  sourcemap: process.argv.includes('--minify') ? false : 'inline',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.argv.includes('--minify') ? 'production' : 'development'), __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
  metafile: true
})
// What went into app.js, for scripts/third-party-notices.js.
writeFileSync(join(root, 'dist', 'ui-meta.json'), JSON.stringify(ui.metafile))

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
    logLevel: 'warning',
    metafile: true
  })
  const css = readFileSync(join(root, 'src', 'ui', 'app.css'), 'utf8')
  const js = 'document.head.insertAdjacentHTML("beforeend",' + JSON.stringify('<style>' + css + '</style>') + ');\n' + result.outputFiles[0].text
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'assets', 'app-ui.bundle'), js)
  console.log('mobile ui built to assets/app-ui.bundle')

  // Licences for About > Open-source software (app:licenses in mobile/App.js):
  // the UI and the worklet bundles as built, the Bare runtime BareKit embeds
  // and the shell (React Native, Expo and what they depend on).
  writeFileSync(join(root, 'dist', 'ui-mobile-meta.json'), JSON.stringify(result.metafile))
  const { notices, withDependencies } = createRequire(import.meta.url)('./third-party-notices.js')
  const deps = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies)
  const shell = withDependencies(deps.filter((n) => /^(react|react-dom|react-native.*|expo-.*)$/.test(n)).map((n) => join(root, 'node_modules', n)))
  const bundles = ['bare-universal.bundle', 'bare-ios.bundle'].map((b) => join(root, 'assets', b)).filter((f) => existsSync(f))
  const n = notices([join(root, 'dist', 'ui-mobile-meta.json'), ...bundles], { extraDirs: [...shell, join(root, 'node_modules', 'expo'), join(root, 'node_modules', 'bare-runtime')] })
  writeFileSync(join(root, 'assets', 'third-party-notices.txt'), readFileSync(join(root, 'LICENSE'), 'utf8').trim() + '\n\n' + n.text)
  console.log('licences for ' + n.count + ' packages in assets/third-party-notices.txt')
}
