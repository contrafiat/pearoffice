import React from 'react'

// PearOffice's pear: the app icon's shape (a two-tone pear with a stem and a
// leaf), simple enough to read at sidebar size. Colours follow the theme.
export function PearMark ({ size = 18, className = '' }) {
  return (
    <svg className={'pear-mark ' + className} width={size * 0.86} height={size} viewBox='0 0 24 28' aria-hidden='true'>
      <path className='pear-leaf' d='M12.9 4.4c.9-2.3 3.4-3.5 5.9-3.1-.8 2.4-3.3 3.7-5.9 3.1z' />
      <path className='pear-stem' d='M12 7.2c0-2 .3-3.8 1.4-5.4' fill='none' strokeWidth='1.6' strokeLinecap='round' />
      <path className='pear-body' d='M12 6.6c-2.4 0-3.7 1.7-4.1 3.7-.4 1.9-1.4 3-2.7 4.5C3.9 16.3 3.2 18 3.2 19.9c0 4.7 3.9 7.6 8.8 7.6s8.8-2.9 8.8-7.6c0-1.9-.7-3.6-2-5.1-1.3-1.5-2.3-2.6-2.7-4.5-.4-2-1.7-3.7-4.1-3.7z' />
      <path className='pear-shade' d='M12 6.6c2.4 0 3.7 1.7 4.1 3.7.4 1.9 1.4 3 2.7 4.5 1.3 1.5 2 3.2 2 5.1 0 4.7-3.9 7.6-8.8 7.6z' />
    </svg>
  )
}
