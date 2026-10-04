import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { FONT_CSS } from './fonts.js'

// The suite font, before first paint.
const fontStyle = document.createElement('style')
fontStyle.textContent = FONT_CSS
document.head.appendChild(fontStyle)

createRoot(document.getElementById('root')).render(<App />)
