import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { ZooniverseCredentials } from '../api'
import Combobox from './Combobox'
import type { TrapperSelection, ZooniverseDestination, ZooniverseProject, ZooniverseSubjectSet } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'

function Heading({ children }: { children: ReactNode }) {
  return <h4 className="text-base font-semibold mb-4 text-zinc-700 dark:text-zinc-300">{children}</h4>
}

// The saved account: the requests leave the credentials blank, and the
// backend falls back to the settings'.
const BLANK: ZooniverseCredentials = { username: '', password: '' }

/** wildintel-tools' own subject set name for a collection:
 * {research project}_{its pk}_{collection}_{its pk}_{YYYY-MM}. */
export function defaultSubjectSetName(selection: TrapperSelection, now = new Date()): string {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const { research_project: rp, collection } = selection
  return `${rp.name}_${rp.pk}_${collection.name}_${collection.pk}_${month}`
}

type LoadStatus = 'loading' | 'ok' | 'error'

interface Props {
  selection: TrapperSelection
  /** A destination saved earlier — its project is chosen again once
   * connected, and its subject set name kept. */
  initial?: ZooniverseDestination
  /** The destination once a project is chosen and the name isn't blank,
   * null otherwise. */
  onDestinationChange: (destination: ZooniverseDestination | null) => void
}

/** Picks where the images go, with the Zooniverse account saved in the
 * settings: one of the user's projects, and a subject set in it — by name, as wildintel-tools does: an
 * existing one with that name gets the new subjects, otherwise it's created. */
