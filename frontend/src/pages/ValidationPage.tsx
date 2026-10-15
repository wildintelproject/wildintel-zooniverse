import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import Combobox from '../components/Combobox'
import FieldLabel from '../components/FieldLabel'
import ProgressBar from '../components/ProgressBar'
import TrapperSelectionForm from '../components/TrapperSelectionForm'
import UploadCriteriaForm from '../components/UploadCriteriaForm'
import Step from '../components/WizardStep'
import ZooniverseProjectPicker, { Divider, SmallSpinner } from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import { DEFAULT_CRITERIA } from '../types'
import type { TrapperSelection, UploadCriteria, ValidationEvent, ValidationReport } from '../types'

const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-6 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

/** Rows shown per finding — the whole list is in the downloaded report. */
const SHOWN_ROWS = 200

// ── The run's progress ──────────────────────────────────────────────────

interface Run {
  status: 'running' | 'done' | 'stopped' | 'error'
  error?: string
  subjects?: { total: number; done: number }
  trapper?: { total: number; done: number }
  report?: ValidationReport
}

function reduce(run: Run, event: ValidationEvent): Run {
  switch (event.type) {
    case 'subjects': return { ...run, subjects: { total: event.total, done: 0 } }
    case 'progress': return run.subjects ? { ...run, subjects: { ...run.subjects, done: event.done } } : run
    case 'trapper': return { ...run, trapper: { total: event.total, done: 0 } }
    case 'deployment': return run.trapper ? { ...run, trapper: { ...run.trapper, done: run.trapper.done + 1 } } : run
    case 'report': {
      const { type: _type, ...report } = event
      return { ...run, report }
    }
    case 'done': return { ...run, status: 'done' }
    default: return run
  }
}

function PhaseBar({ label, done, total, finished }: { label: string; done: number; total: number; finished: boolean }) {
  const percent = finished ? 100 : total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-300 mb-1">
        <span>{label}</span>
        <span>{done.toLocaleString()} of {total.toLocaleString()}</span>
      </div>
      <ProgressBar percent={percent} label={label} tone={finished ? 'emerald' : 'blue'} />
    </div>
  )
}

// ── The report ──────────────────────────────────────────────────────────

