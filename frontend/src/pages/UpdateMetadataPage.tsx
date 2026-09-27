import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import IdListsEditor, { NO_LISTS } from '../components/IdListsEditor'
import type { IdLists } from '../components/IdListsEditor'
import ProgressBar from '../components/ProgressBar'
import TrapperSelectionForm from '../components/TrapperSelectionForm'
import ZooniverseProjectPicker, { Divider, SmallSpinner, StepHeading } from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import type { MetadataEvent, MetadataStatus, MetadataSubjectResult, TrapperSelection } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

/** Subjects with changes kept to show (and download) — the counts cover
 * them all. */
const KEPT_CHANGES = 2000
/** Of those, the most recent shown. */
const SHOWN_CHANGES = 200

const STATUS_LABELS: Record<MetadataStatus, { label: string; hint: string; tone: string }> = {
  would_update: { label: 'Would update', hint: 'Metadata that differs from what an upload would set', tone: 'text-blue-600 dark:text-blue-400' },
  updated: { label: 'Updated', hint: 'Metadata saved in Zooniverse', tone: 'text-emerald-600 dark:text-emerald-400' },
  unchanged: { label: 'Already right', hint: 'Nothing to change', tone: 'text-zinc-900 dark:text-zinc-100' },
  unmatched: { label: 'No media id', hint: 'No Trapper media id in its metadata — left as it is', tone: 'text-amber-600 dark:text-amber-400' },
  not_found: { label: 'Not in Trapper', hint: 'Its media isn’t in the Trapper selection — left as it is', tone: 'text-amber-600 dark:text-amber-400' },
  failed: { label: 'Failed', hint: 'Couldn’t be saved', tone: 'text-red-600 dark:text-red-400' },
  filtered_out: { label: 'Left out', hint: 'Left out by the subject lists', tone: 'text-zinc-500 dark:text-zinc-400' },
}

// ── The run's progress ──────────────────────────────────────────────────

interface Run {
  dryRun: boolean
  status: 'running' | 'done' | 'stopped' | 'error'
  error?: string
  trapper?: { total: number; done: number; media: number }
  subjects?: { total: number }
  counts: Record<MetadataStatus, number>
  /** Subjects with changes (or failures), oldest first, up to KEPT_CHANGES. */
  changed: MetadataSubjectResult[]
  /** How many subjects each field changes in. */
  fields: Record<string, number>
}

const NO_COUNTS: Record<MetadataStatus, number> = {
  would_update: 0, updated: 0, unchanged: 0, unmatched: 0, not_found: 0, failed: 0, filtered_out: 0,
}

function reduce(run: Run, event: MetadataEvent): Run {
  switch (event.type) {
    case 'trapper': return { ...run, trapper: { total: event.total, done: 0, media: 0 } }
    case 'deployment':
      return run.trapper ? { ...run, trapper: { ...run.trapper, done: run.trapper.done + 1, media: run.trapper.media + event.media } } : run
    case 'subjects': return { ...run, subjects: { total: event.total } }
    case 'subject': {
      const { type: _type, ...result } = event
      const next = { ...run, counts: { ...run.counts, [event.status]: run.counts[event.status] + 1 } }
      if (event.changes.length === 0 && event.status !== 'failed') return next
      const fields = { ...next.fields }
      if (event.status !== 'failed') for (const c of event.changes) fields[c.field] = (fields[c.field] ?? 0) + 1
      return { ...next, fields, changed: next.changed.length < KEPT_CHANGES ? [...next.changed, result] : next.changed }
    }
    case 'done': return { ...run, status: 'done' }
    default: return run
  }
}

function processed(run: Run): number {
  return Object.values(run.counts).reduce((a, b) => a + b, 0)
}

