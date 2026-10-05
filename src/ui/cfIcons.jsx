// Icon sets for conditional formatting
// (proposals/2026-10-05-formula-rules-icon-sets.md): index 0 is the top icon.

import React from 'react'
import { ArrowUp, ArrowRight, ArrowDown, ArrowUpRight, ArrowDownRight, Circle, CheckCircle, WarningCircle, XCircle, CellSignalFull, CellSignalHigh, CellSignalMedium, CellSignalLow, CellSignalNone } from '@phosphor-icons/react'

const GREEN = '#3c9a5f'
const AMBER = '#e0a100'
const RED = '#c0392b'
const BLUE = '#3a5f8c'

export const ICON_SETS = {
  '3arrows': ['Arrows', [[ArrowUp, GREEN], [ArrowRight, AMBER], [ArrowDown, RED]]],
  '3traffic': ['Traffic lights', [[Circle, GREEN, 'fill'], [Circle, AMBER, 'fill'], [Circle, RED, 'fill']]],
  '3symbols': ['Symbols', [[CheckCircle, GREEN, 'fill'], [WarningCircle, AMBER, 'fill'], [XCircle, RED, 'fill']]],
  '4arrows': ['Four arrows', [[ArrowUp, GREEN], [ArrowUpRight, AMBER], [ArrowDownRight, AMBER], [ArrowDown, RED]]],
  '5ratings': ['Ratings', [[CellSignalFull, BLUE], [CellSignalHigh, BLUE], [CellSignalMedium, BLUE], [CellSignalLow, BLUE], [CellSignalNone, BLUE]]]
}

export function CfIcon ({ set, index, size = 14 }) {
  const icons = (ICON_SETS[set] || ICON_SETS['3arrows'])[1]
  const entry = icons[index]
  if (!entry) return null
  const [Icon, color, weight] = entry
  return <Icon size={size} color={color} weight={weight || 'bold'} aria-hidden='true' />
}
