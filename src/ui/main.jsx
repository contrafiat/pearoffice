import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { Audience } from './slides/Present.jsx'
import { FONT_CSS } from './fonts.js'

// The suite font, before first paint.
const fontStyle = document.createElement('style')
fontStyle.textContent = FONT_CSS
document.head.appendChild(fontStyle)

// The desktop's second window during a slide show (desktop/main.js) loads
// this page with ?audience=<deck id>&slide=<slide id>.
const query = new URLSearchParams(window.location.search)
const audience = query.get('audience')

createRoot(document.getElementById('root')).render(audience ? <Audience sheetId={audience} startId={query.get('slide') || null} /> : <App />)
