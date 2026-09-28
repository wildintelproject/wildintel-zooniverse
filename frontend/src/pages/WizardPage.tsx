import { useCallback, useEffect, useState } from 'react'
import MediaListsEditor from '../components/MediaListsEditor'
import OptionCards from '../components/OptionCards'
import type { Option } from '../components/OptionCards'
import TrapperSelectionForm from '../components/TrapperSelectionForm'
import ExportClassificationsPage from './ExportClassificationsPage'
import UtilsPage from './UtilsPage'
import UploadCriteriaForm from '../components/UploadCriteriaForm'
import UploadRunPanel from '../components/UploadRunPanel'
import ZooniverseDestinationForm from '../components/ZooniverseDestinationForm'
import { api } from '../api'
import { DEFAULT_CRITERIA } from '../types'
import type { SessionSummary, SourceType, Task, TrapperSelection, UploadCriteria, ZooniverseDestination } from '../types'

const STEP_LABELS = ['Task', 'Source', 'Images', 'Filters', 'Zooniverse', 'Upload']

/** The step a resumed session lands on — the one after the last it saved. */
const RESUME_STEP: Record<SessionSummary['phase'], number> = { selected: 3, filtered: 4, destination: 5, uploading: 5 }

const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50'
const btnPrimary = 'px-6 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600 flex items-center gap-2'

function SmallSpinner() {
  return <div className="w-4 h-4 border border-white/60 border-t-white rounded-full animate-spin" />
}

const TASK_OPTIONS: Option<Task>[] = [
  { value: 'upload', emoji: '⬆️', title: 'Upload images to Zooniverse', description: 'Send a set of camera-trap images (a revision) to a Zooniverse project, as a new subject set.', available: true },
  { value: 'download', emoji: '⬇️', title: 'Retrieve classifications', description: 'Turn the classifications volunteers made in a Zooniverse workflow into a CSV of observations for Trapper.', available: true },
]

const SOURCE_OPTIONS: Option<SourceType>[] = [
  { value: 'local', emoji: '📁', title: 'Local files', description: 'Upload images already available on this machine.', available: false },
  { value: 'trapper', emoji: '🌐', title: 'Trapper Instance', description: 'Upload the images of a Trapper collection, chosen by research project, classification project and deployment.', available: true },
]

function SelectionSummary({ selection }: { selection: TrapperSelection }) {
  return (
    <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">Trapper</dt>
        <dd className="text-zinc-800 dark:text-zinc-200 font-mono break-all">{selection.url}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Research project</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">{selection.research_project.name}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Classification project</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">{selection.classification_project.name}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Collection</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">{selection.collection.name}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Deployments</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">
          {selection.all_deployments ? `All ${selection.deployments.length}` : `${selection.deployments.length} selected`}
          {selection.deployments.every((d) => d.image_count != null) && (
            <span className="text-zinc-500 dark:text-zinc-400">
              {' '}· {selection.deployments.reduce((sum, d) => sum + (d.image_count ?? 0), 0).toLocaleString()} images
            </span>
          )}
          <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {selection.deployments.map((d) => d.deployment_id).join(', ')}
          </div>
        </dd>
      </dl>
    </div>
  )
}

function DestinationSummary({ destination }: { destination: ZooniverseDestination }) {
  return (
    <div className="mt-4 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">Zooniverse project</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">
          {destination.project.name} <span className="text-zinc-500 dark:text-zinc-400 font-mono text-xs">{destination.project.slug}</span>
        </dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Subject set</dt>
        <dd className="text-zinc-800 dark:text-zinc-200 font-mono break-all">{destination.subject_set_name}</dd>
      </dl>
    </div>
  )
}

function CriteriaSummary({ criteria }: { criteria: UploadCriteria }) {
  const removed = [criteria.remove_middle_humans && 'humans', criteria.remove_middle_vehicles && 'vehicles'].filter(Boolean)
  return (
    <div className="mt-4 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">Sequences</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">
          Gap over {criteria.max_interval} s starts a new one · {criteria.images_per_sequence} images each
        </dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Images</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">{criteria.only_classified ? 'Classified only' : 'Classified or not'}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Middle sequences</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">{removed.length ? `Without ${removed.join(' or ')}` : 'Nothing removed'}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Empty sequences</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">
          {criteria.collapse_empty_sequences ? 'Collapsed to their second image' : 'Kept whole'}
        </dd>
      </dl>
    </div>
  )
}

interface Props {
  /** A session left unfinished by an earlier run (see ResumeSessionsPage) —
   * the wizard lands on the step after the one it had reached. */
  resumeSession?: SessionSummary
}

