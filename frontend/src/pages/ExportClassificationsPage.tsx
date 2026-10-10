import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type WorkflowExport } from '../api'
import Combobox from '../components/Combobox'
import FieldLabel from '../components/FieldLabel'
import ProgressBar from '../components/ProgressBar'
import Stepper from '../components/Stepper'
import TrapperImportPanel from '../components/TrapperImportPanel'
import TrapperSelectionForm from '../components/TrapperSelectionForm'
import ZooniverseProjectPicker, { SmallSpinner } from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import type { AppSettings, ExportEvent, ExportResult, ExportSkipReason, TrapperSelection, ZooniverseWorkflow } from '../types'

const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-6 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

const STEP_LABELS = ['Zooniverse', 'Trapper', 'Export']

const SKIP_LABELS: Record<ExportSkipReason, { label: string; hint: string }> = {
  not_in_trapper: { label: 'Not in the Trapper selection', hint: 'Their image has no observation in the chosen collection and deployments — e.g. another subject set of the workflow.' },
  no_media_id: { label: 'No Trapper media id', hint: 'Their metadata doesn’t say which Trapper image they are.' },
  no_valid_classifications: { label: 'No valid classifications', hint: 'Every classification had no answer, or too many.' },
  no_decision: { label: 'No decision', hint: 'The votes didn’t produce an observation.' },
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

function formatDate(iso: string | null): string {
  if (!iso) return 'unknown date'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function utcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

// "9 Oct 2026, 18:44 UTC" — Zooniverse's own style, whatever the time zone of the browser.
function formatUtc(iso: string | null): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return 'unknown date'
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${utcTime(d)}`
}

// "10 Oct at 18:44 UTC"
function formatUtcNext(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} at ${utcTime(d)}`
}

// Zooniverse makes one classifications export per workflow every 24 hours.
const COOLDOWN_MS = 24 * 60 * 60 * 1000

function formatAgo(iso: string | null, now = Date.now()): string {
  const ms = iso ? now - new Date(iso).getTime() : NaN
  if (Number.isNaN(ms)) return ''
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 60) return plural(minutes, 'minute')
  if (minutes < 60 * 24) return plural(Math.round(minutes / 60), 'hour')
  return plural(Math.round(minutes / 60 / 24), 'day')
}

// ── The run's progress ──────────────────────────────────────────────────

interface Run {
  status: 'running' | 'done' | 'stopped' | 'error'
  error?: string
  export?: { state: 'generating' | 'ready'; updated_at: string | null }
  download?: { rows: number; bytes: number; total: number | null; done: boolean; subjects?: number }
  trapper?: { total: number; done: number; observations: number }
  voting?: { total: number; done: number }
  result?: ExportResult
}

function reduce(run: Run, event: ExportEvent): Run {
  switch (event.type) {
    case 'export': return { ...run, export: { state: event.state, updated_at: event.updated_at } }
    case 'classifications':
      return { ...run, download: { rows: event.rows, bytes: event.bytes, total: event.total_bytes, done: false } }
    case 'classifications_done':
      return { ...run, download: { ...(run.download ?? { bytes: 0, total: null }), rows: event.rows, done: true, subjects: event.subjects } }
    case 'trapper': return { ...run, trapper: { total: event.total, done: 0, observations: 0 } }
    case 'deployment':
      return run.trapper
        ? { ...run, trapper: { ...run.trapper, done: run.trapper.done + 1, observations: run.trapper.observations + event.observations } }
        : run
    case 'subjects': return { ...run, voting: { total: event.total, done: 0 } }
    case 'progress': return run.voting ? { ...run, voting: { ...run.voting, done: event.done } } : run
    case 'done': {
      const { type: _type, ...result } = event
      return { ...run, status: 'done', result }
    }
    default: return run
  }
}

function Phase({ label, detail, percent, state }: { label: string; detail: string; percent: number | null; state: 'running' | 'done' }) {
  return (
    <div className="mt-3">
      <div className="flex justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-300 mb-1">
        <span className="flex items-center gap-1.5">
          {state === 'done' ? <span className="text-emerald-600">✓</span> : percent === null && <SmallSpinner />}
          {label}
        </span>
        <span className="text-right">{detail}</span>
      </div>
      {percent !== null && <ProgressBar percent={state === 'done' ? 100 : percent} label={label} tone={state === 'done' ? 'emerald' : 'blue'} />}
    </div>
  )
}

