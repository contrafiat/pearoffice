// Slide layouts (proposals/2026-10-06-slides.md, "What Slides v1 is"). A
// layout only places text boxes: each role gets a frame in slide space
// (1920 x 1080; a 4:3 deck scales the x values). Changing a slide's layout
// moves its boxes to the new frames and keeps their text (slidesModel.js).
//
// Roles: `title`, `body` and `body2` (the second column).

const LAYOUTS = {
  title: {
    label: 'Title',
    boxes: [
      { role: 'title', frame: { x: 160, y: 300, w: 1600, h: 280, rot: 0 } },
      { role: 'body', frame: { x: 160, y: 620, w: 1600, h: 160, rot: 0 } }
    ]
  },
  content: {
    label: 'Title and content',
    boxes: [
      { role: 'title', frame: { x: 120, y: 60, w: 1680, h: 180, rot: 0 } },
      { role: 'body', frame: { x: 120, y: 280, w: 1680, h: 720, rot: 0 } }
    ]
  },
  twoColumns: {
    label: 'Two columns',
    boxes: [
      { role: 'title', frame: { x: 120, y: 60, w: 1680, h: 180, rot: 0 } },
      { role: 'body', frame: { x: 120, y: 280, w: 810, h: 720, rot: 0 } },
      { role: 'body2', frame: { x: 990, y: 280, w: 810, h: 720, rot: 0 } }
    ]
  },
  section: {
    label: 'Section header',
    boxes: [
      { role: 'title', frame: { x: 160, y: 420, w: 1600, h: 240, rot: 0 } },
      { role: 'body', frame: { x: 160, y: 680, w: 1600, h: 140, rot: 0 } }
    ]
  },
  titleOnly: {
    label: 'Title only',
    boxes: [
      { role: 'title', frame: { x: 120, y: 60, w: 1680, h: 180, rot: 0 } }
    ]
  },
  blank: {
    label: 'Blank',
    boxes: []
  }
}

const LAYOUT_IDS = Object.keys(LAYOUTS)
const ROLES = ['title', 'body', 'body2']

// A layout's boxes for a deck of the given size, x scaled from 1920 wide.
function boxesFor (layout, size = [1920, 1080]) {
  const def = LAYOUTS[layout] || LAYOUTS.blank
  const sx = (size[0] || 1920) / 1920
  const sy = (size[1] || 1080) / 1080
  return def.boxes.map((b) => ({
    role: b.role,
    frame: { x: Math.round(b.frame.x * sx), y: Math.round(b.frame.y * sy), w: Math.round(b.frame.w * sx), h: Math.round(b.frame.h * sy), rot: 0 }
  }))
}

module.exports = { LAYOUTS, LAYOUT_IDS, ROLES, boxesFor }
