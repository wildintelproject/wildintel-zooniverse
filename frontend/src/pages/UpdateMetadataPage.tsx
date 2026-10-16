import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import BackButton from '../components/BackButton'
import ChoiceCard from '../components/ChoiceCard'
import IdListsEditor, { NO_LISTS } from '../components/IdListsEditor'
import type { IdLists } from '../components/IdListsEditor'
import { BigNumber, DetailsPanel, RunBanner, StatGrid } from '../components/RunPanels'
import Combobox from '../components/Combobox'
import FieldLabel from '../components/FieldLabel'
import Step from '../components/WizardStep'
import { deploymentsSummary } from '../lib/deploymentsSummary'
import { formatAgo, formatDateTime, formatDuration } from '../lib/format'
import TrapperSelectionForm from '../components/TrapperSelectionForm'
import ZooniverseProjectPicker from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import type { MetadataEvent, MetadataStatus, MetadataSubjectResult, TrapperSelection } from '../types'

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
  /** Epoch ms: when it started, its last event, when it ended and when its subjects began to be checked. */
  startedAt: number
  lastEventAt: number
  endedAt?: number
  subjectsStartedAt?: number
  /** Subjects with changes (or failures), oldest first, up to KEPT_CHANGES. */
  changed: MetadataSubjectResult[]
  /** How many subjects each field changes in. */
  fields: Record<string, number>
}

const NO_COUNTS: Record<MetadataStatus, number> = {
  would_update: 0, updated: 0, unchanged: 0, unmatched: 0, not_found: 0, failed: 0, filtered_out: 0,
}

function reduceEvent(run: Run, event: MetadataEvent): Run {
  switch (event.type) {
    case 'trapper': return { ...run, trapper: { total: event.total, done: 0, media: 0 } }
    case 'deployment':
      return run.trapper ? { ...run, trapper: { ...run.trapper, done: run.trapper.done + 1, media: run.trapper.media + event.media } } : run
    case 'subjects': return { ...run, subjects: { total: event.total }, subjectsStartedAt: Date.now() }
    case 'subject': {
      const { type: _type, ...result } = event
      const next = { ...run, counts: { ...run.counts, [event.status]: run.counts[event.status] + 1 } }
      if (event.changes.length === 0 && event.status !== 'failed') return next
      const fields = { ...next.fields }
      if (event.status !== 'failed') for (const c of event.changes) fields[c.field] = (fields[c.field] ?? 0) + 1
      return { ...next, fields, changed: next.changed.length < KEPT_CHANGES ? [...next.changed, result] : next.changed }
    }
    case 'done': return { ...run, status: 'done', endedAt: Date.now() }
    default: return run
  }
}

