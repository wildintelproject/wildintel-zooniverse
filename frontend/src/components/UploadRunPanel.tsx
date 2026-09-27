import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { ImageResult, SessionSummary, UploadEvent } from '../types'
import ProgressBar from './ProgressBar'

const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'

function SmallSpinner() {
  return <div className="w-4 h-4 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
}

/** One deployment of the run: waiting its turn, being fetched from Trapper,
 * then its kept images uploaded, a few at a time. */
interface DeploymentProgress {
  deployment_id: string
  status: 'waiting' | 'fetching' | 'uploading' | 'done'
  /** How many of its images it uploads — known once fetched. */
  selected: number
  uploaded: number
  /** Already uploaded by an earlier run of the session. */
  skipped: number
  failed: number
  /** Its images being downloaded or uploaded right now, oldest first. */
  inFlight: InFlight[]
}

interface InFlight {
  media_id: number
  file_name: string
  step: 'download' | 'upload'
}

interface Run {
  dryRun: boolean
  /** Images the session's media lists left out. */
  filteredOut: number
  status: 'running' | 'done' | 'stopped' | 'error'
  error?: string
  subjectSet?: { name: string; id: number | null; exists: boolean }
  /** Listing the subject set's subjects, when asked to skip the images
   * already in it. */
  checking?: { done: number; total: number; media?: number }
  /** In the selection's own order — the one the backend follows. */
  deployments: DeploymentProgress[]
  failures: ImageResult[]
}

function newRun(session: SessionSummary, dryRun: boolean): Run {
  return {
    dryRun,
    filteredOut: 0,
    status: 'running',
    deployments: session.selection.deployments.map((d) => ({
      deployment_id: d.deployment_id, status: 'waiting', selected: 0, uploaded: 0, skipped: 0, failed: 0, inFlight: [],
    })),
    failures: [],
  }
}

/** A run that ended early has nothing in flight any more. */
function ended(run: Run, status: 'stopped' | 'error', error?: string): Run {
  return { ...run, status, error, deployments: run.deployments.map((d) => ({ ...d, inFlight: [] })) }
}

function processed(d: DeploymentProgress): number {
  return d.uploaded + d.skipped + d.failed
}

function updateDeployment(run: Run, id: string, update: (d: DeploymentProgress) => DeploymentProgress): Run {
  return { ...run, deployments: run.deployments.map((d) => (d.deployment_id === id ? update(d) : d)) }
}

function finished(d: DeploymentProgress): DeploymentProgress {
  return processed(d) >= d.selected ? { ...d, status: 'done' } : d
}

function reduce(run: Run, event: UploadEvent): Run {
  switch (event.type) {
    case 'start': return { ...run, subjectSet: event.subject_set }
    case 'checking': return { ...run, checking: { done: event.done, total: event.total } }
    case 'checked': return { ...run, checking: { done: event.subjects, total: event.subjects, media: event.media } }
    case 'fetching': return updateDeployment(run, event.deployment_id, (d) => ({ ...d, status: 'fetching' }))
    case 'deployment':
      return updateDeployment(
        { ...run, filteredOut: run.filteredOut + (event.filtered_out ?? 0) }, event.deployment_id,
        (d) => finished({ ...d, status: 'uploading', selected: event.selected }),
      )
    case 'step':
      return updateDeployment(run, event.deployment_id, (d) => {
        const current = { media_id: event.media_id, file_name: event.file_name, step: event.step }
        const known = d.inFlight.some((f) => f.media_id === event.media_id)
        return {
          ...d,
          inFlight: known ? d.inFlight.map((f) => (f.media_id === event.media_id ? current : f)) : [...d.inFlight, current],
        }
      })
    case 'image': {
      const next = updateDeployment(run, event.deployment_id, (d) => finished({
        ...d, [event.status]: d[event.status] + 1, inFlight: d.inFlight.filter((f) => f.media_id !== event.media_id),
      }))
      return event.status === 'failed' ? { ...next, failures: [...next.failures, event] } : next
    }
    case 'done': return { ...run, status: 'done' }
    default: return run
  }
}

