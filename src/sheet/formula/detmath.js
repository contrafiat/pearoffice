// Deterministic Math.pow, Math.sin and Math.cos.
//
// V8 versions disagree on the last bits of these three (measured: V8 12.4 in
// Node 22 vs V8 14.8 in Bare 1.34), and desktop, phones and future app versions
// all run different V8s. The @stdlib ports are pure JS fdlibm, built only from
// + - * / and bit operations, which IEEE 754 makes exact everywhere. See
// spikes/formula/RESULTS.md. The 13 other Math functions the spike checked
// already agree.
//
// Installed globally, once, at worklet start (and in tests), so that formulajs,
// jstat and bessel pick them up without patching each library. Nothing else in
// the worklet depends on the low bits of these functions.

const pow = require('@stdlib/math-base-special-pow')
const sin = require('@stdlib/math-base-special-sin')
const cos = require('@stdlib/math-base-special-cos')

let installed = false

function installDeterministicMath () {
  if (installed) return
  Math.pow = pow
  Math.sin = sin
  Math.cos = cos
  installed = true
}

module.exports = { installDeterministicMath, pow, sin, cos }
