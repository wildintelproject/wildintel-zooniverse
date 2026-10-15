import type { ReactNode } from 'react'

/** One step of the page: open (its content), done (a tick, a summary and an
 * Edit button), locked (greyed, until the steps before it are done) or idle
 * (not done, but it can be opened — steps that don't depend on each other). The
 * content stays mounted once reached, so closing a step keeps its choices. */
export default function WizardStep({ n, title, description, status, summary, canEdit, onEdit, children }: {
  n: number
  title: string
  description: ReactNode
  status: 'open' | 'done' | 'locked' | 'idle'
  summary?: ReactNode
  canEdit: boolean
  onEdit: () => void
  children?: ReactNode
}) {
  const locked = status === 'locked'
  return (
    <section className="py-5 border-t first:border-t-0 border-zinc-200 dark:border-zinc-700">
      <div className="flex items-start gap-3">
        <span className={`w-8 h-8 rounded-full text-sm flex items-center justify-center font-bold flex-shrink-0 ${
          status === 'done' ? 'bg-emerald-700 text-white'
            : status === 'open' ? 'bg-blue-600 text-white'
              : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}
        >
          {status === 'done'
            ? <svg role="img" aria-label="Done" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            : n}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={`text-base font-semibold ${locked ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}>{n}. {title}</h4>
            {status === 'done' && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">Completed</span>
            )}
          </div>
          {status === 'done' && summary
            ? <div className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">{summary}</div>
            : status !== 'open' && <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>}
          {status === 'open' && <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>}
        </div>
        {status === 'idle' && (
          <button type="button" className="text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50" disabled={!canEdit} onClick={onEdit} aria-label={`Open ${title}`}>
            Open
          </button>
        )}
        {status === 'done' && (
          <button type="button" className="text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50" disabled={!canEdit} onClick={onEdit} aria-label={`Edit ${title}`}>
            Edit
          </button>
        )}
        {locked && (
          <svg role="img" aria-label="Locked" className="w-5 h-5 mt-1 text-zinc-500 dark:text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path strokeLinecap="round" d="M8 11V8a4 4 0 118 0v3" />
          </svg>
        )}
      </div>
      {!locked && <div className={status === 'open' ? 'mt-4 ml-11' : 'hidden'}>{children}</div>}
    </section>
  )
}
