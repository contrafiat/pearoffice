// Replace the Math functions whose low bits vary between V8 versions with pure
// JS ports of fdlibm (only + - * / and bit ops, so IEEE 754 makes them exact
// everywhere). Spike-only global patch; the app would call these directly.
Math.pow = require('@stdlib/math-base-special-pow')
Math.sin = require('@stdlib/math-base-special-sin')
Math.cos = require('@stdlib/math-base-special-cos')
