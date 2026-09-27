import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { AppSettings, AppSettingsUpdate, LogLevel } from '../types'

const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400'
const btnPrimary = 'px-6 py-2.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

/** The same limits the backend enforces (config.py). */
const LIMITS = {
  workers: { min: 1, max: 32 },
  attempts: { min: 1, max: 20 },
  delay: { min: 0, max: 3600 },
  positive: { min: 1, max: Number.MAX_SAFE_INTEGER },
  fileSizeMb: { min: 0.01, max: 1000, decimal: true },
}

type Limits = { min: number; max: number; decimal?: boolean }

// ── Icons (24×24, stroke — lucide's shapes) ─────────────────────────────

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const CameraIcon = () => (
  <Icon>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Icon>
)
const GlobeIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </Icon>
)
const LayersIcon = () => (
  <Icon>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </Icon>
)
const SlidersIcon = () => (
  <Icon>
    <path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" />
    <path d="M20 21v-5" /><path d="M20 12V3" /><path d="M2 14h4" /><path d="M10 8h4" /><path d="M18 16h4" />
  </Icon>
)
const BackIcon = () => (
  <Icon>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Icon>
)

// ── The form's own state ────────────────────────────────────────────────

/** Every field as typed — numbers can be briefly empty or invalid. */
interface Draft {
  logLevel: LogLevel
  trapperUrl: string
  trapperUser: string
  trapperPassword: string
  downloadWorkers: string
  downloadAttempts: string
  downloadDelay: string
  zooUser: string
  zooPassword: string
  uploadWorkers: string
  uploadAttempts: string
  uploadDelay: string
  exportClassifiedBy: string
  exportMaxSizeMb: string
  maxInterval: string
  imagesPerSequence: string
  onlyClassified: boolean
  removeHumans: boolean
  removeVehicles: boolean
}

type NumberKey = { [K in keyof Draft]: Draft[K] extends string ? K : never }[keyof Draft]
type BoolKey = { [K in keyof Draft]: Draft[K] extends boolean ? K : never }[keyof Draft]

function toDraft(s: AppSettings): Draft {
  return {
    logLevel: s.GENERAL.log_level,
    trapperUrl: s.TRAPPER.base_url ?? '',
    trapperUser: s.TRAPPER.user_name ?? '',
    trapperPassword: '',
    downloadWorkers: String(s.TRAPPER.download_workers),
    downloadAttempts: String(s.TRAPPER.download_attempts),
    downloadDelay: String(s.TRAPPER.download_retry_delay),
    zooUser: s.ZOONIVERSE.user_name ?? '',
    zooPassword: '',
    uploadWorkers: String(s.ZOONIVERSE.upload_workers),
    uploadAttempts: String(s.ZOONIVERSE.upload_attempts),
    uploadDelay: String(s.ZOONIVERSE.upload_retry_delay),
    exportClassifiedBy: s.ZOONIVERSE.export_classified_by,
    exportMaxSizeMb: String(s.ZOONIVERSE.export_max_file_size_mb),
    maxInterval: String(s.SEQUENCES.max_interval),
    imagesPerSequence: String(s.SEQUENCES.images_per_sequence),
    onlyClassified: s.SEQUENCES.only_classified,
    removeHumans: s.SEQUENCES.remove_middle_humans,
    removeVehicles: s.SEQUENCES.remove_middle_vehicles,
  }
}

function numberIn(value: string, { min, max, decimal }: Limits): number | null {
  const pattern = decimal ? /^\d+(\.\d+)?$/ : /^\d+$/
  return pattern.test(value.trim()) && Number(value) >= min && Number(value) <= max ? Number(value) : null
}

/** Each numeric field's limits, by the section it's on. */
const NUMBER_FIELDS: Record<SectionId, [NumberKey, Limits][]> = {
  general: [],
  trapper: [['downloadWorkers', LIMITS.workers], ['downloadAttempts', LIMITS.attempts], ['downloadDelay', LIMITS.delay]],
  zooniverse: [
    ['uploadWorkers', LIMITS.workers], ['uploadAttempts', LIMITS.attempts], ['uploadDelay', LIMITS.delay],
    ['exportMaxSizeMb', LIMITS.fileSizeMb],
  ],
  sequences: [['maxInterval', LIMITS.positive], ['imagesPerSequence', LIMITS.positive]],
}

