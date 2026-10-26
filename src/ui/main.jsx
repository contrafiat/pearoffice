import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { Audience } from './slides/Present.jsx'
import { FileWindow } from './FileWindow.jsx'
import { applyTheme } from './theme.js'
import { FONT_CSS } from './fonts.js'

// The suite font, before first paint.
const fontStyle = document.createElement('style')
fontStyle.textContent = FONT_CSS
document.head.appendChild(fontStyle)

// The desktop's second window during a slide show (desktop/main.js) loads
// this page with ?audience=<deck id>&slide=<slide id>.
const query = new URLSearchParams(window.location.search)
const audience = query.get('audience')

// A file in a window of its own loads it with ?file=<id>
// (proposals/2026-10-26-file-windows.md).
const fileId = query.get('file')
if (fileId) applyTheme()

createRoot(document.getElementById('root')).render(audience ? <Audience sheetId={audience} startId={query.get('slide') || null} /> : fileId ? <FileWindow fileId={fileId} /> : <App />)
