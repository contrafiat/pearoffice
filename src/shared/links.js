// A link on a picture or shape (proposals/2026-10-26-picture-links.md): a web
// or email address, or another file or a folder
// (proposals/2026-10-22-links-to-files.md), or a PearCal event or day
// (pearcal.js). Anything else is not stored.
const LINK = /^(https?:\/\/\S+|mailto:\S+|pearoffice:\/\/(file|folder)\/[A-Za-z0-9_-]+)$/i
const MAX = 2000
const { isPearcalLink } = require('./pearcal')

// The link as stored, or null.
function okLink (v) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && s.length <= MAX && (LINK.test(s) || isPearcalLink(s)) ? s : null
}

module.exports = { okLink }
