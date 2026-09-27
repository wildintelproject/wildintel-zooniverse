/** A thin progress bar — blue while running, then emerald (all good) or
 * amber (with failures). */
export default function ProgressBar({ percent, label, tone = 'blue' }: { percent: number; label: string; tone?: 'blue' | 'emerald' | 'amber' }) {
  const color = { blue: 'bg-blue-600', emerald: 'bg-emerald-600', amber: 'bg-amber-500' }[tone]
  return (
    <div
      className="h-2 rounded bg-zinc-200 dark:bg-zinc-700 overflow-hidden" role="progressbar" aria-label={label}
      aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
    >
      <div className={`h-full ${color} transition-all`} style={{ width: `${percent}%` }} />
    </div>
  )
}
