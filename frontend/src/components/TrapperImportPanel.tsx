import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ProgressBar from './ProgressBar'
import type { TrapperImportEvent } from '../types'

const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

function SmallSpinner() {
  return <div className="w-4 h-4 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

interface FileState {
  path: string
  status: 'waiting' | 'importing' | 'imported' | 'failed'
  message?: string | null
  taskId?: string | null
  detail?: string
}

interface Run {
  status: 'running' | 'done' | 'stopped' | 'error'
  error?: string
  files: FileState[]
}

function reduce(run: Run, event: TrapperImportEvent): Run {
  const update = (path: string, patch: Partial<FileState>) =>
    ({ ...run, files: run.files.map((f) => (f.path === path ? { ...f, ...patch } : f)) })
  switch (event.type) {
    case 'file': return update(event.path, { status: 'importing' })
    case 'imported': return update(event.path, { status: 'imported', message: event.message, taskId: event.task_id })
    case 'failed': return update(event.path, { status: 'failed', detail: event.detail })
    case 'done': return { ...run, status: 'done' }
    default: return run
  }
}

interface Props {
  files: string[]
  trapperUrl: string
  project: { pk: number; name: string }
  /** Trapper's own import page — to do it by hand, if the import fails. */
  manualUrl: string
  /** Start right away (the export's "Import into Trapper when finished"). */
  autoStart?: boolean
}

/** Imports an export's observation CSVs into Trapper — wildintel-tools'
 * export --upload, through Trapper's API: only expert classifications,
 * updating each row's observation; approved only if asked. */
export default function TrapperImportPanel({ files, trapperUrl, project, manualUrl, autoStart = false }: Props) {
  const [approve, setApprove] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function start() {
    setConfirming(false)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRun({ status: 'running', files: files.map((path) => ({ path, status: 'waiting' })) })
    try {
      await api.importToTrapper(
        trapperUrl, project.pk, files, approve, (event) => setRun((r) => (r && reduce(r, event))), controller.signal,
      )
    } catch (e) {
      if (controller.signal.aborted) {
        setRun((r) => (r && r.status === 'running' ? { ...r, status: 'stopped' } : r))
      } else {
        setRun((r) => ({ files: r?.files ?? [], status: 'error', error: e instanceof Error ? e.message : 'The import failed.' }))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  useEffect(() => () => abortRef.current?.abort(), [])

  // Started from a timer the cleanup cancels: React's development mode
  // mounts effects twice, and an import started by the first mount would be
  // aborted by its cleanup.
  useEffect(() => {
    if (!autoStart) return
    const timer = setTimeout(start, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once, when first shown
  }, [])

  const running = run?.status === 'running'
  const done = run ? run.files.filter((f) => f.status === 'imported' || f.status === 'failed').length : 0
  const failed = run ? run.files.filter((f) => f.status === 'failed').length : 0
  const background = run?.files.some((f) => f.taskId)

  return (
    <div className="mt-4 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-sm text-zinc-700 dark:text-zinc-300">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-semibold">Import into Trapper</p>
        {running
          ? <button type="button" className={btnOutline} onClick={() => abortRef.current?.abort()}><SmallSpinner />Stop</button>
          : (
            <button type="button" className={btnPrimary} disabled={confirming} onClick={() => setConfirming(true)}>
              {run ? 'Import again' : 'Import into Trapper'}
            </button>
          )}
      </div>
      <p className={hintClass}>
        {files.length > 1 ? `The ${files.length} files` : 'The file'} into classification project <strong>{project.name}</strong>, as
        expert classifications — each row updating its observation.
      </p>

      {!running && (
        <label className="flex items-start gap-2.5 cursor-pointer mt-2">
          <input type="checkbox" className="mt-1" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
          <span>
            <span className="text-sm font-semibold">Approve the imported classifications</span>
            <span className={`block ${hintClass}`}>Off: they&rsquo;re imported for review, as wildintel-tools did.</span>
          </span>
        </label>
      )}

      {confirming && (
        <div className="mt-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
          <p>
            Import {files.length > 1 ? `the ${files.length} files` : 'the file'} into Trapper classification project{' '}
            <strong>{project.name}</strong>{approve ? ', approved' : ''}? It updates its observations — this app
            can&rsquo;t undo it.
          </p>
          <div className="flex gap-2 mt-3">
            <button type="button" className={btnPrimary} onClick={start}>Yes, import</button>
            <button type="button" className={btnOutline} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      {run && (
        <div className="mt-3">
          <ProgressBar
            percent={run.status === 'done' ? 100 : Math.round((done / Math.max(1, run.files.length)) * 100)}
            label="Files imported"
            tone={run.status === 'done' ? (failed ? 'amber' : 'emerald') : 'blue'}
          />
          <ul className="mt-2 space-y-1" aria-label="Files">
            {run.files.map((f) => (
              <li key={f.path} className="text-xs">
                <span className="font-mono">
                  {{ waiting: '·', importing: '↑', imported: '✓', failed: '✗' }[f.status]} {baseName(f.path)}
                </span>
                {f.status === 'importing' && <span className="text-zinc-500 dark:text-zinc-400"> — uploading…</span>}
                {f.status === 'imported' && (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {' '}— {f.message || 'imported'}{f.taskId ? ` (task ${f.taskId})` : ''}
                  </span>
                )}
                {f.status === 'failed' && <span className="text-red-600 dark:text-red-400"> — {f.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run?.status === 'done' && (
        <p className={`text-sm mt-2 ${failed ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {failed
            ? `${run.files.length - failed} of ${run.files.length} files imported — import again to retry the rest.`
            : 'Imported into Trapper.'}
          {background && ' Trapper imports them in the background: they can take a while to show.'}
        </p>
      )}
      {run?.status === 'stopped' && <p className={hintClass}>Stopped — the files already imported stay imported.</p>}
      {run?.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{run.error}</p>}
      {(run?.status === 'error' || failed > 0) && (
        <p className={hintClass}>
          To import by hand instead: open{' '}
          <a href={manualUrl} target="_blank" rel="noreferrer" className="font-mono text-blue-600 dark:text-blue-400 underline break-all">{manualUrl}</a>
          {' '}and upload each file, checking only <em>Import expert classifications</em>.
        </p>
      )}
    </div>
  )
}
