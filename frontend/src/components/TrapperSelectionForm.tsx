import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { TrapperCredentials } from '../api'
import Combobox from './Combobox'
import FieldLabel from './FieldLabel'
import type { ClassificationProject, Collection, Deployment, ResearchProject, TrapperSelection } from '../types'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'

function SmallSpinner() {
  return <div className="w-4 h-4 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
}

function StepHeading({ n, children }: { n?: number; children: ReactNode }) {
  return (
    <h4 className="text-base font-semibold mb-4 text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
      {n !== undefined && (
        <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-xs flex items-center justify-center font-bold">{n}</span>
      )}
      {children}
    </h4>
  )
}

function Divider() {
  return <div className="border-t border-zinc-200 dark:border-zinc-700 mb-6" />
}

function selectClass(disabled: boolean) {
  return [inputClass, disabled ? 'cursor-not-allowed opacity-50' : ''].join(' ')
}

function day(iso?: string | null) {
  return iso ? iso.slice(0, 10) : '?'
}

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error'

// The credentials the saved connection sends: all blank, so the backend's
// are the configuration's.
const BLANK: TrapperCredentials = { url: '', username: '', password: '' }

/** One level of the Trapper hierarchy: its options, the chosen one, and
 * whether it's still loading. */
interface Level<T> {
  items: T[]
  selected: string
  loading: boolean
  error: string | null
}

function emptyLevel<T>(): Level<T> {
  return { items: [], selected: '', loading: false, error: null }
}

interface Props {
  /** The full selection once at least one deployment is chosen, or null
   * whenever it stops being valid (an upstream choice changed). */
  onSelectionChange: (selection: TrapperSelection | null) => void
  /** Use the account saved in the configuration: no connection step, the
   * research projects load as soon as the form opens (and its steps aren't
   * numbered — the page around it has its own). */
  useSavedConnection?: boolean
  /** Under the classification project field. */
  classificationHint?: ReactNode
}

/** Connects to Trapper and walks it the same way wildintel-tools' own
 * "zooniverse wizard import" does: research project -> classification
 * project -> collection -> deployments (all or some). */
