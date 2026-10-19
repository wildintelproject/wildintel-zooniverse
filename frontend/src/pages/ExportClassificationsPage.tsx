import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type WorkflowExport } from '../api'
import BackButton from '../components/BackButton'
import ChoiceCard from '../components/ChoiceCard'
import { BigNumber, DetailsPanel } from '../components/RunPanels'
import Combobox from '../components/Combobox'
import FieldLabel from '../components/FieldLabel'
import TrapperImportPanel from '../components/TrapperImportPanel'
import { formatAgo, formatBytes, formatDateTime, formatDuration } from '../lib/format'
import TrapperSelectionForm from '../components/TrapperSelectionForm'
import Step from '../components/WizardStep'
import { deploymentsSummary } from '../lib/deploymentsSummary'
import ZooniverseProjectPicker, { SmallSpinner } from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import type { ExportEvent, ExportResult, ExportSkipReason, TrapperSelection, ZooniverseWorkflow } from '../types'

const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-6 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

const SKIP_LABELS: Record<ExportSkipReason, { label: string; hint: string }> = {
  not_in_trapper: { label: 'Not in the Trapper selection', hint: 'Their image has no observation in the chosen collection and deployments — e.g. another subject set of the workflow.' },
  no_media_id: { label: 'No Trapper media id', hint: 'Their metadata doesn’t say which Trapper image they are.' },
  no_valid_classifications: { label: 'No valid classifications', hint: 'Every classification had no answer, or too many.' },
  no_decision: { label: 'No decision', hint: 'The votes didn’t produce an observation.' },
}

// Zooniverse makes one classifications export per workflow every 24 hours.
const COOLDOWN_MS = 24 * 60 * 60 * 1000

// ── The run's progress ──────────────────────────────────────────────────

interface Run {
  status: 'running' | 'done' | 'stopped' | 'error'
  error?: string
  /** Epoch ms: when it started, its last event, and when it ended. */
  startedAt: number
  lastEventAt: number
  endedAt?: number
  downloadStartedAt?: number
  trapperStartedAt?: number
  votingStartedAt?: number
  export?: { state: 'generating' | 'ready'; updated_at: string | null }
  download?: { rows: number; bytes: number; total: number | null; done: boolean; subjects?: number }
  trapper?: { total: number; done: number; observations: number }
  voting?: { total: number; done: number }
  result?: ExportResult
}

function reduceEvent(run: Run, event: ExportEvent): Run {
  const now = Date.now()
  switch (event.type) {
    case 'export': return { ...run, export: { state: event.state, updated_at: event.updated_at } }
    case 'classifications':
      return { ...run, downloadStartedAt: run.downloadStartedAt ?? now, download: { rows: event.rows, bytes: event.bytes, total: event.total_bytes, done: false } }
    case 'classifications_done':
      return { ...run, download: { ...(run.download ?? { bytes: 0, total: null }), rows: event.rows, done: true, subjects: event.subjects } }
    case 'trapper': return { ...run, trapperStartedAt: now, trapper: { total: event.total, done: 0, observations: 0 } }
    case 'deployment':
      return run.trapper
        ? { ...run, trapper: { ...run.trapper, done: run.trapper.done + 1, observations: run.trapper.observations + event.observations } }
        : run
    case 'subjects': return { ...run, votingStartedAt: now, voting: { total: event.total, done: 0 } }
    case 'progress': return run.voting ? { ...run, voting: { ...run.voting, done: event.done } } : run
    case 'done': {
      const { type: _type, ...result } = event
      return { ...run, status: 'done', result, endedAt: now }
    }
    default: return run
  }
}

function reduce(run: Run, event: ExportEvent): Run {
  return { ...reduceEvent(run, event), lastEventAt: Date.now() }
}

