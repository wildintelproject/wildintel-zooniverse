import { Fragment, useState } from 'react'
import type { DeploymentCounts, SequenceDetail } from '../types'

/** Sequences shown per deployment — the CSV has them all. */
const SHOWN_SEQUENCES = 500

type Fate = 'uploaded' | 'not_sampled' | 'removed_human' | 'removed_vehicle' | 'collapsed_empty'

const FATES: { key: Fate; label: string; className: string }[] = [
  { key: 'uploaded', label: 'Uploaded', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' },
  { key: 'not_sampled', label: 'Not sampled', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  { key: 'removed_human', label: 'Removed: human', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' },
  { key: 'removed_vehicle', label: 'Removed: vehicle', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300' },
  { key: 'collapsed_empty', label: 'Collapsed: empty', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300' },
]

function time(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  return m < 60 ? `${m} min ${seconds % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** A sequence's images, by time, each coloured by what became of it — a
 * link to it in Trapper. */
function SequenceImages({ sequence, trapperUrl }: { sequence: SequenceDetail; trapperUrl: string }) {
  const fateOf = new Map<number, Fate>()
  for (const { key } of FATES) for (const id of sequence[key]) fateOf.set(id, key)
  const base = trapperUrl.replace(/\/+$/, '')
  return (
    <div className="flex flex-wrap gap-1 py-1.5">
      {sequence.order.map((id) => {
        const fate = FATES.find((f) => f.key === fateOf.get(id))!
        return (
          <a
            key={id} href={`${base}/storage/resource/media/${id}/pfile/`} target="_blank" rel="noreferrer"
            title={fate.label} className={`px-1.5 py-0.5 rounded font-mono text-[11px] hover:underline ${fate.className}`}
          >
            {id}
          </a>
        )
      })}
    </div>
  )
}

/** One deployment's sequences (the preview's "Analyze sequences"): when
 * each starts and ends, and what became of its images. */
export default function SequencesTable({ deployment, trapperUrl }: { deployment: DeploymentCounts; trapperUrl: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const sequences = deployment.sequence_detail ?? []
  if (sequences.length === 0) {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">No sequences: no image of it can be uploaded.</p>
  }
  return (
    <div className="py-2">
      <div className="flex flex-wrap gap-2 mb-2 text-[11px]">
        {FATES.map((f) => <span key={f.key} className={`px-1.5 py-0.5 rounded ${f.className}`}>{f.label}</span>)}
      </div>
      <table className="w-full text-xs" aria-label={`${deployment.deployment_id} sequences`}>
        <thead className="text-zinc-500 dark:text-zinc-400 text-left">
          <tr>
            <th className="py-1 pr-2 font-medium">#</th>
            <th className="py-1 px-2 font-medium">Start</th>
            <th className="py-1 px-2 font-medium">Duration</th>
            <th className="py-1 px-2 font-medium text-right">Images</th>
            <th className="py-1 px-2 font-medium text-right" title="Humans/vehicles removed from a middle sequence, or collapsed as an all-empty sequence">Removed</th>
            <th className="py-1 pl-2 font-medium text-right">Upload</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sequences.slice(0, SHOWN_SEQUENCES).map((s) => {
            const removed = s.removed_human.length + s.removed_vehicle.length + s.collapsed_empty.length
            return (
              <Fragment key={s.number}>
                <tr
                  className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  onClick={() => setOpen(open === s.number ? null : s.number)}
                  aria-expanded={open === s.number}
                >
                  <td className="py-1 pr-2 font-mono">{open === s.number ? '▾' : '▸'} {s.number}</td>
                  <td className="py-1 px-2">{time(s.start)}</td>
                  <td className="py-1 px-2">{duration(s.duration_s)}</td>
                  <td className="py-1 px-2 text-right">{s.images}</td>
                  <td className={`py-1 px-2 text-right ${removed ? 'text-amber-700 dark:text-amber-400' : ''}`}>{removed}</td>
                  <td className={`py-1 pl-2 text-right font-semibold ${s.uploaded.length ? '' : 'text-zinc-400'}`}>{s.uploaded.length}</td>
                </tr>
                {open === s.number && (
                  <tr><td colSpan={6}><SequenceImages sequence={s} trapperUrl={trapperUrl} /></td></tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {sequences.length > SHOWN_SEQUENCES && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          The first {SHOWN_SEQUENCES} of {sequences.length.toLocaleString()} sequences — download the CSV for all of them.
        </p>
      )}
    </div>
  )
}

/** Every deployment's sequences as a CSV — wildintel-tools' analyze-sequences
 * columns (media_ids: the uploaded ones, "|"-separated), plus the images
 * not uploaded and why. */
export function sequencesCsv(deployments: DeploymentCounts[]): string {
  const header = [
    'deploymentID', 'sequence_n', 'total_images', 'media_ids', 'first_date', 'last_date', 'duration_s',
    'not_sampled_media_ids', 'removed_human_media_ids', 'removed_vehicle_media_ids', 'collapsed_empty_media_ids',
  ]
  const rows = deployments.flatMap((d) => (d.sequence_detail ?? []).map((s) => [
    d.deployment_id, s.number, s.images, s.uploaded.join('|'), s.start, s.end, s.duration_s,
    s.not_sampled.join('|'), s.removed_human.join('|'), s.removed_vehicle.join('|'), s.collapsed_empty.join('|'),
  ]))
  const cell = (v: unknown) => {
    const text = String(v)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'
}