function sectionValid(d: Draft, id: SectionId): boolean {
  if (id === 'zooniverse' && !d.exportClassifiedBy.trim()) return false
  return NUMBER_FIELDS[id].every(([key, limits]) => numberIn(d[key], limits) !== null)
}

function toUpdate(d: Draft): AppSettingsUpdate | null {
  if (!SECTIONS.every((s) => sectionValid(d, s.id))) return null
  const n = (key: NumberKey) => Number(d[key])
  return {
    GENERAL: { log_level: d.logLevel },
    TRAPPER: {
      base_url: d.trapperUrl.trim() || null, user_name: d.trapperUser.trim() || null, user_password: d.trapperPassword,
      download_workers: n('downloadWorkers'), download_attempts: n('downloadAttempts'), download_retry_delay: n('downloadDelay'),
    },
    ZOONIVERSE: {
      user_name: d.zooUser.trim() || null, user_password: d.zooPassword,
      upload_workers: n('uploadWorkers'), upload_attempts: n('uploadAttempts'), upload_retry_delay: n('uploadDelay'),
      export_classified_by: d.exportClassifiedBy.trim(), export_max_file_size_mb: n('exportMaxSizeMb'),
    },
    SEQUENCES: {
      max_interval: n('maxInterval'), images_per_sequence: n('imagesPerSequence'), only_classified: d.onlyClassified,
      remove_middle_humans: d.removeHumans, remove_middle_vehicles: d.removeVehicles,
    },
  }
}

// ── Layout pieces ───────────────────────────────────────────────────────

type SectionId = 'general' | 'trapper' | 'zooniverse' | 'sequences'

const SECTIONS: { id: SectionId; label: string; icon: () => ReactNode }[] = [
  { id: 'general', label: 'General', icon: SlidersIcon },
  { id: 'trapper', label: 'Trapper', icon: CameraIcon },
  { id: 'zooniverse', label: 'Zooniverse', icon: GlobeIcon },
  { id: 'sequences', label: 'Sequences', icon: LayersIcon },
]

/** One setting: its name and what it does on the left, its controls on the
 * right — stacked on narrow screens. */
function Row({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[13rem_1fr] gap-x-10 gap-y-3 py-5">
      <div className="md:text-right">
        <div className="text-base text-zinc-800 dark:text-zinc-200">{label}</div>
        {description && <p className={`${hintClass} mt-1 leading-relaxed`}>{description}</p>}
      </div>
      <div className="space-y-3 min-w-0">{children}</div>
    </div>
  )
}

/** A filled, rounded field with its label inside, above the value. */
function BoxField({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <div>
      <label className={[
        'block rounded-xl px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border transition-colors',
        'focus-within:border-blue-500',
        error ? 'border-red-500' : 'border-transparent',
      ].join(' ')}>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
        {children}
      </label>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1 px-1">{error}</p>}
    </div>
  )
}

const boxInput = 'block w-full bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none py-0.5'

function TextBox({ label, value, onChange, type = 'text', placeholder, mono }: {
  label: string; value: string; onChange: (v: string) => void; type?: 'text' | 'password'; placeholder?: string; mono?: boolean
}) {
  return (
    <BoxField label={label}>
      <input
        type={type} className={`${boxInput} ${mono ? 'font-mono text-sm' : ''}`} value={value} placeholder={placeholder} aria-label={label}
        onChange={(e) => onChange(e.target.value)} autoComplete={type === 'password' ? 'new-password' : 'off'}
      />
    </BoxField>
  )
}

