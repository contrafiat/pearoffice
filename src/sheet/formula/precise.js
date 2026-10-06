// Precise gamma and beta functions for jstat.
//
// jstat's own gamma, log-gamma and incomplete beta are short approximations
// good to about 8 digits, so GAMMA, F.DIST, T.INV.2T, CONFIDENCE.T, T.TEST
// and the rest of the distributions built on them were off from Excel in the
// 9th digit. The @stdlib ports (from Boost and Cephes) are good to about 15
// and, like detmath.js, are pure JS built from + - * / and bit operations, so
// every device gets the same bits.
//
// Installed once at start-up, on the one jstat that formulajs and
// fast-formula-parser share, so every distribution picks them up.

const jStat = require('jstat')
const gamma = require('@stdlib/math-base-special-gamma')
const gammaln = require('@stdlib/math-base-special-gammaln')
const betainc = require('@stdlib/math-base-special-betainc')
const betaincinv = require('@stdlib/math-base-special-betaincinv')
const gammainc = require('@stdlib/math-base-special-gammainc')

let installed = false

function installPreciseStatistics () {
  if (installed) return
  const old = { gammaln: jStat.gammaln, gammafn: jStat.gammafn }
  // Non-positive arguments keep jstat's answers (NaN and Infinity at the
  // poles), which the functions above turn into Excel's errors.
  jStat.gammaln = (x) => x > 0 ? gammaln(x) : old.gammaln(x)
  jStat.gammafn = (x) => x > 0 || x !== Math.floor(x) ? gamma(x) : old.gammafn(x)
  jStat.ibeta = (x, a, b) => {
    if (x < 0 || x > 1) return false
    if (x === 0) return 0
    if (x === 1) return 1
    return betainc(x, a, b)
  }
  jStat.ibetainv = (p, a, b) => p <= 0 ? 0 : p >= 1 ? 1 : betaincinv(p, a, b)
  jStat.lowRegGamma = (a, x) => x < 0 || a <= 0 ? NaN : gammainc(x, a)
  installed = true
}

module.exports = { installPreciseStatistics }
