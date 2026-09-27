import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ProgressBar from '../components/ProgressBar'
import TrapperImportPanel from '../components/TrapperImportPanel'
import TrapperSelectionForm from '../components/TrapperSelectionForm'
import ZooniverseProjectPicker, { Divider, SmallSpinner, StepHeading } from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import type { ExportEvent, ExportResult, ExportSkipReason, TrapperSelection, ZooniverseWorkflow } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-6 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

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
          ['Subjects classified', result.subjects], ['Exported', result.exported],
          ['Observations voted', result.observations], ['CSV rows', result.rows],
        ].map(([label, value]) => (
          <div key={label} className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
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
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mt-4 mb-1">
            {result.files.length > 1 ? `Observations — split into ${result.files.length} files` : 'Observations'}
          </p>
          <ul className="space-y-0.5">
            {result.files.map((f) => (
              <li key={f.path} className="text-xs font-mono text-zinc-600 dark:text-zinc-300 break-all">
                {f.path} <span className="text-zinc-400 dark:text-zinc-500">· {f.rows.toLocaleString()} rows · {formatBytes(f.bytes)}</span>
              </li>
            ))}
          </ul>
          {result.zoo_annotations_file && (
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mt-2 break-all">
              Volunteers&rsquo; answers: {result.zoo_annotations_file.path}
            </p>
          )}
          <TrapperImportPanel
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
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [workflows, setWorkflows] = useState<{ items: ZooniverseWorkflow[]; loading: boolean; error: string | null }>(
    { items: [], loading: false, error: null },
  )
  const [workflowId, setWorkflowId] = useState('')
  const [latest, setLatest] = useState<{ loading: boolean; export: { state: string | null; updated_at: string | null } | null }>(
    { loading: false, export: null },
  )
  const [regenerate, setRegenerate] = useState(false)
  const [selection, setSelection] = useState<TrapperSelection | null>(null)
  const [outputDir, setOutputDir] = useState('')
  const [classifiedBy, setClassifiedBy] = useState('')
  const [maxSize, setMaxSize] = useState('')
  const [saveZoo, setSaveZoo] = useState(true)
  // Import the CSVs into Trapper as soon as the export ends — wildintel-tools' --upload.
  const [autoImport, setAutoImport] = useState(false)
  // The selection the last export was made with — what its CSVs are imported into.
  const [exportedSelection, setExportedSelection] = useState<TrapperSelection | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    api.exportDefaults()
      .then((d) => {
        setOutputDir((v) => v || d.output_dir)
        setClassifiedBy((v) => v || d.classified_by)
        setMaxSize((v) => v || String(d.max_file_size_mb))
      })
      .catch(() => {})
    return () => abortRef.current?.abort()
  }, [])

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
  const maxSizeValue = /^\d+(\.\d+)?$/.test(maxSize.trim()) && Number(maxSize) > 0 ? Number(maxSize) : null
  const ready = Boolean(workflow?.exportable && selection && outputDir.trim() && classifiedBy.trim() && maxSizeValue) && !running

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
        { outputDir, regenerate, saveZooAnnotations: saveZoo, classifiedBy: classifiedBy.trim(), maxFileSizeMb: maxSizeValue },
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

  const exportReady = latest.export && (latest.export.state === 'ready' || latest.export.state === 'finished')

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Retrieve classifications</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Turn a workflow&rsquo;s Zooniverse classifications into observations for Trapper: the volunteers&rsquo; answers for
        each image are voted, and written as a CSV for Trapper&rsquo;s classification import.
      </p>

      <ZooniverseProjectPicker title="Workflow" disabled={running} loadSubjectSets={false} onChange={handlePick}>
        {workflows.loading && <p className={hintClass}>Loading the project&rsquo;s workflows…</p>}
        {workflows.error && <p className="text-sm text-red-600 dark:text-red-400">{workflows.error}</p>}
        {!workflows.loading && !workflows.error && (
          <div className="mb-6">
            <label className={labelClass} htmlFor="export-workflow">Workflow</label>
            <select
              id="export-workflow" className={inputClass} disabled={running || workflows.items.length === 0}
              value={workflowId} onChange={(e) => { setWorkflowId(e.target.value); setRun(null) }}
            >
              <option value="">{workflows.items.length === 0 ? 'This project has no workflows' : 'Select a workflow…'}</option>
              {workflows.items.map((w) => (
                <option key={w.id} value={String(w.id)} disabled={!w.exportable}>
                  {w.display_name} (#{w.id}){w.exportable ? '' : ' — can’t be exported'}
                </option>
              ))}
            </select>
            <p className={hintClass}>
              Only workflows the app knows how to vote can be exported — each has its own species and answers.
            </p>
            {workflow && (
              <div className="mt-3">
                {latest.loading
                  ? <p className={hintClass}>Checking its classifications export…</p>
                  : (
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                      {exportReady
                        ? <>Latest classifications export: <strong>{formatDate(latest.export!.updated_at)}</strong>.</>
                        : latest.export
                          ? 'A classifications export is being made in Zooniverse — the export waits for it.'
                          : 'It has no classifications export yet — one will be made first (it can take a few minutes).'}
                    </p>
                  )}
                {exportReady && (
                  <label className="flex items-start gap-2.5 cursor-pointer mt-2">
                    <input type="checkbox" className="mt-1" checked={regenerate} disabled={running} onChange={(e) => setRegenerate(e.target.checked)} />
                    <span>
                      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Make a new export first</span>
                      <span className={`block ${hintClass}`}>
                        The latest one lacks the classifications made since. A new one can take several minutes for a big workflow.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>
        )}
      </ZooniverseProjectPicker>

      {workflow && (
        <>
          <Divider />
          <StepHeading n={3}>Trapper images</StepHeading>
          <p className={`${hintClass} mb-4`}>
            The collection and deployments whose observations get the classifications — the ones the subjects were uploaded from.
            Subjects of other images (e.g. another subject set of the workflow) are skipped.
          </p>
          <div className="p-4 mb-6 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <TrapperSelectionForm onSelectionChange={handleSelectionChange} />
          </div>

          <Divider />
          <StepHeading n={4}>Export</StepHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="export-folder">Folder</label>
              <input id="export-folder" className={inputClass} disabled={running} value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="export-classified-by">Classified by</label>
              <input id="export-classified-by" className={inputClass} disabled={running} value={classifiedBy} onChange={(e) => setClassifiedBy(e.target.value)} />
              <p className={hintClass}>Who the observations are classified by, in Trapper.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="export-max-size">Largest CSV (MB)</label>
              <input id="export-max-size" className={inputClass} inputMode="decimal" disabled={running} value={maxSize} onChange={(e) => setMaxSize(e.target.value)} />
              {maxSizeValue === null
                ? <p className="text-xs text-red-600 dark:text-red-400 mt-1">A number above 0.</p>
                : <p className={hintClass}>Bigger exports are split into several files — Trapper&rsquo;s import has a size limit.</p>}
            </div>
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer mb-5">
            <input type="checkbox" className="mt-1" checked={saveZoo} disabled={running} onChange={(e) => setSaveZoo(e.target.checked)} />
            <span>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Also save the volunteers&rsquo; answers</span>
              <span className={`block ${hintClass}`}>A second CSV with each answer before voting — to check how an observation was decided.</span>
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
                {!selection ? 'Choose the Trapper images first.' : <>Workflow <strong>{workflow.display_name}</strong> → collection <strong>{selection.collection.name}</strong>.</>}
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
        </>
      )}

      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack} disabled={running}>Back</button>
        {running && <p className={hintClass}>Stop the export to go back.</p>}
      </div>
    </div>
  )
}
