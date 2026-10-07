// Deck themes (proposals/2026-10-06-slides.md): fonts, background, text and
// accent colours. The deck stores only the id (slidesModel.theme); an id
// this build does not know draws as the first theme.
//
// Fonts are Manrope (bundled with the app, weights 300 to 500) or system
// font stacks, so a deck looks the same on every device without font files.
//
// Sizes are in points of a 13.333 inch wide slide, as in PowerPoint and
// Google Slides (src/ui/slides/geometry.js, TEXT_SCALE).

const SERIF = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', 'DejaVu Serif', 'Noto Serif', serif"
const SANS = "'Manrope', system-ui, sans-serif"

export const THEMES = {
  plain: {
    label: 'Plain',
    background: '#ffffff',
    text: '#1f2420',
    muted: '#8a8f88', // placeholders
    headingFont: SANS,
    bodyFont: SANS,
    accents: ['#5b8c3a', '#2f7d8c', '#a16207', '#b3261e', '#6a4c93', '#3a5f8c'],
    titleSize: 44,
    bodySize: 24,
    titleWeight: 500
  },
  // Light text on a deep blue grey, with bright accents.
  midnight: {
    label: 'Midnight',
    background: '#161a26',
    text: '#e9ecf4',
    muted: '#6c7489',
    headingFont: SANS,
    bodyFont: SANS,
    accents: ['#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#bb9af7', '#2ac3de'],
    titleSize: 44,
    bodySize: 24,
    titleWeight: 300
  },
  // Warm paper with serif type and earthy accents.
  paper: {
    label: 'Paper',
    background: '#f6efe2',
    text: '#3a2e27',
    muted: '#a8998a',
    headingFont: SERIF,
    bodyFont: SERIF,
    accents: ['#b5532d', '#6f7f46', '#c48a2c', '#8c3b3b', '#4c6b78', '#6b4f7a'],
    titleSize: 48,
    bodySize: 24,
    titleWeight: 400
  },
  // White type on indigo, with loud accents.
  vivid: {
    label: 'Vivid',
    background: '#3730a3',
    text: '#ffffff',
    muted: '#a5a9f0',
    headingFont: SANS,
    bodyFont: SANS,
    accents: ['#facc15', '#f472b6', '#34d399', '#fb923c', '#38bdf8', '#ffffff'],
    titleSize: 54,
    bodySize: 26,
    titleWeight: 500
  }
}
for (const [id, t] of Object.entries(THEMES)) t.id = id

export const THEME_IDS = Object.keys(THEMES)

export function themeFor (id) {
  return THEMES[id] || THEMES[THEME_IDS[0]]
}

// The CSS variables a slide is drawn with (app.css, .slide).
export function themeStyle (theme) {
  const style = {
    '--slide-bg': theme.background,
    '--slide-ink': theme.text,
    '--slide-muted': theme.muted,
    '--slide-heading': theme.headingFont,
    '--slide-body': theme.bodyFont,
    '--slide-title-size': theme.titleSize + 'pt',
    '--slide-body-size': theme.bodySize + 'pt',
    '--slide-title-weight': theme.titleWeight
  }
  theme.accents.forEach((c, i) => { style['--accent' + (i + 1)] = c })
  return style
}

// The size a box's text starts at, in points.
export function defaultSize (theme, role) {
  return role === 'title' ? theme.titleSize : theme.bodySize
}