/** Where the run is, as the running and failed views show it. */
function progressOf(run: Run, now: number) {
  const pct = (done: number, total: number) => (total ? Math.min(100, Math.round((done / total) * 100)) : 100)
  if (run.voting) {
    const { done, total } = run.voting
    return {
      title: 'Voting subjects…', detail: `${done.toLocaleString()} of ${total.toLocaleString()} subjects`,
      big: { label: 'Subjects voted', value: done, percent: pct(done, total), caption: `${pct(done, total)}% of ${total.toLocaleString()} subjects` },
      fraction: total ? done / total : null, since: run.votingStartedAt,
    }
  }
  if (run.trapper) {
    const { done, total, observations } = run.trapper
    return {
      title: 'Fetching Trapper deployments…', detail: `${done} of ${total} · ${observations.toLocaleString()} observations`,
      big: { label: 'Deployments fetched', value: done, percent: pct(done, total), caption: `${pct(done, total)}% of ${total} deployments · ${observations.toLocaleString()} observations` },
      fraction: total ? done / total : null, since: run.trapperStartedAt,
    }
  }
  if (run.download) {
    const { rows, bytes, total } = run.download
    const percent = total ? Math.min(99, Math.round((bytes / total) * 100)) : null
    return {
      title: 'Downloading classifications…', detail: `${rows.toLocaleString()} rows · updated ${formatAgo(new Date(run.lastEventAt).toISOString(), now) || 'just now'}`,
      big: { label: 'Rows downloaded', value: rows, percent, caption: `${percent !== null ? `${percent}% of ${formatBytes(total!)}` : formatBytes(bytes)}` },
      fraction: percent !== null ? percent / 100 : null, since: run.downloadStartedAt,
    }
  }
  if (run.export) {
    return run.export.state === 'generating'
      ? { title: 'Making a new classifications export in Zooniverse…', detail: 'This can take a few minutes.', big: null, fraction: null, since: undefined }
      : { title: 'Zooniverse’s export is ready', detail: formatDateTime(run.export.updated_at, { utc: true }), big: null, fraction: null, since: undefined }
  }
  return { title: 'Starting…', detail: '', big: null, fraction: null, since: undefined }
}

/** The technical side of a run, as rows. */
function detailRows(run: Run, now: number): [string, string][] {
  const rows: [string, string][] = [['Started', formatDateTime(run.startedAt, { seconds: true })]]
  if (run.export) rows.push(['Classifications export', run.export.state === 'ready' ? formatDateTime(run.export.updated_at, { utc: true }) : 'being made by Zooniverse'])
  if (run.download) {
    rows.push(['Classifications downloaded', `${run.download.rows.toLocaleString()} rows · ${formatBytes(run.download.bytes)}${run.download.subjects !== undefined ? ` · ${run.download.subjects.toLocaleString()} subjects` : ''}`])
  }
  if (run.trapper) rows.push(['Trapper deployments fetched', `${run.trapper.done} of ${run.trapper.total} deployments`])
  if (run.voting) rows.push(['Subjects voted', `${run.voting.done.toLocaleString()} of ${run.voting.total.toLocaleString()}`])
  if (run.endedAt) rows.push([run.status === 'done' ? 'Finished' : 'Interrupted', formatDateTime(run.endedAt, { seconds: true })])
  else rows.push(['Last activity', `${formatAgo(new Date(run.lastEventAt).toISOString(), now) || 'just now'}`])
  return rows
}

/** The export under way: what it's doing, how far, and how long it takes. */
function RunningView({ run, now, onStop }: { run: Run; now: number; onStop: () => void }) {
  const p = progressOf(run, now)
  const downloading = !run.voting && !run.trapper && run.download && !run.download.done && run.downloadStartedAt
  const speed = downloading && now > run.downloadStartedAt! ? run.download!.bytes / 1048576 / ((now - run.downloadStartedAt!) / 1000) : null
  const remaining = p.since && p.fraction && p.fraction > 0.02 && p.fraction < 1 ? ((now - p.since) * (1 - p.fraction)) / p.fraction : null
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.title}</p>
          {p.detail && <p className="text-sm text-zinc-600 dark:text-zinc-300">{p.detail}</p>}
        </div>
        <button type="button" className={btnOutline} onClick={onStop}>Cancel export</button>
      </div>
      {p.big && <BigNumber {...p.big} tone="blue" />}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        {[
          [speed !== null ? `${speed.toFixed(speed < 10 ? 1 : 0)} MB/s` : '—', 'Speed'],
          [remaining !== null ? `~${formatDuration(remaining)}` : '—', 'Time left'],
          [formatDuration(now - run.startedAt), 'Elapsed'],
        ].map(([value, label]) => (
          <div key={label} className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
          </div>
        ))}
      </div>
      <DetailsPanel rows={detailRows(run, now)} defaultOpen />
    </div>
  )
}

