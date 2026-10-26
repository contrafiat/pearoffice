import React from 'react'
import { themeStyle } from './themes.js'
import { StaticText, TextFrame, boxStyle } from './TextBox.jsx'
import { ElementBody } from './objects.jsx'

// A slide drawn as plain DOM with no live editors, scaled by `scale`. The
// slide list's thumbnails and the show both draw slides with this.
export function StaticSlide ({ slide, size, theme, scale }) {
  return (
    <div className='slide' data-layout={slide.layout} data-id={slide.id} data-theme={theme.id} style={{ width: size[0], height: size[1], transform: 'scale(' + scale + ')', ...themeStyle(theme) }}>
      {slide.els.map((el) => (
        <div key={el.id} className='slide-el' data-type={el.type} data-role={el.role || undefined} data-link={el.link || undefined} style={boxStyle(el.frame)}>
          <ElementBody el={el} frame={el.frame} theme={theme} text={<TextFrame frame={el.frame} role={el.role} layout={el.layout}><StaticText fragment={el.text} /></TextFrame>} />
        </div>
      ))}
    </div>
  )
}
