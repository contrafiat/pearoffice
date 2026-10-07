// Deck themes (proposals/2026-10-06-slides.md): fonts, background, text and
// accent colours. The deck stores only the id (slidesModel.theme); an id
// this build does not know draws as the first theme. Part 3 adds three more.
//
// Sizes are in points of a 13.333 inch wide slide, as in PowerPoint and
// Google Slides (src/ui/slides/geometry.js, TEXT_SCALE).

export const THEMES = {
  plain: {
    label: 'Plain',
    background: '#ffffff',
    text: '#1f2420',
    muted: '#8a8f88', // placeholders
    headingFont: "'Manrope', system-ui, sans-serif",
    bodyFont: "'Manrope', system-ui, sans-serif",
    accents: ['#5b8c3a', '#2f7d8c', '#a16207', '#b3261e', '#6a4c93', '#3a5f8c'],
    titleSize: 44,
    bodySize: 24,
    titleWeight: 500
  }
}

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
