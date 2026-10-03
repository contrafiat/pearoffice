// Hash the output of each Math function over the same pseudo-random inputs, to
// see which ones differ between JS engines.
if ((typeof Bare !== 'undefined' ? Bare.argv : process.argv).includes('--det')) require('./detmath')
let s = 12345
function rnd () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
const fns = { pow: (x, y) => Math.pow(x * 4, y * 60 - 30), exp: (x) => Math.exp(x * 100 - 50), log: (x) => Math.log(x * 1e6), sin: (x) => Math.sin(x * 1e4), cos: (x) => Math.cos(x * 1e4), tan: (x) => Math.tan(x * 10), atan2: (x, y) => Math.atan2(x - 0.5, y - 0.5), sqrt: (x) => Math.sqrt(x * 1e9), cbrt: (x) => Math.cbrt(x * 1e9), log10: (x) => Math.log10(x * 1e9), expm1: (x) => Math.expm1(x), log1p: (x) => Math.log1p(x), sinh: (x) => Math.sinh(x * 10), atan: (x) => Math.atan(x * 10), asin: (x) => Math.asin(x), acos: (x) => Math.acos(x), starstar: (x, y) => (x * 4) ** (y * 60 - 30) }
const out = {}
for (const [name, f] of Object.entries(fns)) {
  s = 12345
  let h = 0
  const view = new DataView(new ArrayBuffer(8))
  for (let i = 0; i < 20000; i++) {
    view.setFloat64(0, f(rnd(), rnd()))
    h = (Math.imul(h, 31) + view.getUint32(0) ^ view.getUint32(4)) | 0
  }
  out[name] = h
}
console.log(JSON.stringify(out))
