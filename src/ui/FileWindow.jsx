// A file in a window of its own (desktop, proposals/2026-10-26-file-windows.md).
// desktop/main.js loads the UI with ?file=<id>; this draws that file's
// editor alone. Links to other files and folders open in the main window.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { call, on } from './bridge.js'
import { applyTheme } from './theme.js'
import { SheetView } from './sheet/SheetView.jsx'
import { DocView } from './doc/DocView.jsx'
import { SlidesView } from './slides/SlidesView.jsx'
import { useFolders } from './Folders.jsx'
import { untitled } from './Files.jsx'

const EDITORS = { sheet: SheetView, doc: DocView, slides: SlidesView }

export function FileWindow ({ fileId }) {
  const [sheetId, setSheetId] = useState(fileId)
  const idRef = useRef(fileId)
  idRef.current = sheetId
  const [files, setFiles] = useState(null)
  const [error, setError] = useState(null)
  const { folders } = useFolders()

  const refresh = useCallback(async () => {
    try { setFiles(await call('sheet:list')) } catch (err) { setError(err.message) }
  }, [])
  const soon = useRef(null)
  const refreshSoon = useCallback(() => {
    if (soon.current) return
    soon.current = setTimeout(() => { soon.current = null; refresh() }, 300)
  }, [refresh])
  const gone = useCallback(() => call('app:windowGone').catch(() => window.close()), [])

  useEffect(() => {
    refresh()
    // The theme chosen in the main window (kept in this page's storage).
    const theme = () => applyTheme()
    window.addEventListener('storage', theme)
    const offs = [
      on('sheet:changed', refreshSoon),
      on('sheet:members', refreshSoon),
      on('sheet:removed', refresh),
      // Moved to fresh keys: this window follows it.
      on('sheet:moved', async ({ from, to }) => {
        if (from !== idRef.current) return refresh()
        await call('app:windowMoved', { from, to }).catch(() => {})
        setSheetId(to)
        refresh()
      }),
      on('sheet:gone', ({ sheetId: id }) => { if (id === idRef.current) gone(); else refresh() }),
      on('worklet:exit', () => setError('The sync engine stopped. Restart PearOffice.'))
    ]
    return () => { window.removeEventListener('storage', theme); offs.forEach((off) => off()) }
  }, [refresh, refreshSoon, gone])

  const f = files && files.find((x) => x.sheetId === sheetId)
  // Removed, deleted or never here: nothing to show.
  useEffect(() => { if (files && (!f || f.removed || f.waiting)) gone() }, [files, f, gone])
  useEffect(() => { document.title = f ? f.title || untitled(f.kind) : 'PearOffice' }, [f])

  const Editor = f && EDITORS[f.kind || 'sheet']
  return (
    <div className='app file-window'>
      <main className='main'>
        {error && <div className='banner' role='alert'>{error} <button className='link-button' onClick={() => setError(null)}>Dismiss</button></div>}
        {!files
          ? <div className='loading'>Opening...</div>
          : !Editor
              ? <div className='empty'><h1>Update PearOffice to open this file.</h1></div>
              : (
                <Editor
                  key={sheetId}
                  sheetId={sheetId}
                  files={files}
                  folders={folders}
                  onOpenFile={(id) => call('app:openInMain', { sheetId: id }).catch(() => {})}
                  onOpenFolder={(id) => call('app:openInMain', { folderId: id }).catch(() => {})}
                  onTitleChange={refresh}
                  onError={setError}
                  onGone={gone}
                />
                )}
      </main>
    </div>
  )
}