/** An export that failed, or that was cancelled. */
function FailedView({ run, now, onRetry, disabled }: { run: Run; now: number; onRetry: () => void; disabled: boolean }) {
  const cancelled = run.status === 'stopped'
  const rows = detailRows(run, now)
  if (run.error) rows.unshift(['Cause', run.error])
  const p = progressOf(run, now)
  const at = run.endedAt ? formatDateTime(run.endedAt, { seconds: true }) : ''
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap p-4 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{cancelled ? 'The export was cancelled' : 'The export was interrupted'}</p>
          <p className="text-sm text-red-700 dark:text-red-300 break-words">{run.error ?? 'It was stopped before it finished.'}</p>
        </div>
        <button
          type="button" disabled={disabled} onClick={onRetry}
          className="px-4 py-2 text-sm bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-2"
        >
          Retry
        </button>
      </div>
      {p.big && (
        <BigNumber
          label={`${p.big.label} before the stop`} value={p.big.value} percent={p.big.percent} tone="red"
          caption={`${p.big.caption}${at ? ` · stopped at ${at}` : ''}`}
        />
      )}
      <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
        <div className="p-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">What is kept</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Nothing was written: the result files only exist once the export completes.</p>
        </div>
        <div className="p-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">What Retry does</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Runs the export again from the start, with the same choices.</p>
        </div>
      </div>
      <DetailsPanel rows={rows} defaultOpen />
    </div>
  )
}