function NumberBox({ label, value, limits, onChange, unit }: {
  label: string; value: string; limits: Limits; onChange: (v: string) => void; unit?: string
}) {
  const invalid = numberIn(value, limits) === null
  const range = limits.max === LIMITS.positive.max ? `at least ${limits.min}` : `from ${limits.min} to ${limits.max}`
  return (
    <BoxField label={label} error={invalid ? `${limits.decimal ? 'A number' : 'A whole number'} ${range}.` : null}>
      <span className="flex items-baseline gap-2">
        <input
          className={boxInput} inputMode={limits.decimal ? 'decimal' : 'numeric'} value={value} aria-invalid={invalid} aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && <span className={hintClass}>{unit}</span>}
      </span>
    </BoxField>
  )
}

const LOG_LEVELS: { value: LogLevel; label: string; hint: string }[] = [
  { value: 'ERROR', label: 'Error', hint: 'Only what went wrong.' },
  { value: 'WARNING', label: 'Warning', hint: 'Also what may be wrong: retries, failed images…' },
  { value: 'INFO', label: 'Info', hint: 'Also what the app does: each upload, download, export… started and finished.' },
  { value: 'DEBUG', label: 'Debug', hint: 'Everything: each image downloaded and uploaded, each Trapper and Zooniverse query, full tracebacks. Big logs — for tracking a problem down.' },
]

/** A filled, rounded select with its label inside — like BoxField. */
function SelectBox<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <BoxField label={label}>
      <select
        className={`${boxInput} cursor-pointer`} value={value} aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </BoxField>
  )
}

function CheckOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer py-1">
      <input
        type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 rounded-md accent-blue-600 cursor-pointer"
      />
      <span className="text-base text-zinc-800 dark:text-zinc-200">{label}</span>
    </label>
  )
}

// ── The page ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

/** Edits the app's own settings.toml, one section at a time: the Trapper
 * and Zooniverse accounts and how an upload transfers images, and the
 * sequence criteria new runs start from. One Save saves every section. */
