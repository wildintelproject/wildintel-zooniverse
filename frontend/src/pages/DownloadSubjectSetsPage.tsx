import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import BackButton from '../components/BackButton'
import ChoiceCard from '../components/ChoiceCard'
import IdListsEditor, { NO_LISTS } from '../components/IdListsEditor'
import type { IdLists } from '../components/IdListsEditor'
import ProgressBar from '../components/ProgressBar'
import { BigNumber, DetailsPanel, RunBanner, StatGrid } from '../components/RunPanels'
import Step from '../components/WizardStep'
import { formatAgo, formatDateTime, formatDuration } from '../lib/format'
import ZooniverseProjectPicker, { SmallSpinner } from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import type { DownloadEvent } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-6 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

// ── The download's progress ─────────────────────────────────────────────

interface SetProgress {
  id: number
  name: string
  /** Zooniverse's own subject count for it. */
  total: number
  status: 'waiting' | 'downloading' | 'done'
  downloaded: number
  existing: number
  failed: number
  /** Left out by the subject lists. */
  filtered_out: number
  inFlight: { subject_id: number; file_name: string }[]
  folder?: string
}

interface Failure {
  subject_set_id: number
  subject_id: number
  file_name: string
  detail?: string
}

interface Run {
  status: 'running' | 'done' | 'stopped' | 'error'
  error?: string
  sets: SetProgress[]
  failures: Failure[]
  outputDir?: string
  /** Epoch ms: when it started, its last event and when it ended. */
  startedAt: number
  lastEventAt: number
  endedAt?: number
}

function processed(s: SetProgress): number {
  return s.downloaded + s.existing + s.failed + s.filtered_out
}

function updateSet(run: Run, id: number, update: (s: SetProgress) => SetProgress): Run {
  return { ...run, sets: run.sets.map((s) => (s.id === id ? update(s) : s)) }
}

/** Done once every subject is — or when the next one starts, or the whole
 * download ends: the subject count may be out of date. */
function finishing(s: SetProgress): SetProgress {
  return s.status === 'downloading' ? { ...s, status: 'done', inFlight: [] } : s
}

function reduceEvent(run: Run, event: DownloadEvent): Run {
  switch (event.type) {
    case 'subject_set':
      return updateSet(
        { ...run, sets: run.sets.map(finishing) }, event.id,
        (s) => ({ ...s, status: 'downloading', name: event.name, total: event.total, folder: event.folder }),
      )
    case 'step':
      return updateSet(run, event.subject_set_id, (s) => ({
        ...s, inFlight: [...s.inFlight, { subject_id: event.subject_id, file_name: event.file_name }],
      }))
    case 'subject': {
      const next = updateSet(run, event.subject_set_id, (s) => {
        const updated = {
          ...s, [event.status]: s[event.status] + 1, inFlight: s.inFlight.filter((f) => f.subject_id !== event.subject_id),
        }
        return processed(updated) >= updated.total ? { ...updated, status: 'done' as const } : updated
      })
      return event.status === 'failed' ? { ...next, failures: [...next.failures, event] } : next
    }
    case 'done':
      return { ...run, status: 'done', outputDir: event.output_dir, sets: run.sets.map(finishing), endedAt: Date.now() }
    default:
      return run
  }
}

function reduce(run: Run, event: DownloadEvent): Run {
  return { ...reduceEvent(run, event), lastEventAt: Date.now() }
}

