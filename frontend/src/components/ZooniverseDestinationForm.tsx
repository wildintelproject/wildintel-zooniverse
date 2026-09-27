import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { ZooniverseCredentials } from '../api'
import type { TrapperSelection, ZooniverseDestination, ZooniverseProject, ZooniverseSubjectSet } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'

function SmallSpinner() {
  return <div className="w-4 h-4 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
}

function StepHeading({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h4 className="text-base font-semibold mb-4 text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
      <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-xs flex items-center justify-center font-bold">{n}</span>
      {children}
    </h4>
  )
}

function Divider() {
  return <div className="border-t border-zinc-200 dark:border-zinc-700 mb-6" />
}

/** wildintel-tools' own subject set name for a collection:
 * {research project}_{its pk}_{collection}_{its pk}_{YYYY-MM}. */
export function defaultSubjectSetName(selection: TrapperSelection, now = new Date()): string {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const { research_project: rp, collection } = selection
  return `${rp.name}_${rp.pk}_${collection.name}_${collection.pk}_${month}`
}

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error'

interface Props {
  selection: TrapperSelection
  /** A destination saved earlier — its project is chosen again once
   * connected, and its subject set name kept. */
  initial?: ZooniverseDestination
  /** The destination once a project is chosen and the name isn't blank,
   * null otherwise. */
  onDestinationChange: (destination: ZooniverseDestination | null) => void
}

/** Connects to Zooniverse and picks where the images go: one of the user's
 * projects, and a subject set in it — by name, as wildintel-tools does: an
 * existing one with that name gets the new subjects, otherwise it's created. */
export default function ZooniverseDestinationForm({ selection, initial, onDestinationChange }: Props) {
  const [form, setForm] = useState<ZooniverseCredentials>({ username: '', password: '' })
  const [hasSavedPassword, setHasSavedPassword] = useState(false)
  const [conn, setConn] = useState<{ status: ConnStatus; message: string }>({ status: 'idle', message: '' })
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

  useEffect(() => {
    api.zooniverseGetConfig()
      .then((config) => {
        setForm((f) => ({ ...f, username: config.user_name ?? f.username }))
        setHasSavedPassword(config.has_password)
      })
      .catch(() => {})
  }, [])

  function setField(key: keyof ZooniverseCredentials, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setConn({ status: 'idle', message: '' })
    setProjects([])
    setProjectId('')
    setSubjectSets({ items: [], loading: false, error: null })
  }

  const canTest = form.username !== '' && (form.password !== '' || hasSavedPassword)
  const isTesting = conn.status === 'testing'

  async function loadSubjectSets(id: string) {
    setSubjectSets({ items: [], loading: Boolean(id), error: null })
    if (!id) return
    try {
      const { results } = await api.zooniverseSubjectSets(form, Number(id))
      setSubjectSets({ items: results, loading: false, error: null })
    } catch (e) {
      setSubjectSets({ items: [], loading: false, error: e instanceof Error ? e.message : 'Could not load them.' })
    }
  }

  async function handleTestConnection() {
    setConn({ status: 'testing', message: '' })
    setProjects([])
    setProjectId('')
    try {
      const me = await api.zooniverseTestConnection(form)
      const { results } = await api.zooniverseProjects(form)
      setProjects(results)
      setHasSavedPassword(true) // saved by the backend on a successful test
      setConn({ status: 'ok', message: `Connected as ${me.login} — ${results.length} project(s) you can upload to.` })
      const again = results.find((p) => p.id === initial?.project.id)
      if (again) {
        setProjectId(String(again.id))
        loadSubjectSets(String(again.id))
      }
    } catch (e) {
      setConn({ status: 'error', message: e instanceof Error ? e.message : 'Could not connect to Zooniverse.' })
    }
  }

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
      {/* ── 1. Connection ── */}
      <StepHeading n={1}>Connect to Zooniverse</StepHeading>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className={labelClass} htmlFor="zooniverse-username">Username</label>
          <input
            id="zooniverse-username" className={inputClass}
            value={form.username} onChange={(e) => setField('username', e.target.value)} autoComplete="username"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="zooniverse-password">Password</label>
          <input
            id="zooniverse-password" type="password" className={inputClass} placeholder="••••••••"
            value={form.password} onChange={(e) => setField('password', e.target.value)} autoComplete="current-password"
          />
          {hasSavedPassword && form.password === '' && <p className={hintClass}>Already saved — leave blank to reuse it.</p>}
        </div>
      </div>

      <div className="mb-6">
        <div className="flex justify-end">
          <button
            type="button" disabled={!canTest || isTesting} onClick={handleTestConnection}
            className={[
              'px-4 py-2 text-sm rounded border flex items-center gap-2 transition-colors',
              canTest && !isTesting
                ? 'border-zinc-400 dark:border-zinc-500 text-zinc-700 dark:text-zinc-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-400 dark:text-zinc-600 cursor-not-allowed',
            ].join(' ')}
          >
            {isTesting && <SmallSpinner />}
            {isTesting ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
        {conn.status === 'ok' && <div className="mt-2 text-sm text-emerald-600 dark:text-emerald-400 text-right">{conn.message}</div>}
        {conn.status === 'error' && <div className="mt-2 text-sm text-red-600 dark:text-red-400 text-right">{conn.message}</div>}
      </div>

      {/* ── 2. Project ── */}
      {conn.status === 'ok' && (
        <>
          <Divider />
          <StepHeading n={2}>Project</StepHeading>
          <div className="mb-6">
            <label className={labelClass} htmlFor="zooniverse-project">Zooniverse project</label>
            <select
              id="zooniverse-project" disabled={projects.length === 0}
              className={[inputClass, projects.length === 0 ? 'cursor-not-allowed opacity-50' : ''].join(' ')}
              value={projectId} onChange={(e) => handleProjectChange(e.target.value)}
            >
              <option value="">{projects.length === 0 ? 'No projects you can upload to' : 'Select a project…'}</option>
              {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.display_name} ({p.slug})</option>)}
            </select>
            <p className={hintClass}>Only the projects you own or collaborate on.</p>
          </div>
        </>
      )}

      {/* ── 3. Subject set ── */}
      {project && (
        <>
          <Divider />
          <StepHeading n={3}>Subject set</StepHeading>
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