function Result({ run, result, selection, autoImport, now }: { run: Run; result: ExportResult; selection: TrapperSelection; autoImport: boolean; now: number }) {
  const [folderError, setFolderError] = useState<string | null>(null)
  const skipped = (Object.keys(SKIP_LABELS) as ExportSkipReason[]).filter((r) => result.skipped[r] > 0)
  const percent = result.subjects ? Math.min(100, Math.round((result.exported / result.subjects) * 100)) : 0
  const folder = result.run_dir ?? undefined
  return (
    <div>
      {result.rows ? (
        <div className="flex items-center justify-between gap-3 flex-wrap p-4 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Export completed</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{result.rows.toLocaleString()} observations ready to import into Trapper.</p>
          </div>
          <button
            type="button" className={btnOutline}
            onClick={() => { setFolderError(null); api.openExportFolder(folder).catch((e) => setFolderError(e instanceof Error ? e.message : 'Could not open the folder.')) }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            Open folder
          </button>
        </div>
      ) : (
        <p className="p-4 rounded-lg border border-amber-300 dark:border-amber-800 text-sm font-semibold text-amber-700 dark:text-amber-400">
          Export finished, but no subject could be exported — nothing was written.
        </p>
      )}
      {folderError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{folderError}</p>}

      <BigNumber
        label="Observations exported" value={result.rows} percent={percent} tone="emerald"
        caption={`${percent}% of ${result.subjects.toLocaleString()} classified subjects exported`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        {[
          ['Subjects classified', result.subjects, 'Subjects with classifications in Zooniverse’s export.'],
          ['Images classified', result.trapper_media, 'Images of the chosen collection and deployments with observations in the classification project.'],
          ['Subjects exported', result.exported, 'Subjects whose image is in Trapper’s selection and whose votes gave a decision.'],
        ].map(([label, value, hint]) => (
          <div key={label as string} className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700" title={hint as string}>
            <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{(value as number).toLocaleString()}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
          </div>
        ))}
      </div>

      {skipped.length > 0 && (
        <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
          {skipped.map((r) => (
            <div key={r} className="p-4" title={SKIP_LABELS[r].hint}>
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{SKIP_LABELS[r].label}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{result.skipped[r].toLocaleString()} subjects</p>
              {result.samples[r] && (
                <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500 truncate">
                  e.g. {result.samples[r]!.slice(0, 10).join(', ')}{result.samples[r]!.length > 10 ? '…' : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <DetailsPanel rows={detailRows(run, now)}>
        {result.files.length > 0 && (
          <div className="mt-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {result.files.length > 1 ? `Observations — split into ${result.files.length} files` : 'Observations'}
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              {result.files.reduce((sum, f) => sum + f.rows, 0).toLocaleString()} rows · {formatBytes(result.files.reduce((sum, f) => sum + f.bytes, 0))}
              {result.zoo_annotations_file && ' · plus the volunteers’ answers'}
              {result.raw_export_file && ` · and the original Zooniverse data (${formatBytes(result.raw_export_file.bytes)})`}
            </p>
            <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500 break-all">{result.run_dir ?? result.output_dir}</p>
          </div>
        )}
      </DetailsPanel>

      {result.files.length > 0 && (
        <TrapperImportPanel
          files={result.files.map((f) => f.path)} trapperUrl={selection.url}
          project={selection.classification_project} manualUrl={result.trapper_import_url} autoStart={autoImport}
        />
      )}
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

/** Retrieve classifications — the CSV half of wildintel-tools' export: a
 * workflow's Zooniverse classifications, voted into observations and
 * written as a CSV for Trapper's import — and imported into Trapper, from
 * the result (or right away, if asked). */
export default function ExportClassificationsPage({ onBack }: Props) {
  // The step that's open, and the furthest one unlocked: Zooniverse, Trapper, review and export, results.
  const [open, setOpen] = useState(1)
  const [reached, setReached] = useState(1)
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [workflows, setWorkflows] = useState<{ items: ZooniverseWorkflow[]; loading: boolean; error: string | null }>(
    { items: [], loading: false, error: null },
  )
  const [workflowId, setWorkflowId] = useState('')
  const [latest, setLatest] = useState<{ loading: boolean; export: WorkflowExport | null }>(
    { loading: false, export: null },
  )
  const [regenerate, setRegenerate] = useState(false)
  const [selection, setSelection] = useState<TrapperSelection | null>(null)
  const [saveZoo, setSaveZoo] = useState(true)
  // Also keep Zooniverse's own classifications CSV (it can be big).
  const [saveRaw, setSaveRaw] = useState(false)
  // Import the CSVs into Trapper as soon as the export ends — wildintel-tools' --upload.
  const [autoImport, setAutoImport] = useState(false)
  // The selection the last export was made with — what its CSVs are imported into.
  const [exportedSelection, setExportedSelection] = useState<TrapperSelection | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // A clock for the running export's timings.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => () => abortRef.current?.abort(), [])

  function next(n: number) {
    setOpen(n)
    setReached((r) => Math.max(r, n))
  }

  const handlePick = useCallback((next: ZooniversePick) => setPick(next), [])
  const handleSelectionChange = useCallback((value: TrapperSelection | null) => setSelection(value), [])

  // A project's workflows, once one is chosen.
  const projectId = pick?.projectId ?? null
  const creds = pick?.creds
  useEffect(() => {
    setWorkflowId('')
    if (!projectId || !creds) {
      setWorkflows({ items: [], loading: false, error: null })
      return
    }
    let cancelled = false
    setWorkflows({ items: [], loading: true, error: null })
    api.zooniverseWorkflows(creds, projectId)
      .then(({ results }) => { if (!cancelled) setWorkflows({ items: results, loading: false, error: null }) })
      .catch((e) => { if (!cancelled) setWorkflows({ items: [], loading: false, error: e instanceof Error ? e.message : 'Could not load them.' }) })
    return () => { cancelled = true }
  }, [projectId, creds])

  // The chosen workflow's latest export.
  useEffect(() => {
    setRegenerate(false)
    setLatest({ loading: false, export: null })
    if (!workflowId || !creds) return
    let cancelled = false
    setLatest({ loading: true, export: null })
    api.zooniverseWorkflowExport(creds, Number(workflowId))
      .then((r) => { if (!cancelled) setLatest({ loading: false, export: r.export }) })
      .catch(() => { if (!cancelled) setLatest({ loading: false, export: null }) })
    return () => { cancelled = true }
  }, [workflowId, creds])

  const running = run?.status === 'running'
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const workflow = workflows.items.find((w) => String(w.id) === workflowId)
  const ready = Boolean(workflow?.exportable && selection) && !running
  const unlocked = (n: number) => (n === 1 ? true : n === 2 ? Boolean(workflow) : n === 3 ? Boolean(workflow && selection) : Boolean(run))
  const status = (n: number): 'open' | 'done' | 'locked' | 'running' | 'error' => {
    if (n === 4 && n === open && run) {
      return run.status === 'running' ? 'running' : run.status === 'done' ? 'done' : 'error'
    }
    return n === open ? 'open' : n <= reached && unlocked(n) ? 'done' : 'locked'
  }

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function handleExport() {
    if (!workflow || !selection || !pick) return
    stop()
    next(4)
    const controller = new AbortController()
    abortRef.current = controller
    const started = Date.now()
    const initial: Run = { status: 'running', startedAt: started, lastEventAt: started }
    setRun(initial)
    setExportedSelection(selection)
    try {
      await api.exportClassifications(
        pick.creds, workflow.id, selection,
        { regenerate, saveZooAnnotations: saveZoo, saveRawExport: saveRaw },
        (event) => setRun((r) => (r && reduce(r, event))), controller.signal,
      )
    } catch (e) {
      if (controller.signal.aborted) {
        setRun((r) => (r && r.status === 'running' ? { ...r, status: 'stopped', endedAt: Date.now() } : r))
      } else {
        setRun((r) => ({ ...(r ?? initial), status: 'error', error: e instanceof Error ? e.message : 'The export failed.', endedAt: Date.now() }))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  // Zooniverse's "state" isn't trusted: an export with a file can be
  // downloaded whatever it says.
  const latestExport = latest.export
  const hasFile = Boolean(latestExport && (latestExport.file_date || !latestExport.pending))
  const requestedAt = latestExport?.updated_at ? new Date(latestExport.updated_at).getTime() : NaN
  const nextRequestAt = Number.isNaN(requestedAt) ? null : requestedAt + COOLDOWN_MS
  const cooling = nextRequestAt !== null && nextRequestAt > Date.now()

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Retrieve classifications</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Turn the classifications volunteers made in a Zooniverse workflow into observations ready to import into Trapper.
      </p>

      <Step
        n={1} title="Zooniverse project" status={status(1)} canEdit={!running} onEdit={() => setOpen(1)}
        description="The project and workflow to retrieve classifications from, and whether to ask Zooniverse for a new export of them."
        summary={workflow && <>
          {pick?.projectName}<br />{workflow.display_name} (#{workflow.id})<br />
          Classifications export: {regenerate && !cooling
            ? 'a new one is made first'
            : hasFile
              ? `the latest, of ${formatDateTime(latestExport!.file_date ?? latestExport!.updated_at, { utc: true })}`
              : 'none yet — one is made first'}
        </>}
      >
      <ZooniverseProjectPicker disabled={running} loadSubjectSets={false} useSavedConnection onChange={handlePick}>
        <div className="mb-6">
          <FieldLabel htmlFor="export-workflow" done={Boolean(workflow?.exportable)}>Workflow</FieldLabel>
          <Combobox
            id="export-workflow" disabled={running || workflows.items.length === 0} loading={workflows.loading}
            options={workflows.items.map((w) => ({
              value: String(w.id),
              label: `${w.display_name} (#${w.id})${w.exportable ? '' : ' — can’t be exported'}`,
              disabled: !w.exportable,
            }))}
            value={workflowId} onChange={(value) => { setWorkflowId(value); setRun(null) }}
            placeholder={
              workflows.loading ? 'Loading the project’s workflows…'
                : workflows.items.length === 0 ? 'This project has no workflows' : 'Select a workflow…'
            }
            clearLabel="Clear workflow"
          />
          {workflows.error && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{workflows.error}</p>}
          <p className={hintClass}>
            Only workflows the app knows how to vote can be exported — each has its own species and answers.
          </p>
          {workflow && (
            <fieldset className="mt-4" disabled={running}>
              <legend className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">Classification export</legend>
              {latest.loading
                ? <p className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2"><SmallSpinner /> Checking its classifications export…</p>
                : (
                  <div className="space-y-3">
                    {hasFile && (
                      <ChoiceCard
                        group="classification-export" name="Use the available export" selected={!(regenerate && !cooling)} onSelect={() => setRegenerate(false)}
                        badge="Available" badgeTone="emerald"
                      >
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                          {formatDateTime(latestExport!.file_date ?? latestExport!.updated_at, { utc: true })} · starts downloading right away
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Classifications made after this date are not included.</p>
                        {latestExport!.pending && (
                          <p className={hintClass}>
                            {cooling
                              ? `A newer one was requested ${formatAgo(latestExport!.updated_at)} and isn’t done yet — this one is used.`
                              : `A newer one was requested ${formatAgo(latestExport!.updated_at)} and never finished — it can be asked again.`}
                          </p>
                        )}
                      </ChoiceCard>
                    )}
                    <ChoiceCard
                      group="classification-export" name="Generate a new export" selected={!hasFile || (regenerate && !cooling)} onSelect={() => setRegenerate(true)}
                      disabled={!hasFile || cooling}
                      badge={hasFile ? undefined : latestExport ? 'Pending' : 'None'} badgeTone={latestExport ? 'amber' : 'zinc'}
                    >
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        {hasFile
                          ? cooling
                            ? `Zooniverse allows a new export once every 24 hours. The next request will be available on ${formatDateTime(nextRequestAt!, { utc: true })}.`
                            : 'Includes the latest classifications. Can take several minutes for a big workflow.'
                          : latestExport
                            ? cooling
                              ? 'Zooniverse is making it — the export waits for it.'
                              : `The last request (${formatAgo(latestExport.updated_at)}) never finished — a new export will be made first.`
                            : 'One will be made first — it can take a few minutes.'}
                      </p>
                    </ChoiceCard>
                  </div>
                )}
            </fieldset>
          )}
        </div>
      </ZooniverseProjectPicker>
        <div className="flex items-center justify-between gap-3 mt-4">
          <BackButton onClick={onBack} />
          <button type="button" className={btnPrimary} disabled={!workflow?.exportable || latest.loading} onClick={() => next(2)}>Continue to Trapper deployments</button>
        </div>
      </Step>

      <Step
        n={2} title="Trapper deployments" status={status(2)} canEdit={!running} onEdit={() => setOpen(2)}
        description="The classification project in Trapper that the Zooniverse classifications are matched to. It must already exist, be linked to a classifier that includes every species the Zooniverse workflow can return, and contain the resources (images) you uploaded as subjects. Then pick the collection and deployments to restrict it to; subjects of other images are skipped."
        summary={selection && <>
          {selection.research_project.name} · {selection.classification_project.name}<br />
          {selection.collection.name} · {deploymentsSummary(selection)}
        </>}
      >
        <TrapperSelectionForm onSelectionChange={handleSelectionChange} useSavedConnection />
        <div className="flex items-center justify-between gap-3 mt-4">
          <BackButton onClick={() => setOpen(1)} />
          <button type="button" className={btnPrimary} disabled={!selection} onClick={() => next(3)}>Continue to export</button>
        </div>
      </Step>

      <Step
        n={3} title="Review and export" status={status(3)} canEdit={!running} onEdit={() => setOpen(3)}
        description="Check everything and start the export. Each observation gets one final answer, decided from the volunteers’ votes, ready to import into Trapper."
        summary={workflow && selection && <>Workflow {workflow.display_name} → collection {selection.collection.name}</>}
      >
        {workflow && selection && (
          <>
          <div className="space-y-3 mb-4">
            <ChoiceCard name="Also save each volunteer’s answer" type="checkbox" selected={saveZoo} disabled={running} onSelect={() => setSaveZoo((v) => !v)}>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Keeps every answer before the vote, so you can check how each observation was decided.
              </p>
            </ChoiceCard>
            <ChoiceCard name="Also keep the original Zooniverse data" type="checkbox" selected={saveRaw} disabled={running} onSelect={() => setSaveRaw((v) => !v)}>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                A copy exactly as Zooniverse provided it, saved in the export folder. It can be large — hundreds of MB.
              </p>
            </ChoiceCard>
            <ChoiceCard name="Import into Trapper when finished" type="checkbox" selected={autoImport} disabled={running} onSelect={() => setAutoImport((v) => !v)}>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Imports the result automatically, as expert classifications (not approved). If you leave this off, you can import it later from the result screen.
              </p>
            </ChoiceCard>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            You’ll get: the final result for Trapper{saveZoo && ' · each volunteer’s answer'}{saveRaw && ' · the original Zooniverse data'}
          </p>
            <div className="flex items-center justify-between gap-3">
              <BackButton onClick={() => setOpen(2)} disabled={running} />
              <button type="button" className={btnPrimary} disabled={!ready} onClick={handleExport}>
                {run ? 'Export again' : 'Export classifications'}
              </button>
            </div>
          </>
        )}
      </Step>

      <Step
        n={4} title="Export results" status={status(4)} canEdit={!running} onEdit={() => setOpen(3)}
        description="Progress of the export and the files it wrote."
        summary={run?.result && <>{run.result.rows.toLocaleString()} observations exported</>}
        badge={run?.status === 'stopped' ? 'Cancelled' : undefined}
        expanded={run?.status === 'done' && open === 4}
      >
        {run?.status === 'running' && <RunningView run={run} now={now} onStop={stop} />}
        {run && (run.status === 'error' || run.status === 'stopped') && <FailedView run={run} now={now} onRetry={handleExport} disabled={!ready} />}
        {run?.result && exportedSelection && <Result run={run} result={run.result} selection={exportedSelection} autoImport={autoImport} now={now} />}
        <div className="mt-4"><BackButton onClick={() => setOpen(3)} disabled={running} /></div>
      </Step>
    </div>
  )
}