function show(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function downloadLog(run: Run, subjectSetId: number) {
  const blob = new Blob([JSON.stringify({ dry_run: run.dryRun, counts: run.counts, fields: run.fields, subjects: run.changed }, null, 2)],
    { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${run.dryRun ? 'metadata-dry-run' : 'metadata-update'}_subject-set-${subjectSetId}_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function ChangesTable({ rows }: { rows: MetadataSubjectResult[] }) {
  const shown = rows.slice(-SHOWN_CHANGES).reverse()
  return (
    <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
      <table className="w-full text-xs">
        <thead className="text-zinc-500 dark:text-zinc-400 text-left sticky top-0 bg-white dark:bg-zinc-900">
          <tr>
            <th className="py-1.5 px-2 font-medium">Subject</th>
            <th className="py-1.5 px-2 font-medium">Media</th>
            <th className="py-1.5 px-2 font-medium">Field</th>
            <th className="py-1.5 px-2 font-medium">Now</th>
            <th className="py-1.5 px-2 font-medium">Becomes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {shown.flatMap((r) => (r.status === 'failed'
            ? [(
              <tr key={`${r.subject_id}-failed`}>
                <td className="py-1 px-2 font-mono align-top">{r.subject_id}</td>
                <td className="py-1 px-2 font-mono align-top">{r.media_id ?? '—'}</td>
                <td colSpan={3} className="py-1 px-2 text-red-600 dark:text-red-400">Failed: {r.detail}</td>
              </tr>
            )]
            : r.changes.map((c, i) => (
              <tr key={`${r.subject_id}-${c.field}`} className={i > 0 ? '' : 'border-t-2 border-zinc-200 dark:border-zinc-700'}>
                <td className="py-1 px-2 font-mono align-top">{i === 0 ? r.subject_id : ''}</td>
                <td className="py-1 px-2 font-mono align-top">{i === 0 ? r.media_id : ''}</td>
                <td className="py-1 px-2 font-mono align-top">{c.field}</td>
                <td className="py-1 px-2 font-mono align-top break-all text-red-700/80 dark:text-red-300/80 line-through decoration-1">{show(c.old)}</td>
                <td className="py-1 px-2 font-mono align-top break-all text-emerald-700 dark:text-emerald-400">{c.new}</td>
              </tr>
            ))))}
        </tbody>
      </table>
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

/** wildintel-tools' update-metadata: rebuilds a subject set's metadata from
 * the Trapper collection it was uploaded from — what an upload would set
 * today, only the fields that differ. A dry run shows every change without
 * making it. */
export default function UpdateMetadataPage({ onBack }: Props) {
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [subjectSetId, setSubjectSetId] = useState('')
  const [selection, setSelection] = useState<TrapperSelection | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [subjectLists, setSubjectLists] = useState<IdLists>(NO_LISTS)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const handlePick = useCallback((next: ZooniversePick) => setPick(next), [])
  const handleSelectionChange = useCallback((value: TrapperSelection | null) => setSelection(value), [])
  useEffect(() => setSubjectSetId(''), [pick?.projectId, pick?.creds])

  const running = run?.status === 'running'
  const subjectSets = pick?.subjectSets.items ?? []
  const chosen = subjectSets.find((s) => String(s.id) === subjectSetId)
  const ready = Boolean(chosen && selection) && !running

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function start(dryRun: boolean) {
    if (!chosen || !selection || !pick) return
    stop()
    setConfirming(false)
    const controller = new AbortController()
    abortRef.current = controller
    setRun({ dryRun, status: 'running', counts: NO_COUNTS, changed: [], fields: {} })
    try {
      await api.updateMetadata(
        pick.creds, chosen.id, selection, dryRun, (event) => setRun((r) => (r && reduce(r, event))), controller.signal,
        subjectLists,
      )
    } catch (e) {
      if (controller.signal.aborted) {
        setRun((r) => (r && r.status === 'running' ? { ...r, status: 'stopped' } : r))
      } else {
        const message = e instanceof Error ? e.message : 'The metadata update failed.'
        setRun((r) => (r ? { ...r, status: 'error', error: message } : r))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const done = run ? processed(run) : 0
  const total = run?.subjects?.total ?? 0
  const shownStatuses: MetadataStatus[] = [
    ...(run?.dryRun === false
      ? ['updated', 'unchanged', 'unmatched', 'not_found', 'failed'] as const
      : ['would_update', 'unchanged', 'unmatched', 'not_found'] as const),
    ...(run?.counts.filtered_out ? ['filtered_out'] as const : []),
  ]

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Update metadata</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Rewrite a subject set&rsquo;s metadata from the Trapper collection it was uploaded from — the links, license and file
        names an upload would set today. Only the fields that differ change; the rest of each subject&rsquo;s metadata stays.
      </p>

      <ZooniverseProjectPicker title="Subject set" disabled={running} onChange={handlePick}>
        <div className="mb-6">
          <label className={labelClass} htmlFor="metadata-subject-set">Subject set</label>
          <select
            id="metadata-subject-set" className={inputClass} disabled={running}
            value={subjectSetId} onChange={(e) => { setSubjectSetId(e.target.value); setRun(null) }}
          >
            <option value="">Select a subject set…</option>
            {subjectSets.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.display_name} — {s.subjects_count.toLocaleString()} subjects (#{s.id})</option>
            ))}
          </select>
        </div>
      </ZooniverseProjectPicker>

      {chosen && (
        <>
          <Divider />
          <StepHeading n={3}>Trapper images</StepHeading>
          <p className={`${hintClass} mb-4`}>
            The collection and deployments the subject set was uploaded from — each subject&rsquo;s file name and deployment
            come from them. Subjects whose image isn&rsquo;t among them are left as they are.
          </p>
          <div className="p-4 mb-6 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <TrapperSelectionForm onSelectionChange={handleSelectionChange} />
          </div>

          <Divider />
          <StepHeading n={4}>Update</StepHeading>
          <IdListsEditor
            kind="subject" initial={NO_LISTS} onCommit={setSubjectLists} disabled={running} className="mb-4"
            intro={<>
              Only some subjects, or never some — wildintel-tools&rsquo; <span className="font-mono">--white-list</span> /{' '}
              <span className="font-mono">--black-list</span>. Load a list of subject ids, a CSV with a{' '}
              <span className="font-mono">subject_id</span> column, a <em>Validation &amp; audit</em> report (its subjects with
              metadata issues) or this page&rsquo;s own log.
            </>}
          />
          <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                {!selection
                  ? 'Choose the Trapper images first.'
                  : run
                    ? <>
                      {run.dryRun && <span className="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 mr-2 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">Dry run</span>}
                      <strong>{done.toLocaleString()}</strong> of {total.toLocaleString()} subjects checked
                    </>
                    : 'Try a dry run first: it shows every change without making it.'}
              </span>
              {running
                ? <button type="button" className={btnOutline} onClick={stop}><SmallSpinner />Stop</button>
                : (
                  <div className="flex gap-2">
                    <button type="button" className={btnOutline} disabled={!ready} onClick={() => start(true)}>
                      {run?.dryRun ? 'Dry run again' : 'Dry run'}
                    </button>
                    <button type="button" className={btnPrimary} disabled={!ready || confirming} onClick={() => setConfirming(true)}>
                      Update metadata
                    </button>
                  </div>
                )}
            </div>

            {confirming && chosen && (
              <div className="mt-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-sm text-zinc-700 dark:text-zinc-300">
                <p>
                  Update the metadata of <strong>{chosen.display_name}</strong>&rsquo;s subjects in Zooniverse? The fields that
                  differ are overwritten — this app can&rsquo;t undo it. A dry run shows exactly what would change.
                </p>
                <div className="flex gap-2 mt-3">
                  <button type="button" className={btnPrimary} onClick={() => start(false)}>Yes, update</button>
                  <button type="button" className={btnOutline} onClick={() => setConfirming(false)}>Cancel</button>
                </div>
              </div>
            )}

            {run?.trapper && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-300 mb-1">
                  <span>Trapper deployments fetched</span>
                  <span>{run.trapper.done} of {run.trapper.total} · {run.trapper.media.toLocaleString()} images</span>
                </div>
                <ProgressBar
                  percent={run.trapper.total ? Math.round((run.trapper.done / run.trapper.total) * 100) : 100}
                  label="Trapper deployments fetched" tone={run.subjects ? 'emerald' : 'blue'}
                />
              </div>
            )}
            {run?.subjects && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-300 mb-1">
                  <span>Subjects checked</span>
                  <span>{done.toLocaleString()} of {total.toLocaleString()}</span>
                </div>
                <ProgressBar
                  percent={run.status === 'done' ? 100 : total ? Math.min(100, Math.round((done / total) * 100)) : 0}
                  label="Subjects checked"
                  tone={run.status === 'done' ? (run.counts.failed ? 'amber' : 'emerald') : 'blue'}
                />
              </div>
            )}

            {run && run.subjects && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
                {shownStatuses.map((status) => (
                  <div key={status} className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700" title={STATUS_LABELS[status].hint}>
                    <div className={`text-lg font-semibold ${STATUS_LABELS[status].tone}`}>{run.counts[status].toLocaleString()}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{STATUS_LABELS[status].label}</div>
                  </div>
                ))}
              </div>
            )}

            {run && Object.keys(run.fields).length > 0 && (
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-3">
                {run.dryRun ? 'Would change' : 'Changed'}:{' '}
                {Object.entries(run.fields).sort((a, b) => b[1] - a[1]).map(([field, n]) => (
                  <span key={field} className="inline-block mr-3"><span className="font-mono">{field}</span> in {n.toLocaleString()}</span>
                ))}
              </p>
            )}

            {run?.status === 'done' && (
              <p className={`text-sm mt-3 ${run.counts.failed ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {run.dryRun
                  ? `Dry run finished: ${run.counts.would_update.toLocaleString()} subject(s) would be updated — nothing was changed.`
                  : `Update finished: ${run.counts.updated.toLocaleString()} subject(s) updated${run.counts.failed ? `, ${run.counts.failed.toLocaleString()} failed — update again to retry them` : ''}.`}
              </p>
            )}
            {run?.status === 'stopped' && (
              <p className={hintClass}>{run.dryRun ? 'Stopped.' : 'Stopped — the subjects already updated stay updated.'}</p>
            )}
            {run?.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{run.error}</p>}

            {run && run.changed.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-3 mt-4">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {run.changed.length > SHOWN_CHANGES
                      ? `The last ${SHOWN_CHANGES} of ${run.changed.length.toLocaleString()} subjects with changes`
                      : 'Subjects with changes'}
                    {run.changed.length >= KEPT_CHANGES && ' (the log keeps the first 2,000)'}
                  </span>
                  <button type="button" className={btnOutline} onClick={() => chosen && downloadLog(run, chosen.id)}>Download log (JSON)</button>
                </div>
                <ChangesTable rows={run.changed} />
              </>
            )}
          </div>
        </>
      )}

      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack} disabled={running}>Back</button>
        {running && <p className={hintClass}>Stop it to go back.</p>}
      </div>
    </div>
  )
}
