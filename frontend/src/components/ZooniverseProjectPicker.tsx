import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { ZooniverseCredentials } from '../api'
import type { ZooniverseProject, ZooniverseSubjectSet } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 flex items-center gap-2'

export function SmallSpinner() {
  return <div className="w-4 h-4 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
}

export function StepHeading({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h4 className="text-base font-semibold mb-4 text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
      <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-xs flex items-center justify-center font-bold">{n}</span>
      {children}
    </h4>
  )
}

export function Divider() {
  return <div className="border-t border-zinc-200 dark:border-zinc-700 mb-6" />
}

/** What the picker has so far — subjectSets.items once a project's are
 * loaded. */
export interface ZooniversePick {
  creds: ZooniverseCredentials
  /** The connection was tested and works. */
  connected: boolean
  projectId: number | null
  subjectSets: { items: ZooniverseSubjectSet[]; loading: boolean; error: string | null }
}

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error'

interface Props {
  /** Step 2's heading, e.g. "Subject sets". */
  title: string
  disabled?: boolean
  /** Load the chosen project's subject sets (the children then show once
   * there are some) — otherwise the children show as soon as a project is
   * chosen. */
  loadSubjectSets?: boolean
  onChange: (pick: ZooniversePick) => void
  /** Shown under the project once one is chosen — the subject set choice. */
  children?: ReactNode
}

/** Steps 1 and 2 of a Utils page: connect to Zooniverse (the saved account
 * pre-filled), then pick one of the user's projects, whose subject sets
 * are loaded for the page to choose from. */
export default function ZooniverseProjectPicker({ title, disabled = false, loadSubjectSets = true, onChange, children }: Props) {
  const [form, setForm] = useState<ZooniverseCredentials>({ username: '', password: '' })
  const [hasSavedPassword, setHasSavedPassword] = useState(false)
  const [conn, setConn] = useState<{ status: ConnStatus; message: string }>({ status: 'idle', message: '' })
  const [projects, setProjects] = useState<ZooniverseProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [subjectSets, setSubjectSets] = useState<ZooniversePick['subjectSets']>({ items: [], loading: false, error: null })

  useEffect(() => {
    api.zooniverseGetConfig()
      .then((config) => {
        setForm((f) => ({ ...f, username: config.user_name ?? f.username }))
        setHasSavedPassword(config.has_password)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    onChange({ creds: form, connected: conn.status === 'ok', projectId: projectId ? Number(projectId) : null, subjectSets })
  }, [form, conn.status, projectId, subjectSets, onChange])

  function setField(key: keyof ZooniverseCredentials, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setConn({ status: 'idle', message: '' })
    setProjects([])
    setProjectId('')
    setSubjectSets({ items: [], loading: false, error: null })
  }

  const canTest = form.username !== '' && (form.password !== '' || hasSavedPassword)

  async function handleTestConnection() {
    setConn({ status: 'testing', message: '' })
    setProjects([])
    setProjectId('')
    setSubjectSets({ items: [], loading: false, error: null })
    try {
      const me = await api.zooniverseTestConnection(form)
      const { results } = await api.zooniverseProjects(form)
      setProjects(results)
      setHasSavedPassword(true) // saved by the backend on a successful test
      setConn({ status: 'ok', message: `Connected as ${me.login} — ${results.length} project(s).` })
    } catch (e) {
      setConn({ status: 'error', message: e instanceof Error ? e.message : 'Could not connect to Zooniverse.' })
    }
  }

  async function handleProjectChange(id: string) {
    setProjectId(id)
    setSubjectSets({ items: [], loading: Boolean(id) && loadSubjectSets, error: null })
    if (!id || !loadSubjectSets) return
    try {
      const { results } = await api.zooniverseSubjectSets(form, Number(id))
      setSubjectSets({ items: results, loading: false, error: null })
    } catch (e) {
      setSubjectSets({ items: [], loading: false, error: e instanceof Error ? e.message : 'Could not load them.' })
    }
  }

  return (
    <>
      <StepHeading n={1}>Connect to Zooniverse</StepHeading>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className={labelClass} htmlFor="zoo-pick-username">Username</label>
          <input
            id="zoo-pick-username" className={inputClass} disabled={disabled}
            value={form.username} onChange={(e) => setField('username', e.target.value)} autoComplete="username"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="zoo-pick-password">Password</label>
          <input
            id="zoo-pick-password" type="password" className={inputClass} placeholder="••••••••" disabled={disabled}
            value={form.password} onChange={(e) => setField('password', e.target.value)} autoComplete="current-password"
          />
          {hasSavedPassword && form.password === '' && <p className={hintClass}>Already saved — leave blank to reuse it.</p>}
        </div>
      </div>
      <div className="mb-6">
        <div className="flex justify-end">
          <button type="button" className={btnOutline} disabled={!canTest || conn.status === 'testing' || disabled} onClick={handleTestConnection}>
            {conn.status === 'testing' && <SmallSpinner />}
            {conn.status === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
        {conn.status === 'ok' && <div className="mt-2 text-sm text-emerald-600 dark:text-emerald-400 text-right">{conn.message}</div>}
        {conn.status === 'error' && <div className="mt-2 text-sm text-red-600 dark:text-red-400 text-right">{conn.message}</div>}
      </div>

      {conn.status === 'ok' && (
        <>
          <Divider />
          <StepHeading n={2}>{title}</StepHeading>
          <div className="mb-4">
            <label className={labelClass} htmlFor="zoo-pick-project">Zooniverse project</label>
            <select
              id="zoo-pick-project" className={inputClass} disabled={projects.length === 0 || disabled}
              value={projectId} onChange={(e) => handleProjectChange(e.target.value)}
            >
              <option value="">{projects.length === 0 ? 'No projects' : 'Select a project…'}</option>
              {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.display_name} ({p.slug})</option>)}
            </select>
          </div>
          {subjectSets.loading && <p className={hintClass}>Loading the project&rsquo;s subject sets…</p>}
          {subjectSets.error && <p className="text-sm text-red-600 dark:text-red-400">{subjectSets.error}</p>}
          {projectId && !loadSubjectSets && children}
          {projectId && loadSubjectSets && !subjectSets.loading && !subjectSets.error && (
            subjectSets.items.length === 0
              ? <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">This project has no subject sets.</p>
              : children
          )}
        </>
      )}
    </>
  )
}