function Tile({ label, value, bad, hint }: { label: string; value: number; bad?: boolean; hint: string }) {
  const tone = bad === undefined
    ? 'text-zinc-900 dark:text-zinc-100'
    : bad ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
  return (
    <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700" title={hint}>
      <div className={`text-xl font-semibold ${tone}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  )
}

function Finding({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <details className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <summary className="px-3 py-2 text-sm font-semibold cursor-pointer text-zinc-700 dark:text-zinc-300">
        {title} <span className="font-normal text-zinc-500 dark:text-zinc-400">({count.toLocaleString()})</span>
      </summary>
      <div className="px-3 pb-3 max-h-72 overflow-auto">
        {children}
        {count > SHOWN_ROWS && (
          <p className={hintClass}>…and {(count - SHOWN_ROWS).toLocaleString()} more — download the report for the full list.</p>
        )}
      </div>
    </details>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-zinc-500 dark:text-zinc-400 text-left">
        <tr>{head.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {rows.slice(0, SHOWN_ROWS).map((row, i) => (
          <tr key={i}>{row.map((cell, j) => <td key={j} className="py-1 pr-3 font-mono align-top">{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

function downloadReport(report: ValidationReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `validation_subject-set-${report.subject_set.id}_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadUploadedIds(report: ValidationReport) {
  const text = report.uploaded.map((m) => m.media_id).join('\n') + '\n'
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `uploaded-media_subject-set-${report.subject_set.id}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function Report({ report }: { report: ValidationReport }) {
  const missing = report.missing ?? []
  const extra = report.extra ?? []
  const problems = report.duplicated.length + report.unmatched.length + report.metadata_issues.length + missing.length + extra.length
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <p className={`text-sm font-semibold ${problems ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {problems
            ? `Subject set ${report.subject_set.name}: ${problems.toLocaleString()} finding(s).`
            : `Subject set ${report.subject_set.name}: no problems found.`}
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button" className={btnOutline} onClick={() => downloadUploadedIds(report)} disabled={report.uploaded.length === 0}
            title="One Trapper media id per line — e.g. to load as an upload's list of images never to upload again"
          >
            Download uploaded media ids (TXT)
          </button>
          <button type="button" className={btnOutline} onClick={() => downloadReport(report)}>Download report (JSON)</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Subjects" value={report.subjects} hint="Subjects in the subject set" />
        <Tile label="Trapper media" value={report.media} hint="Distinct Trapper media among them" />
        {report.compared && <Tile label="Expected" value={report.expected ?? 0} hint="Images an upload of the Trapper selection would send" />}
        {report.compared && <Tile label="Missing" value={missing.length} bad={missing.length > 0} hint="Expected, but not in the subject set" />}
        {report.compared && <Tile label="Extra" value={extra.length} bad={extra.length > 0} hint="In the subject set, but not expected" />}
        <Tile label="Duplicated" value={report.duplicated.length} bad={report.duplicated.length > 0} hint="Media in more than one subject" />
        <Tile label="Unmatched" value={report.unmatched.length} bad={report.unmatched.length > 0} hint="Subjects with no Trapper media id" />
        <Tile label="Metadata issues" value={report.metadata_issues.length} bad={report.metadata_issues.length > 0} hint="Subjects with missing or wrong metadata" />
      </div>

      {report.deployments && report.deployments.length > 0 && (
        <div className="mt-4 max-h-72 overflow-auto">
          <Table
            head={['Deployment', 'Expected', 'Uploaded', 'Missing']}
            rows={report.deployments.map((d) => [
              d.deployment_id, d.expected.toLocaleString(), d.uploaded.toLocaleString(),
              <span className={d.missing ? 'text-red-600 dark:text-red-400' : ''}>{d.missing.toLocaleString()}</span>,
            ])}
          />
        </div>
      )}

      <Finding title="Missing media" count={missing.length}>
        <Table head={['Media', 'Deployment', 'File']} rows={missing.map((m) => [m.media_id, m.deployment_id, m.file_name])} />
      </Finding>
      <Finding title="Extra media" count={extra.length}>
        <Table head={['Media', 'Subjects']} rows={extra.map((m) => [m.media_id, m.subject_ids.join(', ')])} />
      </Finding>
      <Finding title="Duplicated media" count={report.duplicated.length}>
        <Table head={['Media', 'Subjects']} rows={report.duplicated.map((m) => [m.media_id, m.subject_ids.join(', ')])} />
      </Finding>
      <Finding title="Unmatched subjects" count={report.unmatched.length}>
        <Table head={['Subject']} rows={report.unmatched.map((id) => [id])} />
      </Finding>
      <Finding title="Metadata issues" count={report.metadata_issues.length}>
        <Table
          head={['Subject', 'Media', 'Issues']}
          rows={report.metadata_issues.map((m) => [m.subject_id, m.media_id ?? '—', <span className="font-sans">{m.issues.join('; ')}</span>])}
        />
      </Finding>
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

/** Validation & audit of a subject set — wildintel-tools' check-* commands
 * in two phases: the subject set on its own (duplicated media, subjects with
 * no Trapper media id, and their metadata), then compared with a Trapper
 * collection (chosen as for an upload): which images are missing or extra,
 * and every metadata field. */
export default function ValidationPage({ onBack }: Props) {
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [subjectSetId, setSubjectSetId] = useState('')
  const [selection, setSelection] = useState<TrapperSelection | null>(null)
  const [criteria, setCriteria] = useState<UploadCriteria | null>(null)
  const [initialCriteria, setInitialCriteria] = useState<UploadCriteria | null>(null)
  // Phase 1: the subject set on its own. Phase 2: compared with Trapper.
  const [run, setRun] = useState<Run | null>(null)
  const [comparison, setComparison] = useState<Run | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The step that's open, and the furthest one unlocked.
  const [open, setOpen] = useState(1)
  const [reached, setReached] = useState(1)

  useEffect(() => {
    // New comparisons start from the settings page's criteria.
    api.getSettings()
      .then((s) => setInitialCriteria(s.SEQUENCES))
      .catch(() => setInitialCriteria(DEFAULT_CRITERIA))
    return () => abortRef.current?.abort()
  }, [])

  const handlePick = useCallback((next: ZooniversePick) => setPick(next), [])
  const handleSelectionChange = useCallback((value: TrapperSelection | null) => setSelection(value), [])
  const handleCriteriaChange = useCallback((value: UploadCriteria | null) => setCriteria(value), [])
  useEffect(() => setSubjectSetId(''), [pick?.projectId, pick?.creds])

  const running = run?.status === 'running' || comparison?.status === 'running'
  const subjectSets = pick?.subjectSets.items ?? []
  const chosen = subjectSets.find((s) => String(s.id) === subjectSetId)
  const validated = run?.status === 'done' && run.report !== undefined
  const report = comparison?.report ?? run?.report
  const unlocked = (n: number) => n === 1 || (n === 2 ? Boolean(chosen) : validated)
  const status = (n: number): 'open' | 'done' | 'locked' => (n === open ? 'open' : n <= reached && unlocked(n) ? 'done' : 'locked')
  function next(n: number) {
    setOpen(n)
    setReached((r) => Math.max(r, n))
  }

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function execute(
    set: (update: (r: Run | null) => Run | null) => void, trapper: { selection: TrapperSelection; criteria: UploadCriteria } | null,
  ) {
    if (!chosen || !pick) return
    stop()
    const controller = new AbortController()
    abortRef.current = controller
    set(() => ({ status: 'running' }))
    try {
      await api.validateSubjectSet(pick.creds, chosen.id, trapper, (event) => set((r) => (r && reduce(r, event))), controller.signal)
    } catch (e) {
      if (controller.signal.aborted) {
        set((r) => (r && r.status === 'running' ? { ...r, status: 'stopped' } : r))
      } else {
        set((r) => ({ ...r, status: 'error', error: e instanceof Error ? e.message : 'The validation failed.' }))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  function handleValidate() {
    setComparison(null)
    return execute(setRun, null)
  }

  function handleCompare() {
    if (selection && criteria) return execute(setComparison, { selection, criteria })
  }

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Validation &amp; audit</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Check a subject set: duplicated images, subjects that can&rsquo;t be traced back to Trapper, and their metadata.
        Then compare it with a Trapper collection to find which images are missing or shouldn&rsquo;t be there.
      </p>

      <Step
        n={1} title="Target subject set" status={status(1)} canEdit={!running} onEdit={() => setOpen(1)}
        description="Subject set to check."
        summary={chosen && <>{pick?.projectName}<br />{chosen.display_name} · {chosen.subjects_count.toLocaleString()} subjects</>}
      >
        <ZooniverseProjectPicker disabled={running} useSavedConnection framed onChange={handlePick}>
          <div className="mb-6">
            <FieldLabel htmlFor="validate-subject-set" done={Boolean(chosen)}>Subject set</FieldLabel>
            <Combobox
              id="validate-subject-set" disabled={running}
              options={subjectSets.map((s) => ({ value: String(s.id), label: `${s.display_name} — ${s.subjects_count.toLocaleString()} subjects (#${s.id})` }))}
              value={subjectSetId} onChange={(value) => { setSubjectSetId(value); setRun(null); setComparison(null) }}
              placeholder="Select a subject set…" clearLabel="Clear subject set"
            />
          </div>
        </ZooniverseProjectPicker>
        <div className="flex justify-end mt-4">
          <button type="button" className={btnPrimary} disabled={!chosen} onClick={() => next(2)}>Continue to validation</button>
        </div>
      </Step>

      <Step
        n={2} title="Validate the subject set" status={status(2)} canEdit={!running} onEdit={() => setOpen(2)}
        description="Duplicated images, subjects with no Trapper media id, and their metadata."
        summary={chosen && <>{chosen.display_name} validated</>}
      >
        {chosen && (
          <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                Subject set <strong>{chosen.display_name}</strong>, on its own.
              </span>
              {run?.status === 'running'
                ? <button type="button" className={btnOutline} onClick={stop}><SmallSpinner />Stop</button>
                : (
                  <button type="button" className={btnPrimary} disabled={running} onClick={handleValidate}>
                    {run ? 'Validate again' : 'Validate'}
                  </button>
                )}
            </div>
            {run?.subjects && (
              <PhaseBar label="Subjects listed" done={run.subjects.done} total={run.subjects.total} finished={run.status === 'done'} />
            )}
            {run?.status === 'stopped' && <p className={hintClass}>Stopped.</p>}
            {run?.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{run.error}</p>}
            {!comparison?.report && run?.report && <Report report={run.report} />}
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button type="button" className={btnPrimary} disabled={!validated || running} onClick={() => next(3)}>Continue to comparison</button>
        </div>
      </Step>

      <Step
        n={3} title="Compare with Trapper" status={status(3)} canEdit={!running} onEdit={() => setOpen(3)}
        description="Find missing and extra images and check every metadata field against what an upload would set."
        summary={selection && <>Collection {selection.collection.name}</>}
      >
        <div className="p-4 mb-6 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <TrapperSelectionForm onSelectionChange={handleSelectionChange} useSavedConnection />
          {selection && initialCriteria && (
            <>
              <Divider />
              <h5 className="text-sm font-semibold mb-3 text-zinc-700 dark:text-zinc-300">Upload criteria</h5>
              <UploadCriteriaForm selection={selection} initial={initialCriteria} onCriteriaChange={handleCriteriaChange} />
            </>
          )}
        </div>
        <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              {selection && criteria
                ? <>Subject set <strong>{chosen?.display_name}</strong> against collection <strong>{selection.collection.name}</strong>.</>
                : 'Choose the Trapper images to compare with first.'}
            </span>
            {comparison?.status === 'running'
              ? <button type="button" className={btnOutline} onClick={stop}><SmallSpinner />Stop</button>
              : (
                <button type="button" className={btnPrimary} disabled={!selection || !criteria || running} onClick={handleCompare}>
                  {comparison ? 'Compare again' : 'Compare'}
                </button>
              )}
          </div>
          {comparison?.trapper && (
            <PhaseBar label="Trapper deployments fetched" done={comparison.trapper.done} total={comparison.trapper.total} finished={comparison.status === 'done'} />
          )}
          {comparison?.status === 'stopped' && <p className={hintClass}>Stopped.</p>}
          {comparison?.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{comparison.error}</p>}
          {comparison?.report && report && <Report report={report} />}
        </div>
      </Step>

      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack} disabled={running}>Back</button>
        {running && <p className={hintClass}>Stop the validation to go back.</p>}
      </div>
    </div>
  )
}