export default function WizardPage({ resumeSession }: Props) {
  const [step, setStep] = useState(resumeSession ? RESUME_STEP[resumeSession.phase] : 0)
  const [task, setTask] = useState<Task | null>(resumeSession?.task ?? null)
  const [source, setSource] = useState<SourceType | null>(resumeSession?.source_type ?? null)
  // The Trapper form's own current selection (null until complete)...
  const [selection, setSelection] = useState<TrapperSelection | null>(null)
  // ...and the one actually saved into this run's session.
  const [session, setSession] = useState<SessionSummary | null>(resumeSession ?? null)
  // The Trapper form stays mounted once first shown (just hidden on other
  // steps), so going Back to it never loses what was already chosen.
  const [trapperFormShown, setTrapperFormShown] = useState(resumeSession?.source_type === 'trapper')
  // The criteria form's own current criteria (null while a field is
  // invalid) — kept here so going Back doesn't lose them.
  const [criteria, setCriteria] = useState<UploadCriteria | null>(resumeSession?.criteria ?? DEFAULT_CRITERIA)
  // What a new run's criteria start from: the settings page's own (the
  // built-in defaults if they can't be read). The criteria form waits for
  // them, so it never starts from the wrong ones.
  const [defaultCriteria, setDefaultCriteria] = useState<UploadCriteria>(DEFAULT_CRITERIA)
  const [defaultsLoaded, setDefaultsLoaded] = useState(false)
  // The Zooniverse form's own destination (null until complete). The form
  // stays mounted once first shown, like the Trapper one, so going Back to
  // it keeps the connection and choices.
  const [destination, setDestination] = useState<ZooniverseDestination | null>(null)
  const [zooniverseFormShown, setZooniverseFormShown] = useState(resumeSession?.phase === 'filtered')
  const [saving, setSaving] = useState(false)
  // The utilities screen, reached from the first step — shown in place of
  // the wizard, which stays mounted.
  const [utilsOpen, setUtilsOpen] = useState(false)
  // Likewise the Retrieve classifications task — a page of its own.
  const [exportOpen, setExportOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getSettings()
      .then((settings) => {
        if (cancelled) return
        setDefaultCriteria(settings.SEQUENCES)
        // Unless a resumed run brought its own.
        if (!resumeSession?.criteria) setCriteria(settings.SEQUENCES)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDefaultsLoaded(true) })
    return () => { cancelled = true }
  }, [resumeSession])

  const handleSelectionChange = useCallback((value: TrapperSelection | null) => setSelection(value), [])
  const handleCriteriaChange = useCallback((value: UploadCriteria | null) => setCriteria(value), [])
  const handleDestinationChange = useCallback((value: ZooniverseDestination | null) => setDestination(value), [])

  async function handleSaveSelection() {
    if (!selection) return
    setSaving(true)
    setError(null)
    try {
      setSession(await api.saveSelection(selection, session?.task_id))
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the selection.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveCriteria() {
    if (!criteria || !session) return
    setSaving(true)
    setError(null)
    try {
      setSession(await api.saveCriteria(session.task_id, criteria))
      setZooniverseFormShown(true)
      setStep(4)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the criteria.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveDestination() {
    if (!destination || !session) return
    setSaving(true)
    setError(null)
    try {
      setSession(await api.saveDestination(session.task_id, destination))
      setStep(5)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the destination.')
    } finally {
      setSaving(false)
    }
  }

  function handleBack() {
    setError(null)
    // A resumed session's Zooniverse form mounts on first reaching its step.
    if (step === 5) setZooniverseFormShown(true)
    setStep((s) => s - 1)
  }

  function handleStartOver() {
    setStep(0)
    setTask(null)
    setSource(null)
    setSelection(null)
    setSession(null)
    setCriteria(defaultCriteria)
    setDestination(null)
    setZooniverseFormShown(false)
    setTrapperFormShown(false)
    setError(null)
  }

  return (
    <div className="mx-auto px-4 py-4" style={{ maxWidth: 700 }}>
      {utilsOpen && <UtilsPage onBack={() => setUtilsOpen(false)} />}
      {exportOpen && <ExportClassificationsPage onBack={() => { setExportOpen(false); setTask(null) }} />}
      <div className={utilsOpen || exportOpen ? 'hidden' : ''}>
        {/* Step indicator */}
        <div className="flex items-start mb-10">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex items-start flex-1">
              <div className="flex flex-col items-center" style={{ minWidth: 56 }}>
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center font-bold mb-1 text-sm ${
                    i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-400'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </div>
                <small className={`text-xs whitespace-nowrap ${i === step ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {label}
                </small>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`flex-1 border-t mx-1 mt-[18px] ${i < step ? 'border-emerald-500' : 'border-zinc-700'}`} />
              )}
            </div>
          ))}
        </div>

        {/* ── Step 0: task ── */}
        {step === 0 && (
          <div>
            <h4 className="text-lg font-semibold mb-1">What do you want to do?</h4>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
              Upload images to a Zooniverse project, or retrieve the classifications volunteers made there.
            </p>
            <OptionCards
              options={TASK_OPTIONS} selected={task}
              onChoose={(value) => {
                setTask(value)
                // Retrieving classifications is a page of its own, not the wizard's steps.
                if (value === 'download') setExportOpen(true)
                else setStep(1)
              }}
            />
            <button
              type="button" onClick={() => setUtilsOpen(true)}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
            >
              <span className="text-lg">🧰</span>
              <strong>Utils</strong>
              <span className="text-zinc-500 dark:text-zinc-400">— update metadata, download subject sets, validation &amp; audit</span>
            </button>
          </div>
        )}

        {/* ── Step 1: source ── */}
        {step === 1 && (
          <div>
            <h4 className="text-lg font-semibold mb-1">Where are the images?</h4>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">Choose where the images to upload come from.</p>
            <OptionCards
              options={SOURCE_OPTIONS} selected={source}
              onChoose={(value) => { setSource(value); setTrapperFormShown(true); setStep(2) }}
            />
          </div>
        )}

        {/* ── Step 2: images (Trapper) ── */}
        {trapperFormShown && source === 'trapper' && (
          <div className={step === 2 ? '' : 'hidden'}>
            <h4 className="text-lg font-semibold mb-1">Choose the images</h4>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
              Connect to Trapper, then pick the research project, classification project, collection and deployments whose
              images will be uploaded.
            </p>
            <TrapperSelectionForm onSelectionChange={handleSelectionChange} />
            {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}

        {/* ── Step 3: filters ── */}
        {step === 3 && session && (
          <div>
            <h4 className="text-lg font-semibold mb-1">Choose which images to upload</h4>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
              Each deployment's images are grouped into sequences by time, and only a few of each sequence are uploaded.
            </p>
            <div className="mb-6"><SelectionSummary selection={session.selection} /></div>
            {defaultsLoaded && (
              <UploadCriteriaForm
                selection={session.selection} initial={criteria ?? defaultCriteria} onCriteriaChange={handleCriteriaChange}
              />
            )}
            {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}

        {/* ── Step 4: Zooniverse destination ── */}
        {zooniverseFormShown && session && (
          <div className={step === 4 ? '' : 'hidden'}>
            <h4 className="text-lg font-semibold mb-1">Where to upload them</h4>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
              Connect to Zooniverse, then pick the project and the subject set the images go to.
            </p>
            <ZooniverseDestinationForm
              // A new collection means a new default subject set name.
              key={`${session.selection.research_project.pk}-${session.selection.collection.pk}`}
              selection={session.selection} initial={session.destination} onDestinationChange={handleDestinationChange}
            />
            {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}

        {/* ── Step 5: upload ── */}
        {step === 5 && session && (
          <div>
            <h4 className="text-lg font-semibold mb-1">Upload to Zooniverse</h4>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
              All of this is saved in this session — you can close the app and resume it later.
            </p>
            <SelectionSummary selection={session.selection} />
            {session.criteria && <CriteriaSummary criteria={session.criteria} />}
            {session.destination && <DestinationSummary destination={session.destination} />}
            <MediaListsEditor session={session} onSaved={setSession} />
          <div className="mt-6"><UploadRunPanel session={session} /></div>
          </div>
        )}

        {/* Navigation */}
        {step > 0 && (
          <div className="flex justify-between items-start mt-10">
            <button type="button" className={btnOutline} onClick={handleBack}>Back</button>

            {step === 2 && (
              <button type="button" className={btnPrimary} disabled={!selection || saving} onClick={handleSaveSelection}>
                {saving && <SmallSpinner />}
                {saving ? 'Saving…' : 'Next'}
              </button>
            )}
            {step === 3 && (
              <button type="button" className={btnPrimary} disabled={!criteria || saving} onClick={handleSaveCriteria}>
                {saving && <SmallSpinner />}
                {saving ? 'Saving…' : 'Next'}
              </button>
            )}
            {step === 4 && (
              <button type="button" className={btnPrimary} disabled={!destination || saving} onClick={handleSaveDestination}>
                {saving && <SmallSpinner />}
                {saving ? 'Saving…' : 'Next'}
              </button>
            )}
            {step === 5 && (
              <button type="button" className={btnOutline} onClick={handleStartOver}>Start over</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
