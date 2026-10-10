interface Props {
  labels: string[]
  /** The index of the step being shown; those before it are done. */
  current: number
}

/** The wizard's step indicator: equal columns, one per step, with a line
 * between each circle and the next — however long their labels are. */
export default function Stepper({ labels, current }: Props) {
  return (
    <div className="grid mb-10" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((label, i) => (
        <div key={label} className="relative flex flex-col items-center">
          <div
            className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center font-bold mb-1 text-sm ${
              i < current ? 'bg-emerald-600 text-white' : i === current ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </div>
          <small className={`text-xs whitespace-nowrap ${i === current ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {label}
          </small>
          {i < labels.length - 1 && (
            // From this circle's edge to the next one's, with a small gap on each side.
            <div
              aria-hidden="true"
              className={`absolute top-[18px] border-t ${i < current ? 'border-emerald-500' : 'border-zinc-700'}`}
              style={{ left: 'calc(50% + 26px)', right: 'calc(-50% + 26px)' }}
            />
          )}
        </div>
      ))}
    </div>
  )
}