export default function TrapperSelectionForm({ onSelectionChange, useSavedConnection = false, classificationHint }: Props) {
  const [form, setForm] = useState<TrapperCredentials>({ url: '', username: '', password: '' })
  const [hasSavedPassword, setHasSavedPassword] = useState(false)
  const [conn, setConn] = useState<{ status: ConnStatus; message: string }>({ status: 'idle', message: '' })

  const [researchProjects, setResearchProjects] = useState<Level<ResearchProject>>(
    () => ({ ...emptyLevel<ResearchProject>(), loading: useSavedConnection }),
  )
  const [classificationProjects, setClassificationProjects] = useState<Level<ClassificationProject>>(emptyLevel)
  const [collections, setCollections] = useState<Level<Collection>>(emptyLevel)
  const [deployments, setDeployments] = useState<Level<Deployment>>(emptyLevel)
  // Chosen deployment pks — starts with every one of them chosen.
  const [chosenDeployments, setChosenDeployments] = useState<Set<number>>(new Set())
  const [deploymentFilter, setDeploymentFilter] = useState('')

  // Prefill url/username (and whether a password is saved) from settings.toml
  // — the password itself never reaches the frontend: leaving the field
  // blank reuses it.
  useEffect(() => {
    api.trapperGetConfig()
      .then((config) => {
        setForm((f) => ({ ...f, url: config.base_url ?? f.url, username: config.user_name ?? f.username }))
        setHasSavedPassword(config.has_password)
      })
      .catch(() => {})
  }, [])

  // With the saved connection the credentials stay as the configuration's
  // (the requests leave them blank, the backend falls back) and the
  // research projects load right away.
  useEffect(() => {
    if (!useSavedConnection) return
    let cancelled = false
    setResearchProjects({ ...emptyLevel<ResearchProject>(), loading: true })
    api.trapperResearchProjects(BLANK)
      .then(({ results }) => { if (!cancelled) setResearchProjects({ ...emptyLevel<ResearchProject>(), items: results }) })
      .catch((e) => {
        if (!cancelled) setResearchProjects({ ...emptyLevel<ResearchProject>(), error: e instanceof Error ? e.message : 'Could not load the research projects.' })
      })
    return () => { cancelled = true }
  }, [useSavedConnection])

  function resetBelow(level: 'connection' | 'research' | 'classification' | 'collection') {
    if (level === 'connection') setResearchProjects(emptyLevel)
    if (level === 'connection' || level === 'research') setClassificationProjects(emptyLevel)
    if (level !== 'collection') setCollections(emptyLevel)
    setDeployments(emptyLevel)
    setChosenDeployments(new Set())
    setDeploymentFilter('')
  }

  function setField(key: keyof TrapperCredentials, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setConn({ status: 'idle', message: '' })
    resetBelow('connection')
  }

  const creds = useSavedConnection ? BLANK : form
  const canTest = form.url !== '' && form.username !== '' && (form.password !== '' || hasSavedPassword)
  const isTesting = conn.status === 'testing'

  async function handleTestConnection() {
    setConn({ status: 'testing', message: '' })
    resetBelow('connection')
    try {
      const result = await api.trapperTestConnection(form)
      const { results } = await api.trapperResearchProjects(form)
      setResearchProjects({ ...emptyLevel<ResearchProject>(), items: results })
      setHasSavedPassword(true) // saved by the backend on a successful test
      setConn({ status: 'ok', message: `Connected — ${result.research_projects_count} research project(s) available.` })
    } catch (e) {
      setConn({ status: 'error', message: e instanceof Error ? e.message : 'Could not connect to Trapper.' })
    }
  }

  async function handleResearchProjectChange(pk: string) {
    setResearchProjects((l) => ({ ...l, selected: pk }))
    resetBelow('research')
    if (!pk) return
    setClassificationProjects({ ...emptyLevel<ClassificationProject>(), loading: true })
    try {
      const { results } = await api.trapperClassificationProjects(creds, Number(pk))
      setClassificationProjects({ ...emptyLevel<ClassificationProject>(), items: results })
    } catch (e) {
      setClassificationProjects({ ...emptyLevel<ClassificationProject>(), error: e instanceof Error ? e.message : 'Could not load them.' })
    }
  }

  async function handleClassificationProjectChange(pk: string) {
    setClassificationProjects((l) => ({ ...l, selected: pk }))
    resetBelow('classification')
    if (!pk) return
    setCollections({ ...emptyLevel<Collection>(), loading: true })
    try {
      const { results } = await api.trapperCollections(creds, Number(pk))
      setCollections({ ...emptyLevel<Collection>(), items: results })
    } catch (e) {
      setCollections({ ...emptyLevel<Collection>(), error: e instanceof Error ? e.message : 'Could not load them.' })
    }
  }

  async function handleCollectionChange(pk: string) {
    setCollections((l) => ({ ...l, selected: pk }))
    resetBelow('collection')
    const collection = collections.items.find((c) => String(c.pk) === pk)
    if (!collection) return
    setDeployments({ ...emptyLevel<Deployment>(), loading: true })
    try {
      const { results } = await api.trapperDeployments(creds, Number(researchProjects.selected), collection.pk)
      setDeployments({ ...emptyLevel<Deployment>(), items: results })
      setChosenDeployments(new Set(results.map((d) => d.pk)))
    } catch (e) {
      setDeployments({ ...emptyLevel<Deployment>(), error: e instanceof Error ? e.message : 'Could not load them.' })
    }
  }

  function toggleDeployment(pk: number) {
    setChosenDeployments((chosen) => {
      const next = new Set(chosen)
      if (next.has(pk)) next.delete(pk)
      else next.add(pk)
      return next
    })
  }

  const researchProject = researchProjects.items.find((p) => String(p.pk) === researchProjects.selected)
  const classificationProject = classificationProjects.items.find((p) => String(p.pk) === classificationProjects.selected)
  const collection = collections.items.find((c) => String(c.pk) === collections.selected)
  const allChosen = deployments.items.length > 0 && chosenDeployments.size === deployments.items.length
  const chosenImages = deployments.items.filter((d) => chosenDeployments.has(d.pk)).reduce((sum, d) => sum + d.image_count, 0)
  const needle = deploymentFilter.trim().toLowerCase()
  const shownDeployments = needle
    ? deployments.items.filter((d) => [d.deployment_id, d.location_id ?? ''].some((v) => v.toLowerCase().includes(needle)))
    : deployments.items

  useEffect(() => {
    if (!researchProject || !classificationProject || !collection || chosenDeployments.size === 0) {
      onSelectionChange(null)
      return
    }
    onSelectionChange({
      url: form.url,
      research_project: { pk: researchProject.pk, name: researchProject.name },
      classification_project: { pk: classificationProject.pk, name: classificationProject.name },
      collection: { pk: collection.pk, name: collection.name },
      deployments: deployments.items
        .filter((d) => chosenDeployments.has(d.pk))
        .map((d) => ({ pk: d.pk, deployment_id: d.deployment_id, image_count: d.image_count })),
      all_deployments: allChosen,
    })
  }, [researchProject, classificationProject, collection, chosenDeployments, deployments.items, allChosen, form.url, onSelectionChange])

  return (
    <div>
      {!useSavedConnection && (
        <>
      {/* ── 1. Connection ── */}
        <StepHeading n={1}>Connect to Trapper</StepHeading>
  
        <div className="mb-4">
          <label className={labelClass} htmlFor="trapper-url">Trapper URL</label>
          <input
            id="trapper-url" className={inputClass} placeholder="https://trapper.example.com"
            value={form.url} onChange={(e) => setField('url', e.target.value)} autoComplete="url"
          />
        </div>
  
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelClass} htmlFor="trapper-username">Username</label>
            <input
              id="trapper-username" className={inputClass}
              value={form.username} onChange={(e) => setField('username', e.target.value)} autoComplete="username"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="trapper-password">Password</label>
            <input
              id="trapper-password" type="password" className={inputClass} placeholder="••••••••"
              value={form.password} onChange={(e) => setField('password', e.target.value)} autoComplete="current-password"
            />
            {hasSavedPassword && form.password === '' && (
              <p className={hintClass}>Already saved — leave blank to reuse it.</p>
            )}
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
          {conn.status === 'ok' && (
            <div className="flex items-center gap-1.5 mt-2 text-sm text-emerald-600 dark:text-emerald-400 justify-end">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {conn.message}
            </div>
          )}
          {conn.status === 'error' && <div className="mt-2 text-sm text-red-600 dark:text-red-400 text-right">{conn.message}</div>}
        </div>
        </>
      )}

      {/* ── 2. Research project ── */}
      {(conn.status === 'ok' || useSavedConnection) && (
        <>
          {!useSavedConnection && <Divider />}
          {!useSavedConnection && <StepHeading n={2}>Research project</StepHeading>}
          <div className="mb-6">
            <FieldLabel htmlFor="trapper-research-project" done={Boolean(researchProject)}>Research project</FieldLabel>
            <Combobox
              id="trapper-research-project" disabled={researchProjects.items.length === 0} loading={researchProjects.loading}
              options={researchProjects.items.map((p) => ({ value: String(p.pk), label: p.acronym && p.acronym !== p.name ? `${p.acronym} — ${p.name}` : p.name }))}
              value={researchProjects.selected} onChange={handleResearchProjectChange}
              placeholder={
                researchProjects.loading ? 'Loading research projects…'
                  : researchProjects.items.length === 0 ? 'No research projects found' : 'Select a research project…'
              }
              clearLabel="Clear research project"
            />
            {researchProjects.error && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{researchProjects.error}</p>}
          </div>
        </>
      )}

      {/* ── 3. Classification project ── */}
      {researchProject && (
        <>
          {!useSavedConnection && <Divider />}
          {!useSavedConnection && <StepHeading n={3}>Classification project</StepHeading>}
          <div className="mb-6">
            <FieldLabel htmlFor="trapper-classification-project" done={Boolean(classificationProject)}>Classification project</FieldLabel>
            <Combobox
              id="trapper-classification-project"
              disabled={classificationProjects.items.length === 0} loading={classificationProjects.loading}
              options={classificationProjects.items.map((p) => ({ value: String(p.pk), label: `${p.name}${p.is_active ? '' : ' (inactive)'}` }))}
              value={classificationProjects.selected} onChange={handleClassificationProjectChange}
              placeholder={
                classificationProjects.loading ? 'Loading classification projects…'
                  : classificationProjects.items.length === 0 ? 'No classification projects found'
                    : 'Select a classification project…'
              }
              clearLabel="Clear classification project"
            />
            {classificationProjects.error && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{classificationProjects.error}</p>}
            {classificationHint && <p className={hintClass}>{classificationHint}</p>}
          </div>
        </>
      )}

      {/* ── 4. Collection ── */}
      {classificationProject && (
        <>
          {!useSavedConnection && <Divider />}
          {!useSavedConnection && <StepHeading n={4}>Collection</StepHeading>}
          <div className="mb-6">
            <FieldLabel htmlFor="trapper-collection" done={Boolean(collection)}>Collection</FieldLabel>
            {useSavedConnection
              ? (
                <Combobox
                  id="trapper-collection"
                  disabled={collections.items.length === 0} loading={collections.loading}
                  options={collections.items.map((c) => ({ value: String(c.pk), label: `${c.name} — ${c.approved_count}/${c.total_count} approved` }))}
                  value={collections.selected} onChange={handleCollectionChange}
                  placeholder={
                    collections.loading ? 'Loading collections…'
                      : collections.items.length === 0 ? 'No collections found'
                        : 'Select a collection…'
                  }
                  clearLabel="Clear collection"
                />
              )
              : (
              <select
                id="trapper-collection"
                disabled={collections.loading || collections.items.length === 0}
                className={selectClass(collections.loading || collections.items.length === 0)}
                value={collections.selected} onChange={(e) => handleCollectionChange(e.target.value)}
              >
                <option value="">
                  {collections.loading ? 'Loading collections…'
                    : collections.items.length === 0 ? 'No collections found'
                      : 'Select a collection…'}
                </option>
                {collections.items.map((c) => (
                  <option key={c.pk} value={String(c.pk)}>{c.name} — {c.approved_count}/{c.total_count} approved</option>
                ))}
              </select>
              )}
            {collections.error && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{collections.error}</p>}
          </div>
        </>
      )}

      {/* ── 5. Deployments ── */}
      {collection && (
        <>
          {!useSavedConnection && <Divider />}
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Deployments</h4>
            {chosenDeployments.size > 0 && (
              <svg role="img" aria-label="Done" className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12.5l2.7 2.7L16 9.5" />
              </svg>
            )}
          </div>
          {deployments.loading && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2"><SmallSpinner /> Loading deployments…</p>
          )}
          {deployments.error && <p className="text-sm text-red-600 dark:text-red-400">{deployments.error}</p>}
          {!deployments.loading && !deployments.error && deployments.items.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              None of this research project's deployments has images in this collection.
            </p>
          )}
          {deployments.items.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox" checked={allChosen}
                    onChange={() => setChosenDeployments(allChosen ? new Set() : new Set(deployments.items.map((d) => d.pk)))}
                  />
                  Select all
                </label>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {chosenDeployments.size} of {deployments.items.length} selected · {chosenImages.toLocaleString()} images
                </span>
                {deployments.items.length > 8 && (
                  <input
                    aria-label="Filter deployments" className={`${inputClass} flex-1 min-w-[10rem]`} placeholder="Filter by id or location"
                    value={deploymentFilter} onChange={(e) => setDeploymentFilter(e.target.value)}
                  />
                )}
              </div>
              <ul className="border border-zinc-300 dark:border-zinc-700 rounded divide-y divide-zinc-200 dark:divide-zinc-700 max-h-72 overflow-y-auto">
                {shownDeployments.map((d) => (
                  <li key={d.pk}>
                    <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <input
                        type="checkbox" checked={chosenDeployments.has(d.pk)} onChange={() => toggleDeployment(d.pk)}
                        aria-label={d.deployment_id}
                      />
                      <span className="font-mono text-zinc-900 dark:text-zinc-100">{d.deployment_id}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto whitespace-nowrap">
                        {d.image_count.toLocaleString()} images · {day(d.start_date)} → {day(d.end_date)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {chosenDeployments.size === 0 && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">Choose at least one deployment.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
