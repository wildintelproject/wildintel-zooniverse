import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import SequencesTable, { sequencesCsv } from './SequencesTable'
import type { DeploymentCounts, PreviewCounts, TrapperSelection, UploadCriteria } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'

function SmallSpinner() {
  return <div className="w-4 h-4 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
}

function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint: ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className={`block ${hintClass}`}>{hint}</span>
      </span>
    </label>
  )
}

const COUNT_KEYS: (keyof PreviewCounts)[] = ['images', 'candidates', 'sequences', 'removed_middle', 'selected']

function CountsRow({ label, counts, expanded, onToggle }: {
  label: string; counts: PreviewCounts; expanded?: boolean; onToggle?: () => void
}) {
  return (
    <tr
      className={onToggle ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50' : ''}
      onClick={onToggle} aria-expanded={onToggle ? expanded : undefined}
    >
      <td className="py-1 pr-2 font-mono">{onToggle && (expanded ? '▾ ' : '▸ ')}{label}</td>
      {COUNT_KEYS.map((k, i) => (
        <td key={k} className={`py-1 text-right ${i === COUNT_KEYS.length - 1 ? 'pl-2' : 'px-2'}`}>{counts[k].toLocaleString()}</td>
      ))}
    </tr>
  )
}

/** The numeric fields are kept as typed, so they can be briefly empty. */
type Draft = Omit<UploadCriteria, 'max_interval' | 'images_per_sequence'> & { max_interval: string; images_per_sequence: string }

function positiveInt(value: string): number | null {
  return /^\d+$/.test(value.trim()) && Number(value) >= 1 ? Number(value) : null
}

function toCriteria(draft: Draft): UploadCriteria | null {
  const maxInterval = positiveInt(draft.max_interval)
  const perSequence = positiveInt(draft.images_per_sequence)
  if (maxInterval === null || perSequence === null) return null
  return { ...draft, max_interval: maxInterval, images_per_sequence: perSequence }
}

function sumCounts(rows: DeploymentCounts[]): PreviewCounts {
  const totals: PreviewCounts = { images: 0, candidates: 0, sequences: 0, removed_middle: 0, selected: 0 }
  for (const row of rows) for (const k of COUNT_KEYS) totals[k] += row[k]
  return totals
}

/** The preview so far: rows arrive one deployment at a time. */
interface Preview {
  rows: DeploymentCounts[]
  status: 'running' | 'done' | 'stopped' | 'error'
  error?: string
  /** "Analyze sequences": each row also has its sequences. */
  detail: boolean
}

function downloadCsv(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  selection: TrapperSelection
  initial: UploadCriteria
  /** The criteria while valid, null whenever a field isn't. */
  onCriteriaChange: (criteria: UploadCriteria | null) => void
}

/** Which of the selection's images get uploaded — the same selection
 * wildintel-tools makes: sequences by time gap, humans (and optionally
 * vehicles) removed from every sequence but a deployment's first and last,
 * then a few evenly spaced images kept from each. */
export default function UploadCriteriaForm({ selection, initial, onCriteriaChange }: Props) {
  const [draft, setDraft] = useState<Draft>({
    ...initial, max_interval: String(initial.max_interval), images_per_sequence: String(initial.images_per_sequence),
  })
  const [preview, setPreview] = useState<Preview | null>(null)
  // The deployment whose sequences are shown, when analyzing them.
  const [expanded, setExpanded] = useState<string | null>(null)
  // Aborts the running preview's request — on Stop, a criteria change or
  // leaving the step.
  const abortRef = useRef<AbortController | null>(null)

  const criteria = toCriteria(draft)

  useEffect(() => {
    onCriteriaChange(toCriteria(draft))
  }, [draft, onCriteriaChange])

  useEffect(() => () => abortRef.current?.abort(), [])

  function stopPreview() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    stopPreview()
    setPreview(null) // counted with the previous criteria
  }

  async function handlePreview(detail = false) {
    if (!criteria) return
    stopPreview()
    const controller = new AbortController()
    abortRef.current = controller
    setExpanded(null)
    setPreview({ rows: [], status: 'running', detail })
    try {
      await api.trapperUploadPreview(
        selection, criteria,
        (row) => setPreview((p) => (p && { ...p, rows: [...p.rows, row] })),
        controller.signal, detail,
      )
      setPreview((p) => (p && { ...p, status: 'done' }))
    } catch (e) {
      if (controller.signal.aborted) {
        setPreview((p) => (p && p.status === 'running' ? { ...p, status: 'stopped' } : p))
      } else {
        setPreview((p) => ({ rows: p?.rows ?? [], detail, status: 'error', error: e instanceof Error ? e.message : 'Could not count the images.' }))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const running = preview?.status === 'running'
  const totals = preview ? sumCounts(preview.rows) : null
  const total = selection.deployments.length

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className={labelClass} htmlFor="criteria-max-interval">Max. gap within a sequence (seconds)</label>
          <input
            id="criteria-max-interval" className={inputClass} inputMode="numeric"
            value={draft.max_interval} onChange={(e) => set('max_interval', e.target.value)}
          />
          <p className={hintClass}>A longer gap between two consecutive images starts a new sequence.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="criteria-per-sequence">Images per sequence</label>
          <input
            id="criteria-per-sequence" className={inputClass} inputMode="numeric"
            value={draft.images_per_sequence} onChange={(e) => set('images_per_sequence', e.target.value)}
          />
          <p className={hintClass}>Evenly spaced, first and last included. Shorter sequences are kept whole.</p>
        </div>
      </div>
      {!criteria && <p className="text-sm text-red-600 dark:text-red-400 mb-4">Both numbers must be whole numbers of at least 1.</p>}

      <div className="space-y-3 mb-6">
        <Checkbox
          checked={draft.only_classified} onChange={(v) => set('only_classified', v)}
          label="Only classified images"
          hint={'Skip images with no observation, or only "unclassified" ones, in the classification project.'}
        />
        <Checkbox
          checked={draft.remove_middle_humans} onChange={(v) => set('remove_middle_humans', v)}
          label="Remove humans from middle sequences"
          hint="A deployment's first and last sequences (setting up and collecting the camera) keep them."
        />
        <Checkbox
          checked={draft.remove_middle_vehicles} onChange={(v) => set('remove_middle_vehicles', v)}
          label="Remove vehicles from middle sequences"
          hint="Same rule, for vehicles. wildintel-tools doesn't do this — it uploads them."
        />
      </div>

      <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">
            {preview && totals
              ? <>
                <strong>{totals.selected.toLocaleString()}</strong> of {totals.images.toLocaleString()} images would be uploaded
                {preview.status !== 'done' && (
                  <span className="text-zinc-500 dark:text-zinc-400"> · {preview.rows.length} of {total} deployments counted</span>
                )}
              </>
              : 'Count how many images these criteria keep.'}
          </span>
          {running
            ? <button type="button" className={btnOutline} onClick={stopPreview}><SmallSpinner />Stop</button>
            : (
              <div className="flex gap-2">
                <button type="button" className={btnOutline} disabled={!criteria} onClick={() => handlePreview(false)}>
                  {preview && !preview.detail ? 'Count again' : 'Preview'}
                </button>
                <button
                  type="button" className={btnOutline} disabled={!criteria} onClick={() => handlePreview(true)}
                  title="The preview, plus each deployment's sequences and what becomes of each image"
                >
                  {preview?.detail ? 'Analyze again' : 'Analyze sequences'}
                </button>
              </div>
            )}
        </div>
        {running && (
          <p className={hintClass}>Fetching each deployment's images and observations from Trapper, one at a time — results appear as they're counted.</p>
        )}
        {preview?.status === 'stopped' && <p className={hintClass}>Stopped — only the deployments above were counted.</p>}
        {preview?.detail && preview.rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap mt-2">
            <p className={hintClass}>Click a deployment to see its sequences; click a sequence to see its images.</p>
            <button
              type="button" className={btnOutline}
              onClick={() => downloadCsv(sequencesCsv(preview.rows), `sequences_${selection.collection.name}.csv`)}
            >
              Download sequences (CSV)
            </button>
          </div>
        )}
        {preview?.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{preview.error}</p>}
        {preview && totals && preview.rows.length > 0 && (
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500 dark:text-zinc-400 text-left">
                <tr>
                  <th className="py-1 pr-2 font-medium">Deployment</th>
                  <th className="py-1 px-2 font-medium text-right">Images</th>
                  <th className="py-1 px-2 font-medium text-right" title="Public, and classified if asked">Candidates</th>
                  <th className="py-1 px-2 font-medium text-right">Sequences</th>
                  <th className="py-1 px-2 font-medium text-right" title="Humans/vehicles removed from middle sequences">Removed</th>
                  <th className="py-1 pl-2 font-medium text-right">Upload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {preview.rows.map((d) => (
                  <Fragment key={d.deployment_id}>
                    <CountsRow
                      label={d.deployment_id} counts={d}
                      expanded={expanded === d.deployment_id}
                      onToggle={preview.detail ? () => setExpanded(expanded === d.deployment_id ? null : d.deployment_id) : undefined}
                    />
                    {preview.detail && expanded === d.deployment_id && (
                      <tr><td colSpan={6} className="pl-4"><SequencesTable deployment={d} trapperUrl={selection.url} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="border-t border-zinc-300 dark:border-zinc-600 font-semibold">
                <CountsRow label={preview.status === 'done' ? 'Total' : 'Total so far'} counts={totals} />
              </tfoot>
            </table>
          </div>
        )}
        {preview && preview.rows.length > 0 && (
          <p className={hintClass}>
            <strong>Candidates</strong> are the images that can be uploaded: their file is public in Trapper
            {draft.only_classified
              ? <> and they have at least one observation other than &ldquo;unclassified&rdquo;. Unclassified images are the usual difference from <strong>Images</strong>.</>
              : <> (classified or not).</>}
            {' '}Sequences are built from them, humans{draft.remove_middle_vehicles ? ' and vehicles' : ''} are then removed from all but
            each deployment&rsquo;s first and last sequence (<strong>Removed</strong>), and finally up to {draft.images_per_sequence} images
            are kept from each sequence (<strong>Upload</strong>).
          </p>
        )}
      </div>
    </div>
  )
}
