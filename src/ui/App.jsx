import React, { useCallback, useEffect, useState } from 'react'
import { call, on } from './bridge.js'
import { SheetView } from './SheetView.jsx'

export function App () {
  const [sheets, setSheets] = useState(null)
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setSheets(await call('sheet:list'))
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const offExit = on('worklet:exit', () => setError('The sync engine stopped. Restart PearSheet.'))
    return offExit
  }, [refresh])

  async function create () {
    try {
      const { sheetId } = await call('sheet:create', { title: 'Untitled sheet' })
      await refresh()
      setCurrent(sheetId)
    } catch (err) {
      setError(err.message)
    }
  }

  // Open the most recent sheet on start.
  useEffect(() => {
    if (sheets && sheets.length && !current) setCurrent(sheets[sheets.length - 1].sheetId)
  }, [sheets, current])

  return (
    <div className='app'>
      <aside className='sidebar'>
        <div className='brand'>
          <span className='brand-mark' aria-hidden='true' />
          PearSheet
        </div>
        <button className='new-sheet' onClick={create}>New sheet</button>
        <nav className='sheet-list' aria-label='Your sheets'>
          {sheets === null && <p className='muted'>Starting...</p>}
          {sheets && sheets.length === 0 && <p className='muted'>No sheets yet.</p>}
          {sheets && [...sheets].reverse().map((s) => (
            <button
              key={s.sheetId}
              className={'sheet-link' + (s.sheetId === current ? ' active' : '')}
              onClick={() => setCurrent(s.sheetId)}
            >
              {s.title || 'Untitled sheet'}
            </button>
          ))}
        </nav>
      </aside>
      <main className='main'>
        {error && <div className='banner' role='alert'>{error}</div>}
        {current
          ? <SheetView key={current} sheetId={current} onTitleChange={refresh} onError={setError} />
          : (
            <div className='empty'>
              <h1>Shared spreadsheets, device to device.</h1>
              <p>No accounts and no servers. Create a sheet to start.</p>
              <button className='new-sheet big' onClick={create}>New sheet</button>
            </div>
            )}
      </main>
    </div>
  )
}