function SetRow({ s }: { s: SetProgress }) {
  const percent = s.status === 'done' ? 100 : s.total > 0 ? Math.min(100, Math.round((processed(s) / s.total) * 100)) : 0
  const status = {
    waiting: 'Waiting',
    downloading: `${processed(s).toLocaleString()} of ${s.total.toLocaleString()}`,
    done: `${s.downloaded.toLocaleString()} downloaded`,
  }[s.status]
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-3 text-xs mb-1">
        <span className="text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 min-w-0">
          {s.status === 'done' && <span className="text-emerald-600">✓</span>}
          <span className="truncate">{s.name}</span>
          <span className="font-mono text-zinc-400 dark:text-zinc-500">#{s.id}</span>
        </span>
        <span className={`shrink-0 ${s.status === 'waiting' ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-600 dark:text-zinc-300'}`}>
          {status}
          {s.existing > 0 && <span className="text-zinc-500 dark:text-zinc-400"> · {s.existing.toLocaleString()} already there</span>}
          {s.filtered_out > 0 && <span className="text-zinc-500 dark:text-zinc-400"> · {s.filtered_out.toLocaleString()} left out</span>}
          {s.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {s.failed.toLocaleString()} failed</span>}
        </span>
      </div>
      <ProgressBar percent={percent} label={s.name} tone={s.status === 'done' ? (s.failed > 0 ? 'amber' : 'emerald') : 'blue'} />
      {s.inFlight.length > 0 && (
        <ul className="mt-1.5 space-y-0.5" aria-label={`${s.name} in progress`}>
          {s.inFlight.map((f) => (
            <li key={f.subject_id} className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 min-w-0">
              <span className="text-sky-600 dark:text-sky-400" title="Downloading from Zooniverse">↓</span>
              <span className="truncate">{f.file_name}</span>
            </li>
          ))}
        </ul>
      )}
      {s.folder && s.status !== 'waiting' && <p className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500 mt-1 truncate">{s.folder}</p>}
    </li>
  )
}

// ── The run's views: under way, finished, failed ────────────────────────

interface Totals { downloaded: number; existing: number; failed: number; filtered_out: number; total: number }

function totalsOf(run: Run): Totals {
  return run.sets.reduce(
    (t, s) => ({
      downloaded: t.downloaded + s.downloaded, existing: t.existing + s.existing, failed: t.failed + s.failed,
      filtered_out: t.filtered_out + s.filtered_out, total: t.total + s.total,
    }),
    { downloaded: 0, existing: 0, failed: 0, filtered_out: 0, total: 0 },
  )
}

const handled = (t: Totals) => t.downloaded + t.existing + t.failed + t.filtered_out
const percentOf = (t: Totals) => (t.total > 0 ? Math.min(100, Math.round((handled(t) / t.total) * 100)) : 0)

function detailRows(run: Run, now: number): [string, string][] {
  const rows: [string, string][] = [['Started', formatDateTime(run.startedAt, { seconds: true })]]
  if (run.outputDir) rows.push(['Folder', run.outputDir])
  if (run.endedAt) rows.push([run.status === 'done' ? 'Finished' : 'Interrupted', formatDateTime(run.endedAt, { seconds: true })])
  else rows.push(['Last activity', formatAgo(new Date(run.lastEventAt).toISOString(), now) || 'just now'])
  return rows
}