export default function SettingsPage({ onClose }: Props) {
  const [section, setSection] = useState<SectionId>('general')
  const [saved, setSaved] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' })
  const [clearLog, setClearLog] = useState<{ kind: 'idle' | 'confirming' | 'clearing' | 'cleared' | 'error'; message?: string }>(
    { kind: 'idle' },
  )

  async function handleClearLog() {
    setClearLog({ kind: 'clearing' })
    try {
      await api.clearLog()
      setClearLog({ kind: 'cleared' })
    } catch (e) {
      setClearLog({ kind: 'error', message: e instanceof Error ? e.message : 'Could not clear the log.' })
    }
  }

  useEffect(() => {
    api.getSettings()
      .then((s) => { setSaved(s); setDraft(toDraft(s)) })
      .catch((e) => setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the settings.' }))
  }, [])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d && { ...d, [key]: value }))
    setStatus({ kind: 'idle' })
  }
  const text = (key: NumberKey) => (v: string) => set(key, v)
  const flag = (key: BoolKey) => (v: boolean) => set(key, v)

  const update = draft && toUpdate(draft)

  async function handleSave() {
    if (!update) return
    setStatus({ kind: 'saving' })
    try {
      const result = await api.saveSettings(update)
      setSaved(result)
      setDraft(toDraft(result))
      setStatus({ kind: 'saved' })
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save the settings.' })
    }
  }

  const passwordHint = (has: boolean) => (has ? 'A password is saved — leave it blank to keep it.' : 'No password saved yet.')
  const current = SECTIONS.find((s) => s.id === section)!

  return (
    <div className="mx-auto px-4 py-6 flex flex-col md:flex-row gap-6" style={{ maxWidth: 1000 }}>
      {/* Sidebar */}
      <nav className="md:w-56 shrink-0 md:border-r border-zinc-200 dark:border-zinc-800 md:pr-5" aria-label="Settings sections">
        <button
          type="button" onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 mb-3 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <BackIcon />Back
        </button>
        <ul className="flex md:flex-col gap-2 overflow-x-auto">
          {SECTIONS.map(({ id, label, icon: SectionIcon }) => {
            const active = id === section
            const invalid = draft !== null && !sectionValid(draft, id)
            return (
              <li key={id} className="shrink-0">
                <button
                  type="button" onClick={() => setSection(id)} aria-current={active ? 'page' : undefined}
                  className={[
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-colors',
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  ].join(' ')}
                >
                  <SectionIcon />
                  <span>{label}</span>
                  {invalid && <span className="ml-auto w-2 h-2 rounded-full bg-red-500" title="Has an invalid value" />}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Section */}
      <div className="flex-1 min-w-0">
        <h4 className="text-2xl font-semibold mb-2">{current.label}</h4>

        {!draft && status.kind !== 'error' && <p className="text-sm text-zinc-500 dark:text-zinc-400 py-5">Loading…</p>}

        {draft && saved && section === 'general' && (
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            <Row
              label="Log level"
              description="How much the app writes to its log — raise it to Debug to track a problem down, then lower it again. Applied as soon as it's saved."
            >
              <SelectBox
                label="Level" value={draft.logLevel} options={LOG_LEVELS}
                onChange={(v) => set('logLevel', v)}
              />
              <p className={`${hintClass} px-1`}>{LOG_LEVELS.find((l) => l.value === draft.logLevel)?.hint}</p>
              {saved.GENERAL.log_level_override && (
                <p className="text-xs text-amber-700 dark:text-amber-400 px-1">
                  The environment variable <span className="font-mono">WILDINTEL_ZOONIVERSE_WEB_LOG_LEVEL</span> sets it
                  to <strong>{saved.GENERAL.log_level_override}</strong> for now — it wins over this setting.
                </p>
              )}
            </Row>
            <Row label="Log file" description="Rotated at 5 MB, keeping the last 5. Attach it to a bug report.">
              <BoxField label="Location">
                <span className="block font-mono text-sm text-zinc-900 dark:text-zinc-100 break-all py-0.5">{saved.GENERAL.log_file}</span>
              </BoxField>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/settings/log" download
                  className="inline-flex items-center px-4 py-2 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Download log
                </a>
                {clearLog.kind !== 'confirming' && (
                  <button
                    type="button" disabled={clearLog.kind === 'clearing'} onClick={() => setClearLog({ kind: 'confirming' })}
                    className="inline-flex items-center px-4 py-2 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50"
                  >
                    {clearLog.kind === 'clearing' ? 'Clearing…' : 'Clear log'}
                  </button>
                )}
              </div>
              {clearLog.kind === 'confirming' && (
                <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <p>Delete the log file and its older copies? This can&rsquo;t be undone — download it first if you need it.</p>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={handleClearLog} className="px-4 py-1.5 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors">
                      Yes, clear it
                    </button>
                    <button type="button" onClick={() => setClearLog({ kind: 'idle' })} className="px-4 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {clearLog.kind === 'cleared' && <p className="text-xs text-emerald-700 dark:text-emerald-400 px-1">Log cleared — a new one starts now.</p>}
              {clearLog.kind === 'error' && <p className="text-xs text-red-600 dark:text-red-400 px-1">{clearLog.message}</p>}
            </Row>
          </div>
        )}

        {draft && saved && section === 'trapper' && (
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            <Row label="Server" description="The Trapper instance images are fetched from.">
              <TextBox label="URL" value={draft.trapperUrl} onChange={(v) => set('trapperUrl', v)} placeholder="https://trapper.example.org" mono />
            </Row>
            <Row label="Account" description={passwordHint(saved.TRAPPER.has_password)}>
              <TextBox label="Username" value={draft.trapperUser} onChange={(v) => set('trapperUser', v)} />
              <TextBox label="Password" type="password" value={draft.trapperPassword} onChange={(v) => set('trapperPassword', v)} />
            </Row>
            <Row label="Downloads" description="How an upload downloads each image from Trapper. Each retry waits twice as long as the one before.">
              <NumberBox label="Parallel downloads" value={draft.downloadWorkers} limits={LIMITS.workers} onChange={text('downloadWorkers')} unit="at once" />
              <NumberBox label="Attempts per download" value={draft.downloadAttempts} limits={LIMITS.attempts} onChange={text('downloadAttempts')} unit="including the first" />
              <NumberBox label="Seconds between retries" value={draft.downloadDelay} limits={LIMITS.delay} onChange={text('downloadDelay')} unit="before the first retry" />
            </Row>
          </div>
        )}

        {draft && saved && section === 'zooniverse' && (
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            <Row label="Account" description={passwordHint(saved.ZOONIVERSE.has_password)}>
              <TextBox label="Username" value={draft.zooUser} onChange={(v) => set('zooUser', v)} />
              <TextBox label="Password" type="password" value={draft.zooPassword} onChange={(v) => set('zooPassword', v)} />
            </Row>
            <Row label="Transfers" description="How images are uploaded to Zooniverse — and downloaded from it by Download subject sets (Utils). Each retry waits twice as long as the one before.">
              <NumberBox label="Parallel uploads" value={draft.uploadWorkers} limits={LIMITS.workers} onChange={text('uploadWorkers')} unit="at once — downloads too" />
              <NumberBox label="Attempts per upload" value={draft.uploadAttempts} limits={LIMITS.attempts} onChange={text('uploadAttempts')} unit="including the first — per download too" />
              <NumberBox label="Seconds between retries" value={draft.uploadDelay} limits={LIMITS.delay} onChange={text('uploadDelay')} unit="before the first retry" />
            </Row>
            <Row label="Classifications export" description="The CSV of observations Retrieve classifications writes for Trapper's import.">
              <BoxField label="Classified by" error={draft.exportClassifiedBy.trim() ? null : 'Who the observations are classified by, in Trapper.'}>
                <input
                  className={boxInput} value={draft.exportClassifiedBy} aria-label="Classified by"
                  onChange={(e) => set('exportClassifiedBy', e.target.value)}
                />
              </BoxField>
              <NumberBox label="Largest CSV" value={draft.exportMaxSizeMb} limits={LIMITS.fileSizeMb} onChange={text('exportMaxSizeMb')} unit="MB — bigger exports are split" />
            </Row>
          </div>
        )}

        {draft && saved && section === 'sequences' && (
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            <p className={`${hintClass} pb-3`}>
              What a new run&rsquo;s filters start from — each run can still change its own on the Filters step.
            </p>
            <Row label="Sequences" description="A longer gap between two consecutive images starts a new sequence. A few evenly spaced images of each are kept, first and last included.">
              <NumberBox label="Max. gap within a sequence" value={draft.maxInterval} limits={LIMITS.positive} onChange={text('maxInterval')} unit="seconds" />
              <NumberBox label="Images per sequence" value={draft.imagesPerSequence} limits={LIMITS.positive} onChange={text('imagesPerSequence')} />
            </Row>
            <Row label="Images" description={'Skip images with no observation, or only "unclassified" ones.'}>
              <CheckOption label="Only classified images" checked={draft.onlyClassified} onChange={flag('onlyClassified')} />
            </Row>
            <Row label="Middle sequences" description="A deployment's first and last sequences (setting up and collecting the camera) keep them.">
              <CheckOption label="Remove humans" checked={draft.removeHumans} onChange={flag('removeHumans')} />
              <CheckOption label="Remove vehicles" checked={draft.removeVehicles} onChange={flag('removeVehicles')} />
            </Row>
          </div>
        )}

        <div className="flex items-center justify-end gap-4 pt-5 mt-2 border-t border-zinc-200 dark:border-zinc-800">
          {status.kind === 'error' && <p className="text-sm text-red-600 dark:text-red-400 mr-auto">{status.message}</p>}
          {status.kind === 'saved' && <p className="text-sm text-emerald-700 dark:text-emerald-400 mr-auto">Settings saved.</p>}
          {draft && !update && <p className="text-sm text-red-600 dark:text-red-400 mr-auto">Fix the values marked in red first.</p>}
          <button type="button" className={btnPrimary} disabled={!update || status.kind === 'saving'} onClick={handleSave}>
            {status.kind === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
