import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'

export interface ComboboxOption {
  value: string
  label: string
}

interface Props {
  id: string
  options: ComboboxOption[]
  /** The chosen option's value, or '' for none. */
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  /** Accessible name for the "clear selection" button, e.g. "Clear research project". */
  clearLabel: string
}

/** A `<select>` that also filters as you type — pick from the list, or type
 * part of a label to narrow it down first. */
export default function Combobox({ id, options, value, onChange, placeholder, disabled = false, clearLabel }: Props) {
  const selected = options.find((o) => o.value === value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options
  }, [options, query])

  function choose(option: ComboboxOption) {
    onChange(option.value)
    setQuery('')
    setOpen(false)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = filtered[activeIndex]
      if (option) choose(option)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        className={[inputClass, disabled ? 'cursor-not-allowed opacity-50' : '', selected ? 'pr-8' : ''].join(' ')}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => { setQuery(''); setActiveIndex(0); setOpen(true) }}
        onBlur={() => { setOpen(false); setQuery('') }}
        onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); setOpen(true) }}
        onKeyDown={handleKeyDown}
      />
      {selected && !open && !disabled && (
        <button
          type="button"
          aria-label={clearLabel}
          className="absolute inset-y-0 right-2 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          onMouseDown={(e) => { e.preventDefault(); onChange(''); setQuery('') }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {open && (
        <ul
          id={`${id}-listbox`} role="listbox"
          className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg"
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">No matches</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={[
                'px-3 py-2 text-sm cursor-pointer font-mono flex items-center justify-between gap-2',
                i === activeIndex ? 'bg-blue-500 text-white' : 'text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700',
              ].join(' ')}
              onMouseDown={(e) => { e.preventDefault(); choose(o) }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span>{o.label}</span>
              {o.value === value && (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
