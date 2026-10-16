import { useEffect, useState } from 'react'
import { api } from '../api'
import { formatDateTime, formatDuration } from '../lib/format'
import type { Report, ReportKind, ReportSummary } from '../types'

const btnOutline = 'px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 no-underline'

/** Rows of a report's entries shown — the downloads have all of them. */
const SHOWN_ENTRIES = 200

const KIND_LABELS: Record<ReportKind, string> = {
  update_metadata: 'Update metadata', validation: 'Validation', download_subject_sets: 'Download', export_classifications: 'Export',
}

const STATUS: Record<ReportSummary['status'], { label: string; tone: string }> = {
  done: { label: 'Completed', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' },
  stopped: { label: 'Stopped', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  error: { label: 'Error', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
}

const label = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  return typeof value === 'number' ? value.toLocaleString() : String(value)
}

/** One report, in full: what was asked, the counts, where the files went and the rows it kept. */
function ReportDetail({ id }: { id: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getReport(id).then(setReport).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the report.'))
  }, [id])

  if (error) return <p className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>
  if (!report) return <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3">Reading the report…</p>

  const columns = report.entries.reduce<string[]>((cols, e) => [...cols, ...Object.keys(e).filter((k) => !cols.includes(k))], [])
  const shown = report.entries.slice(0, SHOWN_ENTRIES)
  return (
    <div className="mt-4 space-y-4">
      {report.error && <p className="text-sm text-red-600 dark:text-red-400">{report.error}</p>}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
        {Object.entries(report.parameters).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-zinc-500 dark:text-zinc-400">{label(key)}</dt>
            <dd className="text-zinc-800 dark:text-zinc-200 break-all">{cell(value)}</dd>
          </div>
        ))}
        {Object.entries(report.outputs).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-zinc-500 dark:text-zinc-400">{label(key)}</dt>
            <dd className="font-mono text-zinc-800 dark:text-zinc-200 break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {Object.keys(report.totals).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(report.totals).map(([key, value]) => (
            <div key={key} className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value.toLocaleString()}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{label(key)}</div>
            </div>
          ))}
        </div>
      )}
      {shown.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            {report.entries_total > shown.length
              ? `The first ${shown.length.toLocaleString()} of ${report.entries_total.toLocaleString()} rows — the downloads keep ${report.entries.length.toLocaleString()}`
              : `${shown.length.toLocaleString()} row(s)`}
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-xs">
              <thead className="text-zinc-500 dark:text-zinc-400 text-left sticky top-0 bg-white dark:bg-zinc-900">
                <tr>{columns.map((c) => <th key={c} className="py-1.5 px-2 font-medium">{label(c)}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {shown.map((entry, i) => (
                  <tr key={i}>{columns.map((c) => <td key={c} className="py-1 px-2 font-mono align-top break-all">{cell(entry[c])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/** The reports the Utils tasks leave — update metadata, validation, download of subject sets, export of
 * classifications: to look at again, download or delete. */
export default function ReportsList() {
  const [reports, setReports] = useState<ReportSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [days, setDays] = useState('60')
  const [cleaned, setCleaned] = useState<string | null>(null)

  function load() {
    api.listReports().then(setReports).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the reports.'))
  }
  useEffect(load, [])

  async function handleDelete(id: string) {
    try {
      await api.deleteReport(id)
      setReports((list) => (list ?? []).filter((r) => r.id !== id))
      if (open === id) setOpen(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the report.')
    } finally {
      setConfirming(null)
    }
  }

  async function handleClean() {
    setError(null)
    try {
      const { deleted } = await api.deleteOldReports(Number(days))
      setCleaned(deleted === 0 ? 'No report was that old.' : `${deleted} report(s) deleted.`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the reports.')
    }
  }

  const daysValid = /^\d+$/.test(days)
  return (
    <div className="py-3">
      <p className="text-zinc-500 dark:text-zinc-400 mb-5 text-sm">
        Every update of metadata, validation, download of subject sets and export of classifications leaves a report of what was asked and what
        it found or did — also when it was stopped or failed. Look at one again, download it (a CSV opens in a spreadsheet; the JSON has everything),
        or delete the ones you no longer need.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {reports === null && !error && <p className="text-sm text-zinc-500 dark:text-zinc-400">Reading the reports…</p>}
      {reports?.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">There are no reports yet — they are made when you run one of those tasks.</p>}
      <ul className="space-y-3">
        {(reports ?? []).map((r) => (
          <li key={r.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4" aria-label={r.title}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <span className="mr-2 text-xs font-medium px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">{KIND_LABELS[r.kind]}</span>
                  {r.title}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
                  {formatDateTime(r.created_at)}
                  {r.finished_at && <> · {formatDuration(new Date(r.finished_at).getTime() - new Date(r.created_at).getTime())}</>}
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <button type="button" className={btnOutline} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'View'}</button>
                <a className={btnOutline} href={api.reportUrl(r.id, 'csv')} download>CSV</a>
                <a className={btnOutline} href={api.reportUrl(r.id, 'json')} download>JSON</a>
                {confirming === r.id
                  ? <button type="button" className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700" onClick={() => handleDelete(r.id)}>Delete it</button>
                  : <button type="button" className={btnOutline} onClick={() => setConfirming(r.id)}>Delete</button>}
              </div>
            </div>
            {open === r.id && <ReportDetail id={r.id} />}
          </li>
        ))}
      </ul>
      {(reports?.length ?? 0) > 0 && (
        <div className="flex items-center gap-3 flex-wrap mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-800 text-sm text-zinc-600 dark:text-zinc-300">
          <label htmlFor="reports-days">Delete the reports older than</label>
          <input
            id="reports-days" inputMode="numeric" value={days} onChange={(e) => { setDays(e.target.value); setCleaned(null) }}
            className="w-16 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-right"
          />
          <span>days</span>
          <button type="button" className={btnOutline} disabled={!daysValid} onClick={handleClean}>Delete</button>
          {cleaned && <span className="text-xs text-zinc-500 dark:text-zinc-400" role="status">{cleaned}</span>}
        </div>
      )}
    </div>
  )
}
