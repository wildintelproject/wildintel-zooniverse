import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import IdListsEditor, { NO_LISTS } from '../components/IdListsEditor'
import type { IdLists } from '../components/IdListsEditor'
import ProgressBar from '../components/ProgressBar'
import ZooniverseProjectPicker, { Divider, SmallSpinner, StepHeading } from '../components/ZooniverseProjectPicker'
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

function reduce(run: Run, event: DownloadEvent): Run {
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
      return { ...run, status: 'done', outputDir: event.output_dir, sets: run.sets.map(finishing) }
    default:
      return run
  }
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

  useEffect(() => {
    api.zooniverseDownloadDefaults().then((d) => setOutputDir((dir) => dir || d.output_dir)).catch(() => {})
    return () => abortRef.current?.abort()
  }, [])

  const handlePick = useCallback((next: ZooniversePick) => setPick(next), [])
  // A new connection or project starts the choice over.
  useEffect(() => setChosen(new Set()), [pick?.projectId, pick?.creds])
  const subjectSets = pick?.subjectSets ?? { items: [], loading: false, error: null }

  const running = run?.status === 'running'

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

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function handleDownload() {
    stop()
    const controller = new AbortController()
    abortRef.current = controller
    const initial: Run = {
      status: 'running', failures: [],
      sets: chosenSets.map((s) => ({
        id: s.id, name: s.display_name, total: s.subjects_count, status: 'waiting',
        downloaded: 0, existing: 0, failed: 0, filtered_out: 0, inFlight: [],
      })),
    }
    setRun(initial)
    const end = (r: Run, status: 'stopped' | 'error', error?: string): Run => (
      { ...r, status, error, sets: r.sets.map((s) => ({ ...s, inFlight: [] })) }
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

  const totals = run && run.sets.reduce(
    (t, s) => ({
      downloaded: t.downloaded + s.downloaded, existing: t.existing + s.existing, failed: t.failed + s.failed,
      filtered_out: t.filtered_out + s.filtered_out, total: t.total + s.total,
    }),
    { downloaded: 0, existing: 0, failed: 0, filtered_out: 0, total: 0 },
  )
  const done = totals ? totals.downloaded + totals.existing + totals.failed + totals.filtered_out : 0
  const percent = run?.status === 'done' ? 100 : totals && totals.total > 0 ? Math.min(100, Math.round((done / totals.total) * 100)) : 0

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Download subject sets</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Download the images of one or more Zooniverse subject sets to this computer — each subject set into a folder of its own.
      </p>

      <ZooniverseProjectPicker title="Subject sets" disabled={running} onChange={handlePick}>
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

      {/* ── 3. Folder & download ── */}
      {chosen.size > 0 && (
        <>
          <Divider />
          <StepHeading n={3}>Download</StepHeading>
          <div className="mb-3">
            <label className={labelClass} htmlFor="download-folder">Folder</label>
            <input
              id="download-folder" className={inputClass} disabled={running}
              value={outputDir} onChange={(e) => setOutputDir(e.target.value)}
            />
            <p className={hintClass}>On this computer. Each subject set goes into a folder of its own inside it.</p>
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer mb-5">
            <input type="checkbox" className="mt-1" checked={overwrite} disabled={running} onChange={(e) => setOverwrite(e.target.checked)} />
            <span>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Download again images already there</span>
              <span className={`block ${hintClass}`}>Otherwise they&rsquo;re skipped — running it again only downloads what&rsquo;s missing.</span>
            </span>
          </label>

          <IdListsEditor
            kind="subject" initial={NO_LISTS} onCommit={setSubjectLists} disabled={running} className="mb-5"
            intro={<>
              Only some subjects, or never some — wildintel-tools&rsquo; <span className="font-mono">--white-list</span> /{' '}
              <span className="font-mono">--exclude-subjects</span>. Load a list of subject ids, or a CSV with a{' '}
              <span className="font-mono">subject_id</span> column.
            </>}
          />
          <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                {run && totals
                  ? <><strong>{done.toLocaleString()}</strong> of {totals.total.toLocaleString()} images</>
                  : <>{chosenImages.toLocaleString()} images in {chosen.size} subject set(s).</>}
              </span>
              {running
                ? <button type="button" className={btnOutline} onClick={stop}><SmallSpinner />Stop</button>
                : (
                  <button type="button" className={btnPrimary} disabled={!outputDir.trim()} onClick={handleDownload}>
                    {run ? 'Download again' : 'Download'}
                  </button>
                )}
            </div>

            {run && (
              <div className="mt-3">
                <div className="flex justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  <span>Total</span>
                  <span>{percent}%</span>
                </div>
                <ProgressBar percent={percent} label="Total" tone={run.status === 'done' ? (run.failures.length > 0 ? 'amber' : 'emerald') : 'blue'} />
                <ul className="mt-3 max-h-80 overflow-auto divide-y divide-zinc-200 dark:divide-zinc-700 pr-1">
                  {run.sets.map((s) => <SetRow key={s.id} s={s} />)}
                </ul>
              </div>
            )}

            {run?.status === 'done' && totals && (
              <p className={`text-sm mt-2 ${totals.failed > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                Download finished: {totals.downloaded.toLocaleString()} images downloaded
                {totals.existing > 0 && <>, {totals.existing.toLocaleString()} already there</>}
                {totals.filtered_out > 0 && <>, {totals.filtered_out.toLocaleString()} left out by the subject lists</>}
                {totals.failed > 0 && <>, {totals.failed.toLocaleString()} failed — download again to retry them</>}.
                <span className="block font-mono text-xs text-zinc-500 dark:text-zinc-400 mt-1 break-all">{run.outputDir}</span>
              </p>
            )}
            {run?.status === 'stopped' && <p className={hintClass}>Stopped — the images above are kept; downloading again skips them.</p>}
            {run?.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{run.error}</p>}

            {run && run.failures.length > 0 && (
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
          </div>
        </>
      )}

      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack} disabled={running}>Back</button>
        {running && <p className={hintClass}>Stop the download to go back.</p>}
      </div>
    </div>
  )
}
