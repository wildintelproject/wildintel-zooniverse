import type { ReactNode } from 'react'

/** A field's label, with a tick at its right once it has a value. */
export default function FieldLabel({ htmlFor, done, children }: { htmlFor: string; done: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300" htmlFor={htmlFor}>{children}</label>
      {done && (
        <svg role="img" aria-label="Done" className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12.5l2.7 2.7L16 9.5" />
        </svg>
      )}
    </div>
  )
}