function reduce(run: Run, event: MetadataEvent): Run {
  return { ...reduceEvent(run, event), lastEventAt: Date.now() }
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

// ── The run's views: under way, finished, failed ────────────────────────

/** Where the run is: what it is doing, and the figure that says how far. */
function progressOf(run: Run) {
  const pct = (done: number, total: number) => (total ? Math.min(100, Math.round((done / total) * 100)) : 100)
  const checked = processed(run)
  if (run.subjects) {
    const { total } = run.subjects
    return {
      title: run.dryRun ? 'Checking the subjects…' : 'Updating the subjects…', detail: `${checked.toLocaleString()} of ${total.toLocaleString()} subjects`,
      big: { label: 'Subjects checked', value: checked, percent: pct(checked, total), caption: `${pct(checked, total)}% of ${total.toLocaleString()} subjects` },
      fraction: total ? checked / total : null, since: run.subjectsStartedAt,
    }
  }
  if (run.trapper) {
    const { done, total, media } = run.trapper
    return {
      title: 'Fetching the Trapper deployments…', detail: `${done} of ${total} · ${media.toLocaleString()} images`,
      big: { label: 'Deployments fetched', value: done, percent: pct(done, total), caption: `${pct(done, total)}% of ${total} deployments · ${media.toLocaleString()} images` },
      fraction: total ? done / total : null, since: run.startedAt,
    }
  }
  return { title: 'Starting…', detail: '', big: null, fraction: null, since: undefined }
}

/** The technical side of a run, as rows. */
function detailRows(run: Run, now: number): [string, string][] {
  const rows: [string, string][] = [['Started', formatDateTime(run.startedAt, { seconds: true })]]
  if (run.trapper) rows.push(['Trapper deployments fetched', `${run.trapper.done} of ${run.trapper.total} deployments · ${run.trapper.media.toLocaleString()} images`])
  if (run.subjects) rows.push(['Subjects checked', `${processed(run).toLocaleString()} of ${run.subjects.total.toLocaleString()}`])
  if (run.endedAt) rows.push([run.status === 'done' ? 'Finished' : 'Interrupted', formatDateTime(run.endedAt, { seconds: true })])
  else rows.push(['Last activity', formatAgo(new Date(run.lastEventAt).toISOString(), now) || 'just now'])
  return rows
}

function ChangesDetail({ run }: { run: Run }) {
  if (run.changed.length === 0) return null
  return (
    <div className="mt-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {run.changed.length > SHOWN_CHANGES
          ? `The last ${SHOWN_CHANGES} of ${run.changed.length.toLocaleString()} subjects with changes`
          : 'Subjects with changes'}
        {run.changed.length >= KEPT_CHANGES && ' (the report keeps the first 2,000)'}
      </p>
      <ChangesTable rows={run.changed} />
    </div>
  )
}

function RunningView({ run, now, onStop }: { run: Run; now: number; onStop: () => void }) {
  const p = progressOf(run)
  const rate = run.subjectsStartedAt && now > run.subjectsStartedAt ? processed(run) / ((now - run.subjectsStartedAt) / 1000) : null
  const remaining = p.since && p.fraction && p.fraction > 0.02 && p.fraction < 1 ? ((now - p.since) * (1 - p.fraction)) / p.fraction : null
  return (
    <div>
      <RunBanner tone="blue" title={p.title} detail={p.detail}>
        <button type="button" className={btnOutline} onClick={onStop}>Cancel</button>
      </RunBanner>
      {p.big && <BigNumber {...p.big} tone="blue" />}
      <StatGrid items={[
        { value: rate !== null && rate > 0 ? `${rate.toFixed(rate < 10 ? 1 : 0)} subjects/s` : '—', label: 'Speed' },
        { value: remaining !== null ? `~${formatDuration(remaining)}` : '—', label: 'Time left' },
        { value: formatDuration(now - run.startedAt), label: 'Elapsed' },
      ]} />
      <DetailsPanel rows={detailRows(run, now)} defaultOpen><ChangesDetail run={run} /></DetailsPanel>
    </div>
  )
}

function FinishedView({ run, now, onExport }: { run: Run; now: number; onExport: () => void }) {
  const { counts } = run
  const total = run.subjects?.total ?? 0
  const main = run.dryRun ? counts.would_update : counts.updated
  const percent = total ? Math.min(100, Math.round((main / total) * 100)) : 0
  const statuses: MetadataStatus[] = [
    'unchanged', 'unmatched', 'not_found', ...(run.dryRun ? [] : ['failed' as const]), ...(counts.filtered_out ? ['filtered_out' as const] : []),
  ]
  const fields = Object.entries(run.fields).sort((a, b) => b[1] - a[1])
  return (
    <div>
      <RunBanner
        tone={counts.failed ? 'amber' : 'emerald'} title={run.dryRun ? 'Preview completed' : 'Update completed'}
        detail={run.dryRun
          ? `${counts.would_update.toLocaleString()} subject(s) would be updated — nothing was changed.`
          : `${counts.updated.toLocaleString()} subject(s) updated${counts.failed ? `, ${counts.failed.toLocaleString()} failed — update again to retry them` : ''}.`}
      >
        <button type="button" className={btnOutline} onClick={onExport}>Export report</button>
      </RunBanner>
      <BigNumber
        label={run.dryRun ? 'Subjects that would be updated' : 'Subjects updated'} value={main} percent={percent}
        tone={counts.failed ? 'amber' : 'emerald'} caption={`${percent}% of ${total.toLocaleString()} subjects checked`}
      />
      <StatGrid items={statuses.map((status) => ({
        value: counts[status].toLocaleString(), label: STATUS_LABELS[status].label, hint: STATUS_LABELS[status].hint,
      }))} />
      {fields.length > 0 && (
        <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
          <p className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">{run.dryRun ? 'Would change' : 'Changed'}, by field</p>
          {fields.map(([field, n]) => (
            <div key={field} className="px-4 py-3 flex justify-between gap-3 text-sm">
              <span className="font-mono text-zinc-800 dark:text-zinc-100">{field}</span>
              <span className="text-zinc-500 dark:text-zinc-400">in {n.toLocaleString()} subjects</span>
            </div>
          ))}
        </div>
      )}
      <DetailsPanel rows={detailRows(run, now)}><ChangesDetail run={run} /></DetailsPanel>
    </div>
  )
}

