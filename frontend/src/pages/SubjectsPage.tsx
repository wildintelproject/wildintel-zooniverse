import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import BackButton from '../components/BackButton'
import Combobox from '../components/Combobox'
import FieldLabel from '../components/FieldLabel'
import Step from '../components/WizardStep'
import ZooniverseProjectPicker, { SmallSpinner } from '../components/ZooniverseProjectPicker'
import type { ZooniversePick } from '../components/ZooniverseProjectPicker'
import { parseIds } from '../lib/mediaIds'
import type { ZooniverseSubjectInfo } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'
const btnPrimary = 'px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

/** Ids looked up at once — as the backend allows. */
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
          <dl className="mt-1 text-xs grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            {Object.entries(subject.metadata).map(([k, v]) => (
              <Fragment key={k}>
                <dt className="font-mono text-zinc-500 dark:text-zinc-400">{k}</dt>
                <dd className="font-mono break-all">
                  {isUrl(v) ? <a href={v} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">{v}</a> : value(v)}
                </dd>
              </Fragment>
            ))}
          </dl>
        </details>
      </div>
    </li>
  )
}

function SubjectList({ subjects, label }: { subjects: ZooniverseSubjectInfo[]; label: string }) {
  return <ul className="mt-3 space-y-2" aria-label={label}>{subjects.map((s) => <SubjectCard key={s.id} subject={s} />)}</ul>
}

type Load<T> = { status: 'idle' | 'loading' | 'done' | 'error'; data?: T; error?: string }

/** Subjects shown per page of a filtered list (a subject set's own pages come as Zooniverse gives them). */
const FILTER_PAGE = 20

interface Filtered {
  /** The ids asked for. */
  ids: number[]
  /** Those found in the subject set. */
  inSet: ZooniverseSubjectInfo[]
  /** Found, but in other subject sets. */
  elsewhere: number[]
  /** Not found, or not visible to the user. */
  notFound: number[]
}

interface Props {
  onBack: () => void
}

/** wildintel-tools' subjects command, in two steps: the project and its
 * subject set, then the subject set's contents — a page of subjects at a
 * time, each with its image, the Trapper image it is, its subject sets and
 * its metadata — which can be filtered by a subject id or a list of them. */
