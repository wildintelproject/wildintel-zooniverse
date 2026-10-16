import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import BackButton from '../components/BackButton'
import Combobox from '../components/Combobox'
import FieldLabel from '../components/FieldLabel'
import { BigNumber, DetailsPanel, RunBanner, StatGrid } from '../components/RunPanels'
import TrapperSelectionForm from '../components/TrapperSelectionForm'
import UploadCriteriaForm from '../components/UploadCriteriaForm'
import Step from '../components/WizardStep'
import { formatAgo, formatDateTime, formatDuration } from '../lib/format'
import ZooniverseProjectPicker, { Divider } from '../components/ZooniverseProjectPicker'
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
  /** Epoch ms: when it started, its last event, when it ended and when each phase began. */
  startedAt: number
  lastEventAt: number
  endedAt?: number
  subjectsStartedAt?: number
  trapperStartedAt?: number
}

function reduceEvent(run: Run, event: ValidationEvent): Run {
  switch (event.type) {
    case 'subjects': return { ...run, subjects: { total: event.total, done: 0 }, subjectsStartedAt: Date.now() }
    case 'progress': return run.subjects ? { ...run, subjects: { ...run.subjects, done: event.done } } : run
    case 'trapper': return { ...run, trapper: { total: event.total, done: 0 }, trapperStartedAt: Date.now() }
    case 'deployment': return run.trapper ? { ...run, trapper: { ...run.trapper, done: run.trapper.done + 1 } } : run
    case 'report': {
      const { type: _type, ...report } = event
      return { ...run, report }
    }
    case 'done': return { ...run, status: 'done', endedAt: Date.now() }
    default: return run
  }
}

