import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ZooniverseProjectPicker, { Divider, SmallSpinner, StepHeading } from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import { parseIds } from '../lib/mediaIds'
import type { ZooniverseSubjectInfo } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

/** Subjects looked up at once — as the backend allows. */
const MAX_LOOKUP = 5000

function value(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function isUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//.test(v)
}

/** One subject: its image, the Trapper image it is, its subject sets, and
 * all of its metadata. */
function SubjectCard({ subject }: { subject: ZooniverseSubjectInfo }) {
  const trapperLink = subject.metadata.link ?? subject.metadata.preview
  return (
    <li className="flex gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700" aria-label={`Subject ${subject.id}`}>
      {subject.images[0]
        ? (
          <a href={subject.images[0]} target="_blank" rel="noreferrer" className="shrink-0">
            <img src={subject.images[0]} alt={`Subject ${subject.id}`} loading="lazy" className="w-32 h-24 object-cover rounded bg-zinc-100 dark:bg-zinc-800" />
          </a>
        )
        : <div className="w-32 h-24 shrink-0 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs text-zinc-400">No image</div>}
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-baseline gap-3 flex-wrap">
          <strong className="font-mono">#{subject.id}</strong>
          <span className="text-xs text-zinc-600 dark:text-zinc-300">
            Trapper media: {subject.media_id !== null
              ? (isUrl(trapperLink)
                ? <a href={trapperLink} target="_blank" rel="noreferrer" className="font-mono text-blue-600 dark:text-blue-400 underline">{subject.media_id}</a>
                : <span className="font-mono">{subject.media_id}</span>)
              : <span className="text-amber-700 dark:text-amber-400">unknown</span>}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Subject set{subject.subject_sets.length === 1 ? '' : 's'}: <span className="font-mono">{subject.subject_sets.map((id) => `#${id}`).join(', ') || '—'}</span>
          </span>
          {subject.created_at && <span className="text-xs text-zinc-500 dark:text-zinc-400">{new Date(subject.created_at).toLocaleString()}</span>}
        </div>
        <details className="mt-1.5">
          <summary className="text-xs cursor-pointer text-zinc-600 dark:text-zinc-300">
            Metadata ({Object.keys(subject.metadata).length} fields)
          </summary>
          <table className="mt-1 text-xs w-full">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {Object.entries(subject.metadata).map(([k, v]) => (
                <tr key={k}>
                  <td className="py-0.5 pr-3 font-mono text-zinc-500 dark:text-zinc-400 align-top whitespace-nowrap">{k}</td>
                  <td className="py-0.5 font-mono break-all">
                    {isUrl(v) ? <a href={v} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">{v}</a> : value(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </li>
  )
}

function SubjectList({ subjects, label }: { subjects: ZooniverseSubjectInfo[]; label: string }) {
  return <ul className="mt-3 space-y-2" aria-label={label}>{subjects.map((s) => <SubjectCard key={s.id} subject={s} />)}</ul>
}

type Load<T> = { status: 'idle' | 'loading' | 'done' | 'error'; data?: T; error?: string }

interface Props {
  onBack: () => void
}

/** wildintel-tools' subjects command: Zooniverse subjects looked up by id —
 * pasted, or loaded from a file — or a subject set's, browsed a page at a
 * time; each with its image, the Trapper image it is, its subject sets and
 * its metadata. */
export default function SubjectsPage({ onBack }: Props) {
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [idsText, setIdsText] = useState('')
  const [lookup, setLookup] = useState<Load<{ subjects: ZooniverseSubjectInfo[]; not_found: number[] }>>({ status: 'idle' })
  const [subjectSetId, setSubjectSetId] = useState('')
  const [page, setPage] = useState(1)
  const [browse, setBrowse] = useState<Load<{ subjects: ZooniverseSubjectInfo[]; page: number; page_count: number; count: number }>>({ status: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePick = useCallback((next: ZooniversePick) => setPick(next), [])
  useEffect(() => { setSubjectSetId(''); setBrowse({ status: 'idle' }) }, [pick?.projectId, pick?.creds])

  const { ids, ignored } = parseIds(idsText, 'subject')

  async function handleLookup() {
    if (!pick || ids.length === 0) return
    setLookup({ status: 'loading' })
    try {
      setLookup({ status: 'done', data: await api.zooniverseLookupSubjects(pick.creds, ids.slice(0, MAX_LOOKUP)) })
    } catch (e) {
      setLookup({ status: 'error', error: e instanceof Error ? e.message : 'Could not look them up.' })
    }
  }

  async function loadPage(setId: string, number: number) {
    if (!pick || !setId) return
    setPage(number)
    setBrowse((b) => ({ ...b, status: 'loading' }))
    try {
      setBrowse({ status: 'done', data: await api.zooniverseSubjectSetPage(pick.creds, Number(setId), number) })
    } catch (e) {
      setBrowse({ status: 'error', error: e instanceof Error ? e.message : 'Could not load them.' })
    }
  }

  const subjectSets = pick?.subjectSets.items ?? []
  const browsed = browse.data

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Subjects</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        See Zooniverse subjects — looked up by id, or a subject set&rsquo;s, a page at a time: their image, the Trapper image
        each is, their subject sets and their metadata.
      </p>

      <ZooniverseProjectPicker title="Browse a subject set" onChange={handlePick}>
        <div className="mb-4">
          <label className={labelClass} htmlFor="subjects-subject-set">Subject set</label>
          <select
            id="subjects-subject-set" className={inputClass} value={subjectSetId}
            onChange={(e) => { setSubjectSetId(e.target.value); loadPage(e.target.value, 1) }}
          >
            <option value="">Select a subject set…</option>
            {subjectSets.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.display_name} — {s.subjects_count.toLocaleString()} subjects (#{s.id})</option>
            ))}
          </select>
        </div>
        {browse.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{browse.error}</p>}
        {subjectSetId && browsed && (
          <div className="mb-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                Page <strong>{browsed.page}</strong> of {browsed.page_count.toLocaleString()} · {browsed.count.toLocaleString()} subjects
              </span>
              <div className="flex gap-2">
                <button type="button" className={btnOutline} disabled={page <= 1 || browse.status === 'loading'} onClick={() => loadPage(subjectSetId, page - 1)}>
                  ← Previous
                </button>
                <button type="button" className={btnOutline} disabled={page >= browsed.page_count || browse.status === 'loading'} onClick={() => loadPage(subjectSetId, page + 1)}>
                  Next →
                </button>
              </div>
            </div>
            {browse.status === 'loading' && <p className={hintClass}>Loading…</p>}
            <SubjectList subjects={browsed.subjects} label="Subject set's subjects" />
          </div>
        )}
        {subjectSetId && !browsed && browse.status === 'loading' && <p className={hintClass}>Loading…</p>}
      </ZooniverseProjectPicker>

      {pick?.connected && (
        <>
          <Divider />
          <StepHeading n={3}>Look up subjects by id</StepHeading>
          <label className={labelClass} htmlFor="subjects-ids">Subject ids</label>
          <textarea
            id="subjects-ids" className={`${inputClass} h-20 text-xs`} value={idsText} onChange={(e) => setIdsText(e.target.value)}
            placeholder="One per line, or separated by commas or spaces"
          />
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <input
              ref={fileRef} type="file" accept=".txt,.csv,.tsv,.json,text/plain,text/csv,application/json" className="hidden"
              aria-label="Subject ids file"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) setIdsText(parseIds(await file.text(), 'subject').ids.join('\n'))
              }}
            />
            <button type="button" className={btnOutline} onClick={() => fileRef.current?.click()}>Load file…</button>
            <button type="button" className={btnPrimary} disabled={ids.length === 0 || lookup.status === 'loading'} onClick={handleLookup}>
              {lookup.status === 'loading' && <SmallSpinner />}
              Look up
            </button>
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              <strong>{ids.length.toLocaleString()}</strong> id{ids.length === 1 ? '' : 's'}
              {ignored > 0 && <span className="text-amber-700 dark:text-amber-400"> · {ignored} not an id, ignored</span>}
              {ids.length > MAX_LOOKUP && <span className="text-amber-700 dark:text-amber-400"> · only the first {MAX_LOOKUP.toLocaleString()} are looked up</span>}
            </span>
          </div>
          <p className={hintClass}>A list of ids, a CSV with a <span className="font-mono">subject_id</span> column, or a report of this app&rsquo;s.</p>
          {lookup.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{lookup.error}</p>}
          {lookup.status === 'done' && lookup.data && (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-3">
                {lookup.data.subjects.length.toLocaleString()} found
                {lookup.data.not_found.length > 0 && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {' '}· not found (or not visible to you): <span className="font-mono">{lookup.data.not_found.slice(0, 20).join(', ')}{lookup.data.not_found.length > 20 ? '…' : ''}</span>
                  </span>
                )}
              </p>
              <SubjectList subjects={lookup.data.subjects} label="Subjects found" />
            </>
          )}
        </>
      )}

      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack}>Back</button>
      </div>
    </div>
  )
}