export default function SubjectsPage({ onBack }: Props) {
  const [pick, setPick] = useState<ZooniversePick | null>(null)
  const [subjectSetId, setSubjectSetId] = useState('')
  const [page, setPage] = useState(1)
  const [browse, setBrowse] = useState<Load<{ subjects: ZooniverseSubjectInfo[]; page: number; page_count: number; count: number }>>({ status: 'idle' })
  const [filterText, setFilterText] = useState('')
  const [filter, setFilter] = useState<Load<Filtered>>({ status: 'idle' })
  const [filterPage, setFilterPage] = useState(1)
  // The step that's open, and the furthest one unlocked.
  const [open, setOpen] = useState(1)
  const [reached, setReached] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePick = useCallback((next: ZooniversePick) => setPick(next), [])
  useEffect(() => {
    setSubjectSetId('')
    setBrowse({ status: 'idle' })
    clearFilter()
    setOpen(1)
    setReached(1)
  }, [pick?.projectId, pick?.creds])

  const { ids, ignored } = parseIds(filterText, 'subject')
  const subjectSets = pick?.subjectSets.items ?? []
  const chosen = subjectSets.find((s) => String(s.id) === subjectSetId)
  const browsed = browse.data
  const filtered = filter.status === 'done' ? filter.data : undefined
  const status = (n: number): 'open' | 'done' | 'locked' => (n === open ? 'open' : n <= reached && (n === 1 || chosen) ? 'done' : 'locked')

  function next(n: number) {
    setOpen(n)
    setReached((r) => Math.max(r, n))
  }

  function clearFilter() {
    setFilterText('')
    setFilter({ status: 'idle' })
    setFilterPage(1)
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

  function handleContinue() {
    next(2)
    if (!browsed) loadPage(subjectSetId, 1)
  }

  async function applyFilter() {
    if (!pick || !chosen || ids.length === 0) return
    const asked = ids.slice(0, MAX_LOOKUP)
    setFilter({ status: 'loading' })
    setFilterPage(1)
    try {
      const { subjects, not_found } = await api.zooniverseLookupSubjects(pick.creds, asked)
      setFilter({
        status: 'done',
        data: {
          ids: asked,
          inSet: subjects.filter((s) => s.subject_sets.includes(chosen.id)),
          elsewhere: subjects.filter((s) => !s.subject_sets.includes(chosen.id)).map((s) => s.id),
          notFound: not_found,
        },
      })
    } catch (e) {
      setFilter({ status: 'error', error: e instanceof Error ? e.message : 'Could not look them up.' })
    }
  }

  const filterPages = filtered ? Math.max(1, Math.ceil(filtered.inSet.length / FILTER_PAGE)) : 1
  const shownFiltered = filtered ? filtered.inSet.slice((filterPage - 1) * FILTER_PAGE, filterPage * FILTER_PAGE) : []
  const loadingPage = browse.status === 'loading'

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Subjects</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        See the subjects of a Zooniverse subject set, a page at a time: their image, the Trapper image each is, their subject sets and
        their metadata. Filter them by id to find the ones you need.
      </p>

      <Step
        n={1} title="Subject set" status={status(1)} canEdit onEdit={() => setOpen(1)}
        description="The project and the subject set whose subjects you want to see."
        summary={chosen && <>{pick?.projectName}<br />{chosen.display_name} · {chosen.subjects_count.toLocaleString()} subjects</>}
      >
        <ZooniverseProjectPicker useSavedConnection framed onChange={handlePick}>
          <div className="mb-4">
            <FieldLabel htmlFor="subjects-subject-set" done={Boolean(subjectSetId)}>Subject set</FieldLabel>
            <Combobox
              id="subjects-subject-set"
              options={subjectSets.map((s) => ({ value: String(s.id), label: `${s.display_name} — ${s.subjects_count.toLocaleString()} subjects (#${s.id})` }))}
              value={subjectSetId}
              onChange={(value) => { setSubjectSetId(value); setBrowse({ status: 'idle' }); clearFilter() }}
              placeholder="Select a subject set…" clearLabel="Clear subject set"
            />
          </div>
        </ZooniverseProjectPicker>
        <div className="flex items-center justify-between gap-3 mt-4">
          <BackButton onClick={onBack} />
          <button type="button" className={btnPrimary} disabled={!subjectSetId} onClick={handleContinue}>Continue to the subjects</button>
        </div>
      </Step>

      <Step
        n={2} title="Browse the subjects" status={status(2)} canEdit onEdit={() => setOpen(2)}
        description="The subject set's contents, a page at a time — all of them, or only the ids you filter by."
        summary={filtered
          ? <>{filtered.inSet.length.toLocaleString()} of {filtered.ids.length.toLocaleString()} ids found in the subject set</>
          : browsed && <>Page {browsed.page} of {browsed.page_count.toLocaleString()} · {browsed.count.toLocaleString()} subjects</>}
      >
        <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <label className={labelClass} htmlFor="subjects-ids">Filter by id</label>
          <textarea
            id="subjects-ids" className={`${inputClass} h-20 text-xs`} value={filterText} onChange={(e) => setFilterText(e.target.value)}
            placeholder="One subject id, or several — one per line, or separated by commas or spaces"
          />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <input
              ref={fileRef} type="file" accept=".txt,.csv,.tsv,.json,text/plain,text/csv,application/json" className="hidden"
              aria-label="Subject ids file"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) setFilterText(parseIds(await file.text(), 'subject').ids.join('\n'))
              }}
            />
            <button type="button" className={btnOutline} onClick={() => fileRef.current?.click()}>Load from file…</button>
            <button type="button" className={btnOutline} disabled={!filterText && filter.status === 'idle'} onClick={clearFilter}>Clear</button>
            <button type="button" className={btnPrimary} disabled={ids.length === 0 || filter.status === 'loading'} onClick={applyFilter}>
              {filter.status === 'loading' && <SmallSpinner />}
              Apply filter
            </button>
            <span className="ml-auto text-xs text-zinc-600 dark:text-zinc-300">
              <strong>{ids.length.toLocaleString()}</strong> id{ids.length === 1 ? '' : 's'}
              {ignored > 0 && <span className="text-amber-700 dark:text-amber-400"> · {ignored} not an id, ignored</span>}
              {ids.length > MAX_LOOKUP && <span className="text-amber-700 dark:text-amber-400"> · only the first {MAX_LOOKUP.toLocaleString()} are used</span>}
            </span>
          </div>
          <p className={hintClass}>A list of ids, a CSV with a <span className="font-mono">subject_id</span> column, or a report of this app&rsquo;s.</p>
        </div>

        {filter.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400 mt-3">{filter.error}</p>}

        {filtered ? (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                <strong>{filtered.inSet.length.toLocaleString()}</strong> of {filtered.ids.length.toLocaleString()} found in this subject set
                {filtered.inSet.length > FILTER_PAGE && <> · page <strong>{filterPage}</strong> of {filterPages}</>}
              </span>
              {filtered.inSet.length > FILTER_PAGE && (
                <div className="flex gap-2">
                  <button type="button" className={btnOutline} disabled={filterPage <= 1} onClick={() => setFilterPage((n) => n - 1)}>← Previous</button>
                  <button type="button" className={btnOutline} disabled={filterPage >= filterPages} onClick={() => setFilterPage((n) => n + 1)}>Next →</button>
                </div>
              )}
            </div>
            {filtered.elsewhere.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                In other subject sets, not this one: <span className="font-mono">{filtered.elsewhere.slice(0, 20).join(', ')}{filtered.elsewhere.length > 20 ? '…' : ''}</span>
              </p>
            )}
            {filtered.notFound.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Not found (or not visible to you): <span className="font-mono">{filtered.notFound.slice(0, 20).join(', ')}{filtered.notFound.length > 20 ? '…' : ''}</span>
              </p>
            )}
            <SubjectList subjects={shownFiltered} label="Subjects found" />
          </div>
        ) : (
          <div className="mt-4">
            {browse.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{browse.error}</p>}
            {browsed && (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm text-zinc-600 dark:text-zinc-300">
                    Page <strong>{browsed.page}</strong> of {browsed.page_count.toLocaleString()} · {browsed.count.toLocaleString()} subjects
                  </span>
                  <div className="flex gap-2">
                    <button type="button" className={btnOutline} disabled={page <= 1 || loadingPage} onClick={() => loadPage(subjectSetId, page - 1)}>← Previous</button>
                    <button type="button" className={btnOutline} disabled={page >= browsed.page_count || loadingPage} onClick={() => loadPage(subjectSetId, page + 1)}>Next →</button>
                  </div>
                </div>
                {loadingPage && <p className={hintClass}>Loading…</p>}
                <SubjectList subjects={browsed.subjects} label="Subject set's subjects" />
              </>
            )}
            {!browsed && loadingPage && <p className={hintClass}>Loading…</p>}
          </div>
        )}

        <div className="mt-4"><BackButton onClick={() => setOpen(1)} /></div>
      </Step>
    </div>
  )
}