/** A deployment's share of the work done, from 0 to 1. */
function fraction(d: DeploymentProgress): number {
  if (d.status === 'done') return 1
  return d.status === 'uploading' && d.selected > 0 ? processed(d) / d.selected : 0
}

function DeploymentRow({ d, verb }: { d: DeploymentProgress; verb: string }) {
  const status = {
    waiting: 'Waiting',
    fetching: 'Fetching images from Trapper…',
    uploading: `${processed(d).toLocaleString()} of ${d.selected.toLocaleString()} ${verb}`,
    done: d.selected === 0 ? 'Nothing to upload' : `${d.uploaded.toLocaleString()} ${verb}`,
  }[d.status]
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-3 text-xs mb-1">
        <span className="font-mono text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          {d.status === 'fetching' && <SmallSpinner />}
          {d.status === 'done' && <span className="text-emerald-600">✓</span>}
          {d.deployment_id}
        </span>
        <span className={d.status === 'waiting' ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-600 dark:text-zinc-300'}>
          {status}
          {d.skipped > 0 && <span className="text-zinc-500 dark:text-zinc-400"> · {d.skipped.toLocaleString()} already uploaded</span>}
          {d.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {d.failed.toLocaleString()} failed</span>}
        </span>
      </div>
      <ProgressBar
        percent={Math.round(fraction(d) * 100)} label={d.deployment_id}
        tone={d.status === 'done' ? (d.failed > 0 ? 'amber' : 'emerald') : 'blue'}
      />
      {d.inFlight.length > 0 && (
        <ul className="mt-1.5 space-y-0.5" aria-label={`${d.deployment_id} in progress`}>
          {d.inFlight.map((f) => (
            <li key={f.media_id} className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 min-w-0">
              <span
                className={f.step === 'download' ? 'text-sky-600 dark:text-sky-400' : 'text-violet-600 dark:text-violet-400'}
                title={f.step === 'download' ? 'Downloading from Trapper' : 'Uploading to Zooniverse'}
              >
                {f.step === 'download' ? '↓' : '↑'}
              </span>
              <span className="truncate">{f.file_name}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function subjectSetText(run: Run): string {
  const { id, exists } = run.subjectSet!
  if (run.dryRun) return exists ? `exists (#${id}) — the images would be added to it.` : 'doesn’t exist yet — the upload would create it.'
  return exists ? `adding the images to it (#${id}).` : `created (#${id}).`
}

interface Props {
  session: SessionSummary
}

/** Runs the session's upload — or a dry run of it — deployment by
 * deployment, with a progress bar for each and one for the whole run. A dry
 * run fetches and chooses the images from Trapper exactly as the upload
 * does, and looks the subject set up, but only simulates the downloads and
 * uploads. */
export default function UploadRunPanel({ session }: Props) {
  const [run, setRun] = useState<Run | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Off by default: listing a big subject set takes minutes.
  const [skipInSubjectSet, setSkipInSubjectSet] = useState(false)
  // Aborts the running request — on Stop or leaving the step. For a real
  // upload, that stops it.
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function start(dryRun: boolean) {
    stop()
    setConfirming(false)
    const controller = new AbortController()
    abortRef.current = controller
    setRun(newRun(session, dryRun))
    const call = dryRun ? api.uploadDryRun : api.uploadStart
    try {
      await call(session.task_id, (event) => setRun((r) => (r && reduce(r, event))), controller.signal, { skipInSubjectSet })
    } catch (e) {
      if (controller.signal.aborted) {
        setRun((r) => (r && r.status === 'running' ? ended(r, 'stopped') : r))
      } else {
        const message = e instanceof Error ? e.message : dryRun ? 'The dry run failed.' : 'The upload failed.'
        setRun((r) => ended(r ?? newRun(session, dryRun), 'error', message))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const running = run?.status === 'running'
  const verb = run?.dryRun === false ? 'uploaded' : 'simulated'
  const lastDryRun = session.last_dry_run
  const lastUpload = session.phase === 'uploading' ? session.upload : undefined
  const totals = run && run.deployments.reduce(
    (t, d) => ({
      uploaded: t.uploaded + d.uploaded, skipped: t.skipped + d.skipped, failed: t.failed + d.failed,
      selected: t.selected + d.selected, fetched: t.fetched + (d.status === 'uploading' || d.status === 'done' ? 1 : 0),
    }),
    { uploaded: 0, skipped: 0, failed: 0, selected: 0, fetched: 0 },
  )
  // Each deployment weighs the same: its image count is only known once
  // it's fetched, and a bar counting images would jump back each time one is.
  const percent = run && run.deployments.length
    ? Math.round((run.deployments.reduce((sum, d) => sum + fraction(d), 0) / run.deployments.length) * 100)
    : 0
  const allFetched = run !== null && totals !== null && totals.fetched === run.deployments.length

  return (
    <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-zinc-600 dark:text-zinc-300">
          {run && totals
            ? <>
              {run.dryRun && <span className="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 mr-2 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">Dry run</span>}
              <strong>{(totals.uploaded + totals.skipped + totals.failed).toLocaleString()}</strong> of {totals.selected.toLocaleString()}
              {' '}images {verb}{allFetched ? '' : ' so far'}
              <span className="text-zinc-500 dark:text-zinc-400"> · {totals.fetched} of {run.deployments.length} deployments fetched</span>
            </>
            : 'Try a dry run first: it chooses the images exactly as the upload will, without sending anything.'}
        </span>
        {running
          ? <button type="button" className={btnOutline} onClick={stop}><SmallSpinner />Stop</button>
          : (
            <div className="flex gap-2">
              <button type="button" className={btnOutline} onClick={() => start(true)}>
                {run?.dryRun ? 'Dry run again' : 'Dry run'}
              </button>
              <button type="button" className={btnPrimary} disabled={confirming} onClick={() => setConfirming(true)}>
                {lastUpload || run?.dryRun === false ? 'Upload again' : 'Upload to Zooniverse'}
              </button>
            </div>
          )}
      </div>

      {!running && (
        <label className="flex items-start gap-2.5 cursor-pointer mt-3">
          <input
            type="checkbox" className="mt-1" checked={skipInSubjectSet}
            onChange={(e) => setSkipInSubjectSet(e.target.checked)}
          />
          <span>
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Skip images already in the subject set</span>
            <span className={`block ${hintClass}`}>
              Without it, only this session&rsquo;s own uploads are skipped.{' '}
              <strong className="text-amber-700 dark:text-amber-400">
                Slow: every subject of the subject set is listed from Zooniverse first, 100 at a time — minutes for one
                with tens of thousands.
              </strong>
            </span>
          </span>
        </label>
      )}

      {confirming && (
        <div className="mt-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-sm text-zinc-700 dark:text-zinc-300">
          <p>
            Upload the images to <strong>{session.destination?.project.name}</strong>, subject set{' '}
            <span className="font-mono">{session.destination?.subject_set_name}</span>? This creates the subjects in
            Zooniverse — this app can&rsquo;t remove them afterwards. Images this session already uploaded are skipped
            {skipInSubjectSet ? ', and so are those already in the subject set' : ''}.
          </p>
          <p className={hintClass}>Keep this page open while it runs: closing it or pressing Stop stops the upload.</p>
          <div className="flex gap-2 mt-3">
            <button type="button" className={btnPrimary} onClick={() => start(false)}>Yes, upload</button>
            <button type="button" className={btnOutline} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!run && lastUpload && (
        <p className="text-sm text-amber-700 dark:text-amber-400 mt-2">
          An earlier upload didn&rsquo;t finish
          {lastUpload.finished_at
            ? <> ({(lastUpload.uploaded ?? 0).toLocaleString()} uploaded, {(lastUpload.failed ?? 0).toLocaleString()} failed)</>
            : ' (it was stopped)'}
          . Upload again to continue — images already uploaded are skipped.
        </p>
      )}
      {!run && !lastUpload && lastDryRun && (
        <p className={hintClass}>
          Last dry run ({new Date(lastDryRun.finished_at).toLocaleString()}): {lastDryRun.uploaded.toLocaleString()} images would be
          uploaded, {lastDryRun.failed.toLocaleString()} failed.
        </p>
      )}

      {run && (
        <div className="mt-3">
          <div className="flex justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
            <span>Total</span>
            <span>{percent}%</span>
          </div>
          <ProgressBar
            percent={percent} label="Total"
            tone={run.status === 'done' ? (run.failures.length > 0 ? 'amber' : 'emerald') : 'blue'}
          />
        </div>
      )}
      {running && (
        <p className={hintClass}>
          Each deployment&rsquo;s images are fetched from Trapper, then {run.dryRun
            ? 'each download and upload is simulated — nothing is written to disk or to Zooniverse'
            : 'downloaded and uploaded, a few at a time'}, before the next deployment is fetched.
          {!run.dryRun && ' Stopping keeps what’s already uploaded; uploading again skips it.'}
        </p>
      )}
      {run?.subjectSet && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-3">
          Subject set <span className="font-mono">{run.subjectSet.name}</span>: {subjectSetText(run)}
        </p>
      )}
      {run?.checking && (
        <div className="mt-3">
          <div className="flex justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-300 mb-1">
            <span className="flex items-center gap-1.5">
              {run.checking.media === undefined ? <SmallSpinner /> : <span className="text-emerald-600">✓</span>}
              {run.checking.media === undefined
                ? 'Listing the subject set’s subjects, to skip the images already in it…'
                : `${run.checking.media.toLocaleString()} Trapper images already in the subject set — skipped`}
            </span>
            <span>{run.checking.done.toLocaleString()} of {run.checking.total.toLocaleString()} subjects</span>
          </div>
          <ProgressBar
            percent={run.checking.total ? Math.min(100, Math.round((run.checking.done / run.checking.total) * 100)) : 100}
            label="Subjects listed" tone={run.checking.media === undefined ? 'blue' : 'emerald'}
          />
        </div>
      )}

      {run && (
        <ul className="mt-3 max-h-80 overflow-auto divide-y divide-zinc-200 dark:divide-zinc-700 pr-1">
          {run.deployments.map((d) => <DeploymentRow key={d.deployment_id} d={d} verb={verb} />)}
        </ul>
      )}

      {run?.status === 'done' && totals && (
        <p className={`text-sm mt-2 ${totals.failed > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {run.dryRun
            ? <>Dry run finished: {totals.uploaded.toLocaleString()} images would be uploaded</>
            : <>Upload finished: {totals.uploaded.toLocaleString()} images uploaded</>}
          {totals.skipped > 0 && <>, {totals.skipped.toLocaleString()} already uploaded</>}
          {totals.failed > 0 && <>, {totals.failed.toLocaleString()} failed</>}
          {run.filteredOut > 0 && <>, {run.filteredOut.toLocaleString()} left out by the media lists</>}.
          {!run.dryRun && totals.failed > 0 && ' Upload again to retry the failed ones.'}
        </p>
      )}
      {run?.status === 'stopped' && (
        <p className={hintClass}>
          {run.dryRun ? 'Stopped — only the images above were simulated.' : 'Stopped — the images above stay uploaded; uploading again skips them.'}
        </p>
      )}
      {run?.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{run.error}</p>}

      {run && run.failures.length > 0 && (
        <div className="mt-3 max-h-60 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-zinc-500 dark:text-zinc-400 text-left">
              <tr>
                <th className="py-1 pr-2 font-medium">Media</th>
                <th className="py-1 px-2 font-medium">Deployment</th>
                <th className="py-1 px-2 font-medium">Step</th>
                <th className="py-1 pl-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {run.failures.map((f) => (
                <tr key={f.media_id}>
                  <td className="py-1 pr-2 font-mono">{f.media_id}</td>
                  <td className="py-1 px-2 font-mono">{f.deployment_id}</td>
                  <td className="py-1 px-2">{f.step}</td>
                  <td className="py-1 pl-2 text-red-600 dark:text-red-400">{f.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
