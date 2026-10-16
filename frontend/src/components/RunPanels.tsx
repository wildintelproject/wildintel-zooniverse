import { useState } from 'react'
import type { ReactNode } from 'react'
import ProgressBar from './ProgressBar'

/** The technical side of an export, folded away. */
export function DetailsPanel({ rows, defaultOpen = false, children }: { rows: [string, string][]; defaultOpen?: boolean; children?: ReactNode }) {
  const [shown, setShown] = useState(defaultOpen)
  return (
    <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <button
        type="button" aria-expanded={shown} onClick={() => setShown((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-zinc-800 dark:text-zinc-100"
      >
        Details
        <svg aria-hidden="true" className={`w-4 h-4 transition-transform ${shown ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {shown && (
        <div className="px-4 pb-3">
          <dl className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2">
                <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
                <dd className="text-zinc-800 dark:text-zinc-200 text-right break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
          {children}
        </div>
      )}
    </div>
  )
}

export function BigNumber({ label, value, percent, caption, tone }: { label: string; value: number; percent: number | null; caption: string; tone: 'blue' | 'emerald' | 'amber' | 'red' }) {
  return (
    <div className="mt-3 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="text-4xl font-bold text-zinc-900 dark:text-zinc-100 my-1">{value.toLocaleString()}</p>
      {percent !== null && <ProgressBar percent={percent} label={label} tone={tone} />}
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{caption}</p>
    </div>
  )
}

const BANNERS = {
  blue: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30',
  emerald: 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30',
  amber: 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30',
  red: 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30',
}

/** What a run says of itself, in a coloured band: a title, a line under it and, to the right, its buttons. */
export function RunBanner({ tone, title, detail, children }: { tone: keyof typeof BANNERS; title: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-3 flex-wrap p-4 rounded-lg border ${BANNERS[tone]}`}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
        {detail && <p className="text-sm text-zinc-600 dark:text-zinc-300 break-words">{detail}</p>}
      </div>
      {children}
    </div>
  )
}

/** A row of figures, each with what it counts. */
export function StatGrid({ items }: { items: { value: string; label: string; hint?: string }[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      {items.map(({ value, label, hint }) => (
        <div key={label} className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700" title={hint}>
          <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
        </div>
      ))}
    </div>
  )
}