function reduce(run: Run, event: ValidationEvent): Run {
  return { ...reduceEvent(run, event), lastEventAt: Date.now() }
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

function problemsOf(report: ValidationReport): number {
  return report.duplicated.length + report.unmatched.length + report.metadata_issues.length + (report.missing ?? []).length + (report.extra ?? []).length
}

/** What the validation found: the figures, per deployment, and each kind of finding. */
function Report({ report }: { report: ValidationReport }) {
  const missing = report.missing ?? []
  const extra = report.extra ?? []
  return (
    <div className="mt-3">
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

// ── The run's views: under way, finished, failed ───────────────────────

type Kind = 'check' | 'compare'

const rowsOf = (run: Run, now: number): [string, string][] => {
  const rows: [string, string][] = [['Started', formatDateTime(run.startedAt, { seconds: true })]]
  if (run.subjects) rows.push(['Subjects listed', `${run.subjects.done.toLocaleString()} of ${run.subjects.total.toLocaleString()}`])
  if (run.trapper) rows.push(['Trapper deployments fetched', `${run.trapper.done} of ${run.trapper.total} deployments`])
  if (run.endedAt) rows.push([run.status === 'done' ? 'Finished' : 'Interrupted', formatDateTime(run.endedAt, { seconds: true })])
  else rows.push(['Last activity', formatAgo(new Date(run.lastEventAt).toISOString(), now) || 'just now'])
  return rows
}

/** Where the run is: what it is doing, and the figure that says how far. */
function progressOf(run: Run) {
  const pct = (done: number, total: number) => (total ? Math.min(100, Math.round((done / total) * 100)) : 100)
  if (run.trapper) {
    const { done, total } = run.trapper
    return {
      title: 'Fetching the Trapper deployments…', detail: `${done} of ${total} deployments`,
      big: { label: 'Deployments fetched', value: done, percent: pct(done, total), caption: `${pct(done, total)}% of ${total} deployments` },
      fraction: total ? done / total : null, since: run.trapperStartedAt ?? run.startedAt,
    }
  }
  if (run.subjects) {
    const { done, total } = run.subjects
    return {
      title: 'Listing the subjects…', detail: `${done.toLocaleString()} of ${total.toLocaleString()} subjects`,
      big: { label: 'Subjects listed', value: done, percent: pct(done, total), caption: `${pct(done, total)}% of ${total.toLocaleString()} subjects` },
      fraction: total ? done / total : null, since: run.subjectsStartedAt ?? run.startedAt,
    }
  }
  return { title: 'Starting…', detail: '', big: null, fraction: null, since: undefined }
}

function RunningView({ run, now, onStop }: { run: Run; now: number; onStop: () => void }) {
  const p = progressOf(run)
  const remaining = p.since && p.fraction && p.fraction > 0.02 && p.fraction < 1 ? ((now - p.since) * (1 - p.fraction)) / p.fraction : null
  return (
    <div>
      <RunBanner tone="blue" title={p.title} detail={p.detail}>
        <button type="button" className={btnOutline} onClick={onStop}>Cancel</button>
      </RunBanner>
      {p.big && <BigNumber {...p.big} tone="blue" />}
      <StatGrid items={[
        { value: remaining !== null ? `~${formatDuration(remaining)}` : '—', label: 'Time left' },
        { value: formatDuration(now - run.startedAt), label: 'Elapsed' },
        { value: formatAgo(new Date(run.lastEventAt).toISOString(), now) || 'just now', label: 'Last activity' },
      ]} />
      <DetailsPanel rows={rowsOf(run, now)} defaultOpen />
    </div>
  )
}

function FinishedView({ run, kind, now }: { run: Run; kind: Kind; now: number }) {
  const report = run.report
  const problems = report ? problemsOf(report) : 0
  return (
    <div>
      <RunBanner
        tone={problems ? 'amber' : 'emerald'} title={kind === 'compare' ? 'Comparison completed' : 'Check completed'}
        detail={report ? (problems
          ? `${report.subject_set.name}: ${problems.toLocaleString()} finding(s).`
          : `${report.subject_set.name}: no problems found.`) : undefined}
      >
        {report && (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button" className={btnOutline} onClick={() => downloadUploadedIds(report)} disabled={report.uploaded.length === 0}
              title="One Trapper media id per line — e.g. to load as an upload's list of images never to upload again"
            >
              Download uploaded media ids (TXT)
            </button>
            <button type="button" className={btnOutline} onClick={() => downloadReport(report)}>Download report (JSON)</button>
          </div>
        )}
      </RunBanner>
      {report && <Report report={report} />}
      <DetailsPanel rows={rowsOf(run, now)} />
    </div>
  )
}

function FailedView({ run, now, onRetry, disabled }: { run: Run; now: number; onRetry: () => void; disabled: boolean }) {
  const cancelled = run.status === 'stopped'
  const rows = rowsOf(run, now)
  if (run.error) rows.unshift(['Cause', run.error])
  const p = progressOf(run)
  return (
    <div>
      <RunBanner tone="red" title={cancelled ? 'The validation was cancelled' : 'The validation was interrupted'} detail={run.error ?? 'It was stopped before it finished.'}>
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Nothing was changed: a validation only reads. There is no report to download — it only exists once it completes.</p>
        </div>
        <div className="p-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">What Retry does</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Runs it again from the start, with the same choices.</p>
        </div>
      </div>
      <DetailsPanel rows={rows} defaultOpen />
    </div>
  )
}

const ICON = 'w-5 h-5'
const ShieldIcon = () => (
  <svg aria-hidden="true" className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
  </svg>
)
const CompareIcon = () => (
  <svg aria-hidden="true" className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
  </svg>
)

/** One of the two things that can be run: what it does, and the button that runs it. */
function CheckCard({ icon, title, description, action, children }: {
  icon: ReactNode; title: string; description: string; action: ReactNode; children?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-start gap-4">
        <span className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>
        </div>
        <div className="flex-shrink-0">{action}</div>
      </div>
      {children}
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

/** Validation & audit of a subject set — wildintel-tools' check-* commands:
 * the subject set on its own (duplicated media, subjects with no Trapper
 * media id, and their metadata), and/or compared with a Trapper collection
 * (chosen as for an upload): which images are missing or extra, and every
 * metadata field. Either can be run, or both. */
export default function ValidationPage({ onBack }: Props) {
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [subjectSetId, setSubjectSetId] = useState('')
  const [selection, setSelection] = useState<TrapperSelection | null>(null)
  const [criteria, setCriteria] = useState<UploadCriteria | null>(null)
  const [initialCriteria, setInitialCriteria] = useState<UploadCriteria | null>(null)
  // The subject set on its own; and compared with Trapper. `last` is the one the results show.
  const [run, setRun] = useState<Run | null>(null)
  const [comparison, setComparison] = useState<Run | null>(null)
  const [last, setLast] = useState<Kind | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The step that's open, and the furthest one unlocked.
  const [open, setOpen] = useState(1)
  const [reached, setReached] = useState(1)
  // A clock for the running validation's timings.
  const [now, setNow] = useState(() => Date.now())

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
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const subjectSets = pick?.subjectSets.items ?? []
  const chosen = subjectSets.find((s) => String(s.id) === subjectSetId)
  const validated = run?.status === 'done' && run.report !== undefined
  const shown = last === 'compare' ? comparison : last === 'check' ? run : null
  const canCompare = Boolean(selection && criteria) && !running
  const unlocked = (n: number) => n === 1 || (n === 2 ? Boolean(chosen) : Boolean(shown))
  const status = (n: number): 'open' | 'done' | 'locked' | 'running' | 'error' => {
    if (n === 3 && n === open && shown) return shown.status === 'running' ? 'running' : shown.status === 'done' ? 'done' : 'error'
    return n === open ? 'open' : n <= reached && unlocked(n) ? 'done' : 'locked'
  }
  function next(n: number) {
    setOpen(n)
    setReached((r) => Math.max(r, n))
  }

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function execute(kind: Kind) {
    if (!chosen || !pick) return
    const trapper = kind === 'compare' && selection && criteria ? { selection, criteria } : null
    if (kind === 'compare' && !trapper) return
    const set = kind === 'compare' ? setComparison : setRun
    stop()
    if (kind === 'check') setComparison(null)
    setLast(kind)
    next(3)
    const controller = new AbortController()
    abortRef.current = controller
    const started = Date.now()
    set(() => ({ status: 'running', startedAt: started, lastEventAt: started }))
    try {
      await api.validateSubjectSet(pick.creds, chosen.id, trapper, (event) => set((r) => (r && reduce(r, event))), controller.signal)
    } catch (e) {
      if (controller.signal.aborted) {
        set((r) => (r && r.status === 'running' ? { ...r, status: 'stopped', endedAt: Date.now() } : r))
      } else {
        set((r) => ({ ...(r ?? { startedAt: started, lastEventAt: started }), status: 'error', error: e instanceof Error ? e.message : 'The validation failed.', endedAt: Date.now() }))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Validation &amp; audit</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Check a subject set: duplicated images, subjects that can&rsquo;t be traced back to Trapper, and their metadata.
        Then compare it with a Trapper collection to find which images are missing or shouldn&rsquo;t be there.
      </p>

      <Step
        n={1} title="Subject set" status={status(1)} canEdit={!running} onEdit={() => setOpen(1)}
        description="Subject set to check."
        summary={chosen && <>{pick?.projectName}<br />{chosen.display_name} · {chosen.subjects_count.toLocaleString()} subjects</>}
      >
        <ZooniverseProjectPicker disabled={running} useSavedConnection framed onChange={handlePick}>
          <div className="mb-6">
            <FieldLabel htmlFor="validate-subject-set" done={Boolean(chosen)}>Subject set</FieldLabel>
            <Combobox
              id="validate-subject-set" disabled={running}
              options={subjectSets.map((s) => ({ value: String(s.id), label: `${s.display_name} — ${s.subjects_count.toLocaleString()} subjects (#${s.id})` }))}
              value={subjectSetId} onChange={(value) => { setSubjectSetId(value); setRun(null); setComparison(null); setLast(null) }}
              placeholder="Select a subject set…" clearLabel="Clear subject set"
            />
          </div>
        </ZooniverseProjectPicker>
        <div className="flex items-center justify-between gap-3 mt-4">
          <BackButton onClick={onBack} />
          <button type="button" className={btnPrimary} disabled={!chosen} onClick={() => next(2)}>Continue to the checks</button>
        </div>
      </Step>

      <Step
        n={2} title="What do you want to check?" status={status(2)} canEdit={!running} onEdit={() => setOpen(2)}
        description="Run either one, or both. Checking the set first gives cleaner comparison results."
        summary={<>
          {validated ? 'Subject set checked' : 'Subject set not checked'}
          {comparison?.status === 'done' && selection && <> · compared with {selection.collection.name}</>}
        </>}
      >
        <div className="space-y-4">
          <CheckCard
            icon={<ShieldIcon />} title="Check the subject set"
            description="Looks for duplicated images, subjects with no Trapper media id, and problems in their metadata. Doesn’t need Trapper."
            action={<button type="button" className={btnPrimary} disabled={!chosen || running} onClick={() => execute('check')}>{run ? 'Run check again' : 'Run check'}</button>}
          />
          <CheckCard
            icon={<CompareIcon />} title="Compare with Trapper"
            description="Finds images that are missing or extra compared with a Trapper collection, and checks every metadata field against what an upload would write."
            action={<button type="button" className={btnPrimary} disabled={!chosen || !canCompare} onClick={() => execute('compare')}>{comparison ? 'Run comparison again' : 'Run comparison'}</button>}
          >
            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <TrapperSelectionForm onSelectionChange={handleSelectionChange} useSavedConnection />
              {selection && initialCriteria && (
                <>
                  <Divider />
                  <h5 className="text-sm font-semibold mb-3 text-zinc-700 dark:text-zinc-300">Upload criteria</h5>
                  <UploadCriteriaForm selection={selection} initial={initialCriteria} onCriteriaChange={handleCriteriaChange} />
                </>
              )}
              <p className="inline-block mt-4 px-3 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-300">
                {validated
                  ? 'Subject set checked — the comparison reuses what was found.'
                  : 'Subject set not checked yet — checking it first gives cleaner results.'}
              </p>
            </div>
          </CheckCard>
        </div>
        <div className="mt-4"><BackButton onClick={() => setOpen(1)} disabled={running} /></div>
      </Step>

      <Step
        n={3} title="Validation results" status={status(3)} canEdit={!running} onEdit={() => setOpen(2)}
        description="Progress and findings of the check."
        summary={shown?.report && <>{problemsOf(shown.report).toLocaleString()} finding(s)</>}
        badge={shown?.status === 'stopped' ? 'Cancelled' : undefined}
        expanded={shown?.status === 'done' && open === 3}
      >
        {shown?.status === 'running' && <RunningView run={shown} now={now} onStop={stop} />}
        {shown?.status === 'done' && last && <FinishedView run={shown} kind={last} now={now} />}
        {shown && (shown.status === 'error' || shown.status === 'stopped') && last && (
          <FailedView run={shown} now={now} onRetry={() => execute(last)} disabled={running || (last === 'compare' && !canCompare)} />
        )}
        <div className="mt-4"><BackButton onClick={() => setOpen(2)} disabled={running} /></div>
      </Step>
    </div>
  )
}
