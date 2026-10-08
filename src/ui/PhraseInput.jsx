import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import WORDS from '../shared/vendor/bip39-english.json'

// Typing the 12-word recovery phrase (proposals/2026-10-07-phrase-recovers-files.md,
// step 4). On phones one word at a time, on desktop a grid of 12 boxes. Both
// suggest words from the BIP39 list once two letters are typed; the first 4
// letters of every word are unique, so 4 letters always pick one. Pasting or
// typing several words fills the boxes from the current one on.
//
// value: the phrase so far, words joined by spaces; onChange gets the same.
// The first box (or the one box) gets `className`, for focus and tests.

const COUNT = 12
const KNOWN = new Set(WORDS)
const SHOWN = 5

const split = (text) => String(text || '').toLowerCase().trim().split(/\s+/).filter(Boolean)

function fromValue (value) {
  const w = split(value).slice(0, COUNT)
  while (w.length < COUNT) w.push('')
  return w
}

export function suggest (prefix) {
  const p = String(prefix || '').toLowerCase().trim()
  if (p.length < 2) return []
  const out = []
  for (const w of WORDS) {
    if (w.startsWith(p)) { out.push(w); if (out.length >= SHOWN) break }
  }
  return out
}

// The word a prefix stands for when only one word starts with it.
function only (prefix) {
  const m = suggest(prefix)
  return m.length === 1 ? m[0] : null
}

export function PhraseInput ({ value, onChange, oneAtATime = false, className = '', autoFocus = false, inputRef = null, disabled = false }) {
  const [words, setWords] = useState(() => fromValue(value))
  const [at, setAt] = useState(0)
  const [left, setLeft] = useState(() => new Set()) // boxes typed in and left
  const boxes = useRef([])
  const one = useRef(null)

  // A change from outside (cleared, or set by the parent).
  useEffect(() => {
    if (split(value).join(' ') !== words.filter(Boolean).join(' ')) setWords(fromValue(value))
  }, [value])

  const emit = (next) => {
    setWords(next)
    onChange(next.filter(Boolean).join(' '))
  }

  const focus = (i) => {
    const n = Math.max(0, Math.min(COUNT - 1, i))
    setAt(n)
    if (oneAtATime) setTimeout(() => one.current && one.current.focus(), 0)
    else setTimeout(() => boxes.current[n] && boxes.current[n].focus(), 0)
  }

  // Typing in box i: several words fill i onwards.
  const type = (i, text) => {
    const parts = split(text)
    const next = [...words]
    if (parts.length > 1 || /\s$/.test(text)) {
      parts.slice(0, COUNT - i).forEach((w, k) => { next[i + k] = w })
      if (!parts.length) next[i] = ''
      emit(next)
      setLeft((s) => new Set([...s, ...parts.slice(0, /\s$/.test(text) ? parts.length : parts.length - 1).map((_, k) => i + k)]))
      // Still typing the last word unless the text ends in a space.
      focus(i + (/\s$/.test(text) ? Math.max(1, parts.length) : parts.length - 1))
      return
    }
    next[i] = text.toLowerCase().replace(/\s/g, '')
    emit(next)
  }

  const pick = (i, word) => {
    const next = [...words]
    next[i] = word
    emit(next)
    setLeft((s) => new Set([...s, i]))
    focus(i + 1)
  }

  // Space and Tab finish a word; Enter does too while it is a prefix of
  // one word, and otherwise submits the form.
  const keyDown = (i, e) => {
    const w = words[i]
    if (e.key === ' ' || (e.key === 'Enter' && w && !KNOWN.has(w) && only(w))) {
      e.preventDefault()
      const u = only(w)
      if (u) pick(i, u)
      else if (w) { setLeft((s) => new Set([...s, i])); focus(i + 1) }
    } else if (e.key === 'Backspace' && !w && i > 0) {
      e.preventDefault()
      focus(i - 1)
    }
  }

  const blur = (i) => {
    const w = words[i]
    if (w && !KNOWN.has(w) && only(w)) {
      const next = [...words]
      next[i] = only(w)
      emit(next)
    }
    setLeft((s) => new Set([...s, i]))
  }

  const current = words[at] || ''
  const shown = KNOWN.has(current) ? [] : suggest(current)
  const bad = (i) => left.has(i) && words[i] && !KNOWN.has(words[i]) && i !== at

  const suggestions = shown.length > 0 && (
    <div className='phrase-suggest' role='listbox' aria-label='Suggestions'>
      {shown.map((w) => (
        <button type='button' key={w} role='option' aria-selected='false' onMouseDown={(e) => e.preventDefault()} onClick={() => pick(at, w)}>{w}</button>
      ))}
    </div>
  )

  const common = (i) => ({
    autoComplete: 'off',
    autoCapitalize: 'none',
    autoCorrect: 'off',
    spellCheck: false,
    disabled,
    value: words[i],
    onChange: (e) => type(i, e.target.value),
    onKeyDown: (e) => keyDown(i, e),
    onFocus: () => setAt(i),
    onBlur: () => blur(i)
  })

  if (oneAtATime) {
    return (
      <div className='phrase-one'>
        <label className='phrase-one-label' htmlFor='phrase-one-word'>Word {at + 1} of {COUNT}</label>
        <div className='phrase-one-row'>
          <button type='button' className='phrase-one-step' aria-label='Previous word' disabled={disabled || at === 0} onClick={() => focus(at - 1)}><ArrowLeft size={18} aria-hidden='true' /></button>
          <input
            id='phrase-one-word'
            ref={(el) => { one.current = el; if (inputRef) inputRef.current = el }}
            className={'phrase-one-input ' + className + (bad(at) ? ' bad' : '')}
            aria-label={'Word ' + (at + 1)}
            autoFocus={autoFocus}
            enterKeyHint={at < COUNT - 1 ? 'next' : 'done'}
            {...common(at)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && at < COUNT - 1) {
                e.preventDefault()
                const u = KNOWN.has(current) ? current : only(current)
                if (u) pick(at, u)
                return
              }
              keyDown(at, e)
            }}
          />
          <button type='button' className='phrase-one-step' aria-label='Next word' disabled={disabled || at === COUNT - 1} onClick={() => { const u = KNOWN.has(current) ? current : only(current); if (u) pick(at, u); else focus(at + 1) }}><ArrowRight size={18} aria-hidden='true' /></button>
        </div>
        {suggestions}
        <ol className='phrase-one-sofar' aria-label='Your words so far'>
          {words.map((w, i) => (
            <li key={i} className={(i === at ? 'here' : '') + (bad(i) ? ' bad' : '')}>
              <button type='button' disabled={disabled} onClick={() => focus(i)} aria-label={'Word ' + (i + 1) + (w ? ': ' + w : ', empty')}>{w || ' '}</button>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div className='phrase-grid-wrap'>
      <ol className='phrase-grid'>
        {words.map((w, i) => (
          <li key={i} className={bad(i) ? 'bad' : ''}>
            <input
              ref={(el) => { boxes.current[i] = el; if (i === 0 && inputRef) inputRef.current = el }}
              className={i === 0 ? className : undefined}
              aria-label={'Word ' + (i + 1)}
              autoFocus={autoFocus && i === 0}
              {...common(i)}
            />
          </li>
        ))}
      </ol>
      {suggestions}
    </div>
  )
}
