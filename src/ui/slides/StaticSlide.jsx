import React from 'react'
import { themeStyle } from './themes.js'
import { StaticText, TextFrame, boxStyle } from './TextBox.jsx'

// A slide drawn as plain DOM with no live editors, scaled by `scale`. The
// slide list's thumbnails and the show both draw slides with this.
export function StaticSlide ({ slide, size, theme, scale }) {
  return (
    <div className='slide' data-layout={slide.layout} data-id={slide.id} style={{ width: size[0], height: size[1], transform: 'scale(' + scale + ')', ...themeStyle(theme) }}>
      {slide.els.map((el) => (
        <div key={el.id} className='slide-el' data-role={el.role || undefined} style={boxStyle(el.frame)}>
          <TextFrame frame={el.frame} role={el.role}><StaticText fragment={el.text} /></TextFrame>
        </div>
      ))}
    </div>
  )
}