function Result({ result, selection, autoImport }: { result: ExportResult; selection: TrapperSelection; autoImport: boolean }) {
  const [folderError, setFolderError] = useState<string | null>(null)
  const skipped = (Object.keys(SKIP_LABELS) as ExportSkipReason[]).filter((r) => result.skipped[r] > 0)
  return (
    <div className="mt-4">
      <p className={`text-sm font-semibold ${result.rows ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
        {result.rows
          ? `Export finished: ${result.exported.toLocaleString()} of ${result.subjects.toLocaleString()} subjects → ${result.rows.toLocaleString()} CSV rows.`
          : 'Export finished, but no subject could be exported — nothing was written.'}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        {[
          ['Subjects classified', result.subjects, 'Subjects with classifications in Zooniverse’s export.'],
          ['Images classified', result.trapper_media, 'Images of the chosen collection and deployments with observations in the classification project.'],
          ['Subjects exported', result.exported, 'Subjects whose image is in Trapper’s selection and whose votes gave a decision.'],
          ['Observations voted', result.observations, 'A subject can give more than one: one per species.'],
        ].map(([label, value, hint]) => (
          <div key={label as string} className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700" title={hint as string}>
            <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{(value as number).toLocaleString()}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
          </div>
        ))}
      </div>
      <p className={hintClass}>One row per voted observation and Trapper observation of its image — the one Trapper&rsquo;s import updates.</p>

      {skipped.length > 0 && (
        <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Subjects not exported</p>
          <ul className="space-y-1">
            {skipped.map((r) => (
              <li key={r} className="text-xs text-zinc-600 dark:text-zinc-300" title={SKIP_LABELS[r].hint}>
                <strong>{result.skipped[r].toLocaleString()}</strong> — {SKIP_LABELS[r].label}
                {result.samples[r] && (
                  <span className="block font-mono text-zinc-400 dark:text-zinc-500 truncate">
                    e.g. {result.samples[r]!.slice(0, 10).join(', ')}{result.samples[r]!.length > 10 ? '…' : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.files.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
            <div>
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {result.files.length > 1 ? `Observations — split into ${result.files.length} files` : 'Observations'}
              </p>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                {result.files.reduce((sum, f) => sum + f.rows, 0).toLocaleString()} rows · {formatBytes(result.files.reduce((sum, f) => sum + f.bytes, 0))}
                {result.zoo_annotations_file && ' · plus the volunteers’ answers'}
                {result.raw_export_file && ` · and Zooniverse’s CSV (${formatBytes(result.raw_export_file.bytes)})`}
              </p>
              <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500 break-all">{result.run_dir ?? result.output_dir}</p>
            </div>
          </div>
          {folderError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{folderError}</p>}
          <TrapperImportPanel
            leading={
              <button
              type="button" className={btnOutline}
              onClick={() => { setFolderError(null); api.openExportFolder(result.run_dir ?? undefined).catch((e) => setFolderError(e instanceof Error ? e.message : 'Could not open the folder.')) }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              Open folder
            </button>
            }
            files={result.files.map((f) => f.path)} trapperUrl={selection.url}
            project={selection.classification_project} manualUrl={result.trapper_import_url} autoStart={autoImport}
          />
        </>
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
  // 0: Zooniverse (project, workflow, its export) · 1: Trapper images · 2: summary and export.
  const [step, setStep] = useState(0)
  // The Trapper form stays mounted once first reached, so going Back never loses what was chosen.
  const [trapperShown, setTrapperShown] = useState(false)
  // The settings the export uses (folder, classified by, CSV size) — for the summary.
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
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

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    api.getSettings().then(setAppSettings).catch(() => {})
  }, [])

  function goTo(next: number) {
    if (next >= 1) setTrapperShown(true)
    setStep(next)
  }

  // Back from the first step leaves for the task choice.
  function handleBack() {
    if (step === 0) onBack()
    else goTo(step - 1)
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
  const workflow = workflows.items.find((w) => String(w.id) === workflowId)
  const ready = Boolean(workflow?.exportable && selection) && !running

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function handleExport() {
    if (!workflow || !selection || !pick) return
    stop()
    const controller = new AbortController()
    abortRef.current = controller
    setRun({ status: 'running' })
    setExportedSelection(selection)
    try {
      await api.exportClassifications(
        pick.creds, workflow.id, selection,
        { regenerate, saveZooAnnotations: saveZoo, saveRawExport: saveRaw },
        (event) => setRun((r) => (r && reduce(r, event))), controller.signal,
      )
    } catch (e) {
      if (controller.signal.aborted) {
        setRun((r) => (r && r.status === 'running' ? { ...r, status: 'stopped' } : r))
      } else {
        setRun((r) => ({ ...r, status: 'error', error: e instanceof Error ? e.message : 'The export failed.' }))
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

  const summaryFolder = appSettings?.ZOONIVERSE.export_output_dir || 'exports, in the app’s documents folder'

  return (
    <div>
      <Stepper labels={STEP_LABELS} current={step} />

      {/* ── Step 1: Zooniverse — project, workflow and its export ── */}
      <div className={step === 0 ? '' : 'hidden'}>
        <h4 className="text-lg font-semibold mb-1">Zooniverse project</h4>
        <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
          Select the project and workflow to retrieve classifications from, and whether to ask Zooniverse for a new export of them.
        </p>
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
              <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 p-4">
                {latest.loading
                  ? <p className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2"><SmallSpinner /> Checking its classifications export…</p>
                  : (
                    <>
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 mt-1 text-zinc-500 dark:text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                          <ellipse cx="12" cy="6" rx="7" ry="3" />
                          <path strokeLinecap="round" d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">
                            {hasFile ? 'Classification export available' : latestExport ? 'Classification export being made' : 'No classification export yet'}
                          </p>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {hasFile
                              ? formatUtc(latestExport!.file_date ?? latestExport!.updated_at)
                              : latestExport
                                ? cooling
                                  ? 'Zooniverse is making it — the export waits for it.'
                                  : `The last request (${formatAgo(latestExport.updated_at)}) never finished — a new export will be made first.`
                                : 'One will be made first — it can take a few minutes.'}
                          </p>
                        </div>
                        <span
                          className={[
                            'px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap',
                            hasFile
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : latestExport
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
                          ].join(' ')}
                        >
                          {hasFile ? 'Available' : latestExport ? 'Pending' : 'None'}
                        </span>
                      </div>
                      {hasFile && latestExport!.pending && (
                        <p className={`${hintClass} mt-2`}>
                          {cooling
                            ? `A newer one was requested ${formatAgo(latestExport!.updated_at)} and isn’t done yet — this one is used.`
                            : `A newer one was requested ${formatAgo(latestExport!.updated_at)} and never finished — it can be asked again.`}
                        </p>
                      )}
                      {hasFile && (
                        <>
                          <div className="border-t border-zinc-200 dark:border-zinc-700 my-4" />
                          <label className={`flex items-center gap-3 ${cooling || running ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox" checked={regenerate && !cooling} disabled={running || cooling}
                              onChange={(e) => setRegenerate(e.target.checked)}
                              className="w-6 h-6 rounded-full appearance-none border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 checked:bg-blue-600 checked:border-blue-600 flex-shrink-0"
                            />
                            <span className="text-base text-zinc-900 dark:text-zinc-100">Generate a new export</span>
                          </label>
                          <p className={`${hintClass} mt-2`}>
                            {cooling
                              ? `Zooniverse allows a new export once every 24 hours. The next request will be available on ${formatUtcNext(nextRequestAt!)}.`
                              : 'The latest one lacks the classifications made since. A new one can take several minutes for a big workflow.'}
                          </p>
                        </>
                      )}
                    </>
                  )}
              </div>
            )}
          </div>
        </ZooniverseProjectPicker>
      </div>

      {/* ── Step 2: Trapper — the images the classifications go to ── */}
      {(step >= 1 || trapperShown) && (
        <div className={step === 1 ? '' : 'hidden'}>
          <h4 className="text-lg font-semibold mb-1">Trapper images</h4>
          <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
            The collection and deployments whose observations get the classifications — the ones the subjects were uploaded from.
            Subjects of other images (e.g. another subject set of the workflow) are skipped.
          </p>
          <TrapperSelectionForm onSelectionChange={handleSelectionChange} useSavedConnection />
        </div>
      )}

      {/* ── Step 3: summary, and the export ── */}
      {step === 2 && workflow && selection && (
        <div>
          <h4 className="text-lg font-semibold mb-1">Summary</h4>
          <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
            Check it, and start the export: the volunteers’ answers are voted and written as CSV files for Trapper’s classification import.
          </p>
          <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 mb-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-zinc-500 dark:text-zinc-400">Zooniverse project</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{pick?.projectName}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Workflow</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{workflow.display_name} <span className="text-zinc-500 dark:text-zinc-400">(#{workflow.id})</span></dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Classifications export</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">
                {regenerate && !cooling
                  ? 'A new one is made first'
                  : hasFile
                    ? <>The latest, of {formatUtc(latestExport!.file_date ?? latestExport!.updated_at)}</>
                    : 'None yet — one is made first'}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Trapper</dt>
              <dd className="text-zinc-800 dark:text-zinc-200 font-mono break-all">{selection.url}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Research project</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{selection.research_project.name}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Classification project</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{selection.classification_project.name}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Collection</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{selection.collection.name}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Deployments</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">
                {selection.all_deployments ? `All ${selection.deployments.length}` : `${selection.deployments.length} selected`}
                {selection.deployments.every((d) => d.image_count != null) && (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {' '}· {selection.deployments.reduce((sum, d) => sum + (d.image_count ?? 0), 0).toLocaleString()} images
                  </span>
                )}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Files</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">
                <span className="font-mono break-all">{summaryFolder}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">in a folder of its own, named after the workflow, the collection and the time</span>
                {appSettings && (
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    classified by {appSettings.ZOONIVERSE.export_classified_by} · CSVs up to {appSettings.ZOONIVERSE.export_max_file_size_mb} MB — from the settings
                  </span>
                )}
              </dd>
            </dl>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer mb-5">
            <input type="checkbox" className="mt-1" checked={saveZoo} disabled={running} onChange={(e) => setSaveZoo(e.target.checked)} />
            <span>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Also save the volunteers&rsquo; answers</span>
              <span className={`block ${hintClass}`}>A second CSV with each answer before voting — to check how an observation was decided.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer mb-5 -mt-2">
            <input type="checkbox" className="mt-1" checked={saveRaw} disabled={running} onChange={(e) => setSaveRaw(e.target.checked)} />
            <span>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Also keep Zooniverse&rsquo;s classifications CSV</span>
              <span className={`block ${hintClass}`}>As Zooniverse exported it, in the export&rsquo;s folder — it can be big (hundreds of MB).</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer mb-5 -mt-2">
            <input type="checkbox" className="mt-1" checked={autoImport} disabled={running} onChange={(e) => setAutoImport(e.target.checked)} />
            <span>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Import into Trapper when finished</span>
              <span className={`block ${hintClass}`}>
                Without asking again — as expert classifications, not approved. Otherwise, import it from the result.
              </span>
            </span>
          </label>

          <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                Workflow <strong>{workflow.display_name}</strong> → collection <strong>{selection.collection.name}</strong>.
              </span>
              {running
                ? <button type="button" className={btnOutline} onClick={stop}><SmallSpinner />Stop</button>
                : <button type="button" className={btnPrimary} disabled={!ready} onClick={handleExport}>{run ? 'Export again' : 'Export CSV'}</button>}
            </div>

            {run?.export && (
              <Phase
                label={run.export.state === 'generating' ? 'Making a new classifications export in Zooniverse…' : 'Classifications export'}
                detail={run.export.state === 'ready' ? formatDate(run.export.updated_at) : 'this can take a few minutes'}
                percent={null} state={run.export.state === 'ready' ? 'done' : 'running'}
              />
            )}
            {run?.download && (
              <Phase
                label="Classifications downloaded"
                detail={`${run.download.rows.toLocaleString()} rows${run.download.subjects !== undefined ? ` · ${run.download.subjects.toLocaleString()} subjects` : ` · ${formatBytes(run.download.bytes)}`}`}
                percent={run.download.total ? Math.min(99, Math.round((run.download.bytes / run.download.total) * 100)) : null}
                state={run.download.done ? 'done' : 'running'}
              />
            )}
            {run?.trapper && (
              <Phase
                label="Trapper deployments fetched"
                detail={`${run.trapper.done} of ${run.trapper.total} · ${run.trapper.observations.toLocaleString()} observations`}
                percent={run.trapper.total ? Math.round((run.trapper.done / run.trapper.total) * 100) : 100}
                state={run.voting ? 'done' : 'running'}
              />
            )}
            {run?.voting && (
              <Phase
                label="Subjects voted"
                detail={`${run.voting.done.toLocaleString()} of ${run.voting.total.toLocaleString()}`}
                percent={run.voting.total ? Math.round((run.voting.done / run.voting.total) * 100) : 100}
                state={run.status === 'done' ? 'done' : 'running'}
              />
            )}
            {run?.status === 'stopped' && <p className={hintClass}>Stopped — nothing was written.</p>}
            {run?.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{run.error}</p>}
            {run?.result && exportedSelection && <Result result={run.result} selection={exportedSelection} autoImport={autoImport} />}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-start mt-10">
        <div>
          <button type="button" className={btnOutline} onClick={handleBack} disabled={running}>Back</button>
          {running && <p className={hintClass}>Stop the export to go back.</p>}
        </div>
        {step === 0 && (
          <button type="button" className={btnPrimary} disabled={!workflow?.exportable || latest.loading} onClick={() => goTo(1)}>Next</button>
        )}
        {step === 1 && (
          <button type="button" className={btnPrimary} disabled={!selection} onClick={() => goTo(2)}>Next</button>
        )}
      </div>
    </div>
  )
}
