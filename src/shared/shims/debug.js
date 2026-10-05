// Stand-in for the debug package under Bare. @stdlib's inverse incomplete
// gamma (reached through betaincinv) logs through debug, whose Node build
// needs tty. Logging is off anyway, so every logger does nothing.
module.exports = function debug () {
  const log = () => {}
  log.enabled = false
  return log
}