export default function ZooniverseDestinationForm({ selection, initial, onDestinationChange }: Props) {
  const [conn, setConn] = useState<{ status: LoadStatus; message: string }>({ status: 'loading', message: '' })
  const [projects, setProjects] = useState<ZooniverseProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [subjectSets, setSubjectSets] = useState<{ items: ZooniverseSubjectSet[]; loading: boolean; error: string | null }>(
    { items: [], loading: false, error: null },
  )
  const [name, setName] = useState(initial?.subject_set_name ?? defaultSubjectSetName(selection))
  // A new subject set, by name — or one of the project's own, searched.
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [search, setSearch] = useState('')
  const [existingId, setExistingId] = useState<number | null>(null)

  async function loadSubjectSets(id: string) {
    setSubjectSets({ items: [], loading: Boolean(id), error: null })
    if (!id) return
    try {
      const { results } = await api.zooniverseSubjectSets(BLANK, Number(id))
      setSubjectSets({ items: results, loading: false, error: null })
    } catch (e) {
      setSubjectSets({ items: [], loading: false, error: e instanceof Error ? e.message : 'Could not load them.' })
    }
  }

  // The projects load as soon as the form opens; the one chosen before is
  // chosen again.
  useEffect(() => {
    let cancelled = false
    api.zooniverseProjects(BLANK)
      .then(({ results }) => {
        if (cancelled) return
        setProjects(results)
        setConn({ status: 'ok', message: '' })
        const again = results.find((p) => p.id === initial?.project.id)
        if (again) {
          setProjectId(String(again.id))
          loadSubjectSets(String(again.id))
        }
      })
      .catch((e) => {
        if (!cancelled) setConn({ status: 'error', message: e instanceof Error ? e.message : 'Could not load your Zooniverse projects.' })
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the form opens
  }, [])

  function handleProjectChange(id: string) {
    setProjectId(id)
    setExistingId(null)
    loadSubjectSets(id)
  }

  const project = projects.find((p) => String(p.id) === projectId)
  const chosen = subjectSets.items.find((s) => s.id === existingId)
  // What the upload uses: a subject set is found by its name (see the
  // backend's upload_service) — an existing one's own, or the one typed.
  const trimmed = mode === 'existing' ? (chosen?.display_name ?? '') : name.trim()
  const existing = subjectSets.items.find((s) => s.display_name === trimmed)
  const query = search.trim().toLowerCase()
  const found = subjectSets.items.filter((s) => !query || s.display_name.toLowerCase().includes(query) || String(s.id).includes(query))

  useEffect(() => {
    onDestinationChange(project && trimmed
      ? { project: { id: project.id, name: project.display_name, slug: project.slug }, subject_set_name: trimmed }
      : null)
  }, [project, trimmed, onDestinationChange])

  return (
    <div>
      {/* ── Project ── */}
      <div className="mb-6">
        <label className={labelClass} htmlFor="zooniverse-project">Zooniverse project</label>
        <Combobox
          id="zooniverse-project" disabled={conn.status === 'ok' && projects.length === 0} loading={conn.status === 'loading'}
          options={projects.map((p) => ({ value: String(p.id), label: `${p.display_name} (${p.slug})` }))}
          value={projectId} onChange={handleProjectChange}
          placeholder={
            conn.status === 'loading' ? 'Loading your projects…'
              : conn.status === 'error' ? 'Could not load the projects'
                : projects.length === 0 ? 'No projects you can upload to' : 'Select a project…'
          }
          clearLabel="Clear project"
        />
        {conn.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{conn.message}</p>}
        <p className={hintClass}>Only the projects you own or collaborate on.</p>
      </div>

      {/* ── 3. Subject set ── */}
      {project && (
        <>
          <Heading>Subject set</Heading>
          <div className="flex gap-6 mb-3" role="radiogroup" aria-label="Subject set">
            {([['new', 'New subject set'], ['existing', 'Existing subject set']] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm cursor-pointer text-zinc-700 dark:text-zinc-300">
                <input type="radio" name="subject-set-mode" checked={mode === value} onChange={() => setMode(value)} />
                {label}
              </label>
            ))}
          </div>

          {mode === 'new' && (
            <>
              <div className="mb-2">
                <label className={labelClass} htmlFor="zooniverse-subject-set">Subject set name</label>
                <input
                  id="zooniverse-subject-set" className={inputClass}
                  value={name} onChange={(e) => setName(e.target.value)}
                />
              </div>
              {!trimmed && <p className="text-sm text-red-600 dark:text-red-400">Give the subject set a name.</p>}
              {trimmed && subjectSets.loading && <p className={hintClass}>Checking the project's subject sets…</p>}
              {subjectSets.error && <p className="text-sm text-red-600 dark:text-red-400">{subjectSets.error}</p>}
              {trimmed && !subjectSets.loading && !subjectSets.error && (
                existing
                  ? (
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      This subject set already exists ({existing.subjects_count.toLocaleString()} subjects) — the images will be added to it.
                    </p>
                  )
                  : <p className="text-sm text-zinc-600 dark:text-zinc-300">A new subject set will be created with this name.</p>
              )}
            </>
          )}

          {mode === 'existing' && (
            <div className="mb-2">
              {subjectSets.loading && <p className={hintClass}>Loading the project's subject sets…</p>}
              {subjectSets.error && <p className="text-sm text-red-600 dark:text-red-400">{subjectSets.error}</p>}
              {!subjectSets.loading && !subjectSets.error && subjectSets.items.length === 0 && (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">This project has no subject sets yet — create a new one.</p>
              )}
              {subjectSets.items.length > 0 && (
                <>
                  <input
                    className={inputClass} placeholder="Search by name or id…" aria-label="Search subject sets"
                    value={search} onChange={(e) => setSearch(e.target.value)}
                  />
                  <ul className="mt-2 max-h-64 overflow-auto rounded border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800" aria-label="Subject sets">
                    {found.map((set) => (
                      <li key={set.id}>
                        <button
                          type="button" onClick={() => setExistingId(set.id)} aria-pressed={set.id === existingId}
                          className={[
                            'w-full flex items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors',
                            set.id === existingId
                              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200',
                          ].join(' ')}
                        >
                          <span className="truncate">{set.display_name}</span>
                          <span className="ml-auto shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                            {set.subjects_count.toLocaleString()} subjects <span className="font-mono">#{set.id}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                    {found.length === 0 && <li className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">No subject set matches.</li>}
                  </ul>
                  {chosen
                    ? (
                      <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                        The images will be added to <strong>{chosen.display_name}</strong> ({chosen.subjects_count.toLocaleString()} subjects).
                      </p>
                    )
                    : <p className="text-sm text-red-600 dark:text-red-400 mt-2">Choose a subject set.</p>}
                </>
              )}
            </div>
          )}
          <p className={hintClass}>
            Link it to a workflow in the project&rsquo;s Lab so volunteers can classify it — this app doesn&rsquo;t.
          </p>
        </>
      )}
    </div>
  )
}
