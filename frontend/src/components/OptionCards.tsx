export interface Option<T extends string> {
  value: T
  emoji: string
  title: string
  description: string
  available: boolean
}

/** A choice among big cards — one per option, those not available yet
 * disabled with a "Coming soon" badge. */
export default function OptionCards<T extends string>({ options, selected, onChoose }: { options: Option<T>[]; selected: T | null; onChoose: (value: T) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={!option.available}
          onClick={() => onChoose(option.value)}
          className={[
            'relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 text-center transition-colors',
            !option.available
              ? 'border-zinc-200 dark:border-zinc-800 opacity-50 cursor-not-allowed'
              : selected === option.value
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 cursor-pointer'
                : 'border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer',
          ].join(' ')}
        >
          {!option.available && (
            <span className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">
              Coming soon
            </span>
          )}
          <span className="text-4xl">{option.emoji}</span>
          <strong className="text-zinc-900 dark:text-zinc-100">{option.title}</strong>
          <span className="text-zinc-500 dark:text-zinc-400 text-sm">{option.description}</span>
        </button>
      ))}
    </div>
  )
}