function FailedView({ run, now, onRetry, disabled }: { run: Run; now: number; onRetry: () => void; disabled: boolean }) {
  const cancelled = run.status === 'stopped'
  const rows = detailRows(run, now)
  if (run.error) rows.unshift(['Cause', run.error])
  const p = progressOf(run)
  return (
    <div>
      <RunBanner
        tone="red" title={cancelled ? 'The update was cancelled' : 'The update was interrupted'}
        detail={run.error ?? 'It was stopped before it finished.'}
      >
        <button
          type="button" disabled={disabled} onClick={onRetry}
          className="px-4 py-2 text-sm bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded hover:opacity-90 disabled:opacity-40"
        >
          Retry
        </button>
      </RunBanner>
      {p.big && <BigNumber label={`${p.big.label} before the stop`} value={p.big.value} percent={p.big.percent} tone="red" caption={p.big.caption} />}
      <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
        <div className="p-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">What is kept</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {run.dryRun ? 'Nothing was changed: a preview only reads.' : `The ${run.counts.updated.toLocaleString()} subject(s) already updated stay updated.`}
          </p>
        </div>
        <div className="p-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">What Retry does</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {run.dryRun ? 'Runs the preview again from the start.' : 'Asks you to confirm, then runs the update again — the subjects already right are skipped.'}
          </p>
        </div>
      </div>
      <DetailsPanel rows={rows} defaultOpen><ChangesDetail run={run} /></DetailsPanel>
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

/** wildintel-tools' update-metadata: rebuilds a subject set's metadata from
 * the Trapper collection it was uploaded from — what an upload would set
 * today, only the fields that differ. A preview shows every change without
 * making it. */
export default function UpdateMetadataPage({ onBack }: Props) {
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [subjectSetId, setSubjectSetId] = useState('')
  const [selection, setSelection] = useState<TrapperSelection | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [subjectLists, setSubjectLists] = useState<IdLists>(NO_LISTS)
  const abortRef = useRef<AbortController | null>(null)
  // The step that's open, and the furthest one unlocked.
  const [open, setOpen] = useState(1)
  const [reached, setReached] = useState(1)
  // A clock for the running update's timings.
  const [now, setNow] = useState(() => Date.now())
  const [mode, setMode] = useState<'dry' | 'update'>('dry')

  useEffect(() => () => abortRef.current?.abort(), [])

  const handlePick = useCallback((next: ZooniversePick) => setPick(next), [])
  const handleSelectionChange = useCallback((value: TrapperSelection | null) => setSelection(value), [])
  useEffect(() => setSubjectSetId(''), [pick?.projectId, pick?.creds])

  const running = run?.status === 'running'
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const subjectSets = pick?.subjectSets.items ?? []
  const chosen = subjectSets.find((s) => String(s.id) === subjectSetId)
  const ready = Boolean(chosen && selection) && !running
  const status = (n: number): 'open' | 'done' | 'locked' | 'running' | 'error' => {
    if (n === 4 && n === open && run) return run.status === 'running' ? 'running' : run.status === 'done' ? 'done' : 'error'
    return n === open ? 'open' : n <= reached && (n < 4 || run) ? 'done' : 'locked'
  }
  function next(n: number) {
    setOpen(n)
    setReached((r) => Math.max(r, n))
  }

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function start(dryRun: boolean) {
    if (!chosen || !selection || !pick) return
    stop()
    setConfirming(false)
    next(4)
    const controller = new AbortController()
    abortRef.current = controller
    const started = Date.now()
    setRun({ dryRun, status: 'running', counts: NO_COUNTS, changed: [], fields: {}, startedAt: started, lastEventAt: started })
    try {
      await api.updateMetadata(
        pick.creds, chosen.id, selection, dryRun, (event) => setRun((r) => (r && reduce(r, event))), controller.signal,
        subjectLists,
      )
    } catch (e) {
      if (controller.signal.aborted) {
        setRun((r) => (r && r.status === 'running' ? { ...r, status: 'stopped', endedAt: Date.now() } : r))
      } else {
        const message = e instanceof Error ? e.message : 'The metadata update failed.'
        setRun((r) => (r ? { ...r, status: 'error', error: message, endedAt: Date.now() } : r))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  // A failed preview is simply run again; a real update asks to be confirmed again.
  function retry() {
    if (!run) return
    if (run.dryRun) return start(true)
    setMode('update')
    setOpen(3)
    setConfirming(true)
  }

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Update metadata</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Updates the metadata of Zooniverse subjects using the data of the original images in Trapper.
      </p>

      <Step
        n={1} title="Target subject set" status={status(1)} canEdit={!running} onEdit={() => setOpen(1)}
        description="Subject set that contains the subjects whose metadata will be updated."
        summary={chosen && <>{pick?.projectName}<br />{chosen.display_name} · {chosen.subjects_count.toLocaleString()} subjects</>}
      >
        <ZooniverseProjectPicker disabled={running} useSavedConnection framed onChange={handlePick}>
          <div className="mb-6">
            <FieldLabel htmlFor="metadata-subject-set" done={Boolean(chosen)}>Subject set</FieldLabel>
            <Combobox
              id="metadata-subject-set" disabled={running}
              options={subjectSets.map((s) => ({ value: String(s.id), label: `${s.display_name} — ${s.subjects_count.toLocaleString()} subjects (#${s.id})` }))}
              value={subjectSetId} onChange={(value) => { setSubjectSetId(value); setRun(null) }}
              placeholder="Select a subject set…" clearLabel="Clear subject set"
            />
          </div>
        </ZooniverseProjectPicker>
        <div className="flex items-center justify-between gap-3 mt-4">
          <BackButton onClick={onBack} />
          <button type="button" className={btnPrimary} disabled={!chosen} onClick={() => next(2)}>Continue to Trapper images</button>
        </div>
      </Step>

      <Step
        n={2} title="Trapper deployments" status={status(2)} canEdit={!running} onEdit={() => setOpen(2)}
        description="Trapper deployments associated with the images."
        summary={selection && <>
          {selection.research_project.name} · {selection.classification_project.name}<br />
          {selection.collection.name} · {deploymentsSummary(selection)}
        </>}
      >
        {reached >= 2 && (
          <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <TrapperSelectionForm onSelectionChange={handleSelectionChange} useSavedConnection />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 mt-4">
          <BackButton onClick={() => setOpen(1)} />
          <button type="button" className={btnPrimary} disabled={!selection} onClick={() => next(3)}>Continue to review</button>
        </div>
      </Step>

      <Step
        n={3} title="Review and update" status={status(3)} canEdit={!running} onEdit={() => setOpen(3)}
        description="Review the changes before applying them."
        summary={<>
          {mode === 'dry' ? 'Preview' : 'Update'} · {subjectLists.include === null && subjectLists.exclude.length === 0
            ? 'all eligible subjects'
            : [subjectLists.include !== null && `only ${subjectLists.include.length.toLocaleString()}`,
              subjectLists.exclude.length > 0 && `never ${subjectLists.exclude.length.toLocaleString()}`].filter(Boolean).join(' · ')}
        </>}
      >
      <h5 className="text-sm font-semibold mb-1">Which subjects?</h5>
      <p className={`${hintClass} mb-3`}>Optional. Without a list, every eligible subject is processed.</p>
      <IdListsEditor
        kind="subject" initial={NO_LISTS} onCommit={setSubjectLists} disabled={running} className="mb-6" layout="choices" intro={null}
      />

      <h5 className="text-sm font-semibold mb-1">What should happen?</h5>
      <p className={`${hintClass} mb-3`}>What do you want to do with the selected subjects?</p>
      <div role="radiogroup" aria-label="What should happen" className="space-y-3 mb-3">
        <ChoiceCard
          group="metadata-mode" name="Preview the changes" selected={mode === 'dry'} disabled={running}
          badge="Recommended first" badgeTone="emerald" onSelect={() => { setMode('dry'); setConfirming(false) }}
        >
          <p className={hintClass}>Works out what would change and flags problems. Nothing is modified.</p>
        </ChoiceCard>
        <ChoiceCard
          group="metadata-mode" name="Apply the update" selected={mode === 'update'} disabled={running}
          onSelect={() => { setMode('update'); setConfirming(false) }}
        >
          <p className={hintClass}>Updates the metadata of the selected subjects.</p>
        </ChoiceCard>
      </div>
      {mode === 'update' && (
        <div className="mb-3 p-3 rounded-lg border border-amber-500/70 text-sm">
          <p className="font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <svg role="img" aria-label="Warning" className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.2v.1" />
            </svg>
            Real update
          </p>
          <p className="text-zinc-600 dark:text-zinc-300">Check the preview first to confirm the scope of the changes.</p>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between gap-3">
          <BackButton onClick={() => setOpen(2)} disabled={running} />
          {mode === 'dry'
            ? <button type="button" className={btnPrimary} disabled={!ready} onClick={() => start(true)}>{run?.dryRun ? 'Run preview again' : 'Run preview'}</button>
            : <button type="button" className={btnPrimary} disabled={!ready || confirming} onClick={() => setConfirming(true)}>Review and update</button>}
        </div>

        {confirming && chosen && (
          <div className="mt-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-sm text-zinc-700 dark:text-zinc-300">
            <p>
              Update the metadata of <strong>{chosen.display_name}</strong>&rsquo;s subjects in Zooniverse? The fields that
              differ are overwritten — this app can&rsquo;t undo it. A preview shows exactly what would change.
            </p>
            <div className="flex gap-2 mt-3">
              <button type="button" className={btnPrimary} onClick={() => start(false)}>Yes, update</button>
              <button type="button" className={btnOutline} onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        )}

      </div>
      </Step>

      <Step
        n={4} title="Update results" status={status(4)} canEdit={!running} onEdit={() => setOpen(3)}
        description="Progress and changes of the run."
        summary={run && <>{(run.dryRun ? run.counts.would_update : run.counts.updated).toLocaleString()} subject(s) {run.dryRun ? 'would be updated' : 'updated'}</>}
        badge={run?.status === 'stopped' ? 'Cancelled' : undefined}
        expanded={run?.status === 'done' && open === 4}
      >
        {run?.status === 'running' && <RunningView run={run} now={now} onStop={stop} />}
        {run?.status === 'done' && <FinishedView run={run} now={now} onExport={() => chosen && downloadLog(run, chosen.id)} />}
        {run && (run.status === 'error' || run.status === 'stopped') && <FailedView run={run} now={now} onRetry={retry} disabled={!ready} />}
        <div className="mt-4"><BackButton onClick={() => setOpen(3)} disabled={running} /></div>
      </Step>
    </div>
  )
}