/** Each subject set's own progress, and the images that failed. */
function SetsDetail({ run }: { run: Run }) {
  return (
    <>
      <ul className="mt-2 max-h-80 overflow-auto divide-y divide-zinc-200 dark:divide-zinc-700 pr-1">
        {run.sets.map((s) => <SetRow key={s.id} s={s} />)}
      </ul>
      {run.failures.length > 0 && (
        <div className="mt-3 max-h-60 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-zinc-500 dark:text-zinc-400 text-left">
              <tr>
                <th className="py-1 pr-2 font-medium">Subject</th>
                <th className="py-1 px-2 font-medium">File</th>
                <th className="py-1 pl-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {run.failures.map((f) => (
                <tr key={f.subject_id}>
                  <td className="py-1 pr-2 font-mono">{f.subject_id}</td>
                  <td className="py-1 px-2 font-mono break-all">{f.file_name}</td>
                  <td className="py-1 pl-2 text-red-600 dark:text-red-400">{f.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function RunningView({ run, now, onStop }: { run: Run; now: number; onStop: () => void }) {
  const t = totalsOf(run)
  const percent = percentOf(t)
  const current = run.sets.find((s) => s.status === 'downloading')
  const elapsed = (now - run.startedAt) / 1000
  const rate = elapsed > 0 ? handled(t) / elapsed : null
  const remaining = percent > 2 && percent < 100 ? ((now - run.startedAt) * (100 - percent)) / percent : null
  return (
    <div>
      <RunBanner
        tone="blue" title="Downloading the images…"
        detail={current ? `${current.name} · ${processed(current).toLocaleString()} of ${current.total.toLocaleString()}` : 'Starting…'}
      >
        <button type="button" className={btnOutline} onClick={onStop}>Cancel</button>
      </RunBanner>
      <BigNumber
        label="Images processed" value={handled(t)} percent={percent} tone="blue"
        caption={`${percent}% of ${t.total.toLocaleString()} images`}
      />
      <StatGrid items={[
        { value: rate !== null && rate > 0 ? `${rate.toFixed(rate < 10 ? 1 : 0)} images/s` : '—', label: 'Speed' },
        { value: remaining !== null ? `~${formatDuration(remaining)}` : '—', label: 'Time left' },
        { value: formatDuration(now - run.startedAt), label: 'Elapsed' },
      ]} />
      <DetailsPanel rows={detailRows(run, now)} defaultOpen><SetsDetail run={run} /></DetailsPanel>
    </div>
  )
}

function FinishedView({ run, now }: { run: Run; now: number }) {
  const t = totalsOf(run)
  const percent = t.total > 0 ? Math.min(100, Math.round((t.downloaded / t.total) * 100)) : 0
  return (
    <div>
      <RunBanner
        tone={t.failed ? 'amber' : 'emerald'} title="Download completed"
        detail={<>
          {t.downloaded.toLocaleString()} images downloaded
          {t.existing > 0 && <>, {t.existing.toLocaleString()} already there</>}
          {t.filtered_out > 0 && <>, {t.filtered_out.toLocaleString()} left out by the subject lists</>}
          {t.failed > 0 && <>, {t.failed.toLocaleString()} failed — download again to retry them</>}.
        </>}
      />
      <BigNumber
        label="Images downloaded" value={t.downloaded} percent={percent} tone={t.failed ? 'amber' : 'emerald'}
        caption={`${percent}% of ${t.total.toLocaleString()} images`}
      />
      <StatGrid items={[
        { value: t.existing.toLocaleString(), label: 'Already there', hint: 'Skipped: they were in the folder already.' },
        { value: t.filtered_out.toLocaleString(), label: 'Left out', hint: 'Left out by the subject lists.' },
        { value: t.failed.toLocaleString(), label: 'Failed', hint: 'Couldn’t be downloaded.' },
      ]} />
      <DetailsPanel rows={detailRows(run, now)}><SetsDetail run={run} /></DetailsPanel>
    </div>
  )
}

function FailedView({ run, now, onRetry, disabled }: { run: Run; now: number; onRetry: () => void; disabled: boolean }) {
  const cancelled = run.status === 'stopped'
  const t = totalsOf(run)
  const rows = detailRows(run, now)
  if (run.error) rows.unshift(['Cause', run.error])
  return (
    <div>
      <RunBanner
        tone="red" title={cancelled ? 'The download was cancelled' : 'The download was interrupted'}
        detail={run.error ?? 'It was stopped before it finished.'}
      >
        <button
          type="button" disabled={disabled} onClick={onRetry}
          className="px-4 py-2 text-sm bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded hover:opacity-90 disabled:opacity-40"
        >
          Retry
        </button>
      </RunBanner>
      <BigNumber
        label="Images processed before the stop" value={handled(t)} percent={percentOf(t)} tone="red"
        caption={`${percentOf(t)}% of ${t.total.toLocaleString()} images`}
      />
      <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
        <div className="p-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">What is kept</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">The {t.downloaded.toLocaleString()} image(s) already downloaded stay in their folders.</p>
        </div>
        <div className="p-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">What Retry does</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Downloads again from the start — the images already there are skipped.</p>
        </div>
      </div>
      <DetailsPanel rows={rows} defaultOpen><SetsDetail run={run} /></DetailsPanel>
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

/** wildintel-tools' download_ss: downloads the images of one or more
 * subject sets to a folder of this computer, one folder per subject set.
 * Images already there are skipped (unless overwriting), so running it
 * again only downloads what's missing. */
export default function DownloadSubjectSetsPage({ onBack }: Props) {
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [outputDir, setOutputDir] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [subjectLists, setSubjectLists] = useState<IdLists>(NO_LISTS)
  const [run, setRun] = useState<Run | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The step that's open, and the furthest one unlocked.
  const [open, setOpen] = useState(1)
  const [reached, setReached] = useState(1)
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  // A clock for the running download's timings.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    api.zooniverseDownloadDefaults().then((d) => setOutputDir((dir) => dir || d.output_dir)).catch(() => {})
    return () => abortRef.current?.abort()
  }, [])

  const handlePick = useCallback((next: ZooniversePick) => setPick(next), [])
  // A new connection or project starts the choice over.
  useEffect(() => setChosen(new Set()), [pick?.projectId, pick?.creds])
  const subjectSets = pick?.subjectSets ?? { items: [], loading: false, error: null }

  const running = run?.status === 'running'
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const status = (n: number): 'open' | 'done' | 'locked' | 'running' | 'error' => {
    if (n === 3 && n === open && run) return run.status === 'running' ? 'running' : run.status === 'done' ? 'done' : 'error'
    return n === open ? 'open' : n <= reached && (n === 1 || chosen.size > 0) && (n < 3 || run) ? 'done' : 'locked'
  }
  function next(n: number) {
    setOpen(n)
    setReached((r) => Math.max(r, n))
  }

  function toggle(id: number) {
    setChosen((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allChosen = subjectSets.items.length > 0 && subjectSets.items.every((s) => chosen.has(s.id))
  const chosenSets = subjectSets.items.filter((s) => chosen.has(s.id))
  const chosenImages = chosenSets.reduce((sum, s) => sum + s.subjects_count, 0)

  async function handleBrowse() {
    setBrowsing(true)
    setBrowseError(null)
    try {
      const { path } = await api.browseFolder('Select the folder the images go to')
      if (path) setOutputDir(path)
    } catch (e) {
      setBrowseError(`${e instanceof Error ? e.message : 'Could not open the folder dialog.'} Type the path instead.`)
    } finally {
      setBrowsing(false)
    }
  }

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function handleDownload() {
    stop()
    next(3)
    const controller = new AbortController()
    abortRef.current = controller
    const started = Date.now()
    const initial: Run = {
      status: 'running', failures: [], startedAt: started, lastEventAt: started,
      sets: chosenSets.map((s) => ({
        id: s.id, name: s.display_name, total: s.subjects_count, status: 'waiting',
        downloaded: 0, existing: 0, failed: 0, filtered_out: 0, inFlight: [],
      })),
    }
    setRun(initial)
    const end = (r: Run, status: 'stopped' | 'error', error?: string): Run => (
      { ...r, status, error, endedAt: Date.now(), sets: r.sets.map((s) => ({ ...s, inFlight: [] })) }
    )
    try {
      await api.zooniverseDownloadSubjectSets(
        pick!.creds, chosenSets.map((s) => s.id), outputDir, overwrite,
        (event) => setRun((r) => (r && reduce(r, event))), controller.signal, subjectLists,
      )
    } catch (e) {
      if (controller.signal.aborted) {
        setRun((r) => (r && r.status === 'running' ? end(r, 'stopped') : r))
      } else {
        setRun((r) => end(r ?? initial, 'error', e instanceof Error ? e.message : 'The download failed.'))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Download subject sets</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Download the images of one or more Zooniverse subject sets to this computer — each subject set into a folder of its own.
      </p>

      <Step
        n={1} title="Subject sets" status={status(1)} canEdit={!running} onEdit={() => setOpen(1)}
        description="The Zooniverse project and the subject sets to download."
        summary={<>{pick?.projectName}<br />{chosen.size} subject set(s) · {chosenImages.toLocaleString()} images</>}
      >
        <ZooniverseProjectPicker disabled={running} useSavedConnection framed onChange={handlePick}>
        <div className="mb-6 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <label className="flex items-center gap-2.5 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox" checked={allChosen} disabled={running}
              onChange={() => setChosen(allChosen ? new Set() : new Set(subjectSets.items.map((s) => s.id)))}
            />
            All subject sets
            <span className="ml-auto font-normal text-xs text-zinc-500 dark:text-zinc-400">
              {chosen.size} chosen · {chosenImages.toLocaleString()} images
            </span>
          </label>
          <ul className="max-h-64 overflow-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {subjectSets.items.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <input type="checkbox" checked={chosen.has(s.id)} disabled={running} onChange={() => toggle(s.id)} />
                  <span className="truncate text-zinc-800 dark:text-zinc-200">{s.display_name}</span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {s.subjects_count.toLocaleString()} <span className="font-mono">#{s.id}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        </ZooniverseProjectPicker>
        <div className="flex items-center justify-between gap-3 mt-4">
          <BackButton onClick={onBack} />
          <button type="button" className={btnPrimary} disabled={chosen.size === 0} onClick={() => next(2)}>Continue to download</button>
        </div>
      </Step>

      <Step
        n={2} title="Folder and filters" status={status(2)} canEdit={!running} onEdit={() => setOpen(2)}
        description="Where the images go, and which subjects to download."
        summary={<span className="font-mono break-all">{outputDir}</span>}
      >
        <div className="mb-3">
          <label className={labelClass} htmlFor="download-folder">Folder</label>
          <div className="flex gap-2">
            <input
              id="download-folder" className={inputClass} disabled={running}
              value={outputDir} onChange={(e) => setOutputDir(e.target.value)}
            />
            <button type="button" className={`${btnOutline} shrink-0`} disabled={running || browsing} onClick={handleBrowse}>
              {browsing && <SmallSpinner />}{browsing ? 'Browsing…' : 'Browse…'}
            </button>
          </div>
          {browseError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{browseError}</p>}
          <p className={hintClass}>On this computer. Each subject set goes into a folder of its own inside it.</p>
        </div>
        <div className="mb-6">
          <ChoiceCard
            type="checkbox" name="Download again images already there" selected={overwrite} disabled={running}
            onSelect={() => setOverwrite((v) => !v)}
          >
            <p className={hintClass}>Otherwise they&rsquo;re skipped — running it again only downloads what&rsquo;s missing.</p>
          </ChoiceCard>
        </div>

        <h5 className="text-sm font-semibold mb-1">Which subjects?</h5>
        <p className={`${hintClass} mb-3`}>Optional. Without a list, every subject of the chosen subject sets is downloaded.</p>
        <IdListsEditor
          kind="subject" initial={NO_LISTS} onCommit={setSubjectLists} disabled={running} className="mb-5" layout="choices" intro={null}
        />
        <div className="flex items-center justify-between gap-3">
          <BackButton onClick={() => setOpen(1)} disabled={running} />
          <button type="button" className={btnPrimary} disabled={!outputDir.trim() || chosen.size === 0} onClick={handleDownload}>
            {run ? 'Download again' : 'Download'}
          </button>
        </div>
      </Step>

      <Step
        n={3} title="Download results" status={status(3)} canEdit={!running} onEdit={() => setOpen(2)}
        description="Progress of each subject set."
        summary={run && <>{totalsOf(run).downloaded.toLocaleString()} images downloaded</>}
        badge={run?.status === 'stopped' ? 'Cancelled' : undefined}
        expanded={run?.status === 'done' && open === 3}
      >
        {run?.status === 'running' && <RunningView run={run} now={now} onStop={stop} />}
        {run?.status === 'done' && <FinishedView run={run} now={now} />}
        {run && (run.status === 'error' || run.status === 'stopped') && <FailedView run={run} now={now} onRetry={handleDownload} disabled={chosen.size === 0 || !outputDir.trim()} />}
        <div className="mt-4"><BackButton onClick={() => setOpen(2)} disabled={running} /></div>
      </Step>
    </div>
  )
}
