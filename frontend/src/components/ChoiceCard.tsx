import type { ReactNode } from 'react'

const TONES = {
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  zinc: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
}

/** One choice, as a card with a radio — or a checkbox. `children` is its description, part of what the
 * radio is called; `extra` goes below, outside that name (a field the choice opens, for example). */
export default function ChoiceCard({ name, selected, onSelect, type = 'radio', group, disabled = false, badge, badgeTone = 'zinc', extra, children }: {
  name: string; type?: 'radio' | 'checkbox'; group?: string; selected: boolean; onSelect: () => void; disabled?: boolean
  badge?: string; badgeTone?: keyof typeof TONES; extra?: ReactNode; children?: ReactNode
}) {
  return (
    <div
      className={[
        'rounded-lg border',
        selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-zinc-200 dark:border-zinc-700',
        disabled ? 'opacity-70' : '',
      ].join(' ')}
    >
      <label className={`flex items-start gap-3 p-4 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <input type={type} name={type === 'radio' ? group : undefined} className="mt-1" checked={selected} disabled={disabled} onChange={onSelect} />
        <span className="flex-1 min-w-0">
          <span className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{name}</span>
            {badge && <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${TONES[badgeTone]}`}>{badge}</span>}
          </span>
          {children}
        </span>
      </label>
      {extra && <div className="px-4 pb-4 ml-7">{extra}</div>}
    </div>
  )
}
