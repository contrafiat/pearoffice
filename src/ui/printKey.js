// Ctrl+P (Cmd+P on a Mac) prints the open file, as the More menu's Print
// does. Desktop only: phones cannot print.

import { useEffect, useRef } from 'react'
import { isMobile } from './save.js'
import { useActiveRef } from './tabs.jsx'

export function usePrintKey (print) {
  const ref = useRef(print)
  ref.current = print
  const active = useActiveRef() // only the tab on screen prints
  useEffect(() => {
    if (isMobile()) return
    const down = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'p' || !active.current) return
      e.preventDefault()
      if (!e.repeat && ref.current) ref.current()
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [])
}
