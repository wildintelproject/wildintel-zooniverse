export interface ResearchProject {
  pk: number
  name: string
  acronym?: string | null
}

export interface ClassificationProject {
  pk: number
  name: string
  is_active: boolean
}

export interface Collection {
  /** The collection's own pk (Trapper's collection_pk). */
  pk: number
  name: string
  status?: string | null
  total_count: number
  classified_count: number
  approved_count: number
}

export interface Deployment {
  pk: number
  deployment_id: string
  location_id?: string | null
  start_date?: string | null
  end_date?: string | null
  /** How many of its images are in the chosen collection. */
  image_count: number
}

export interface NamedRef {
  pk: number
  name: string
}

/** The Trapper images a run works on — never holds credentials. */
export interface TrapperSelection {
  url: string
  research_project: NamedRef
  classification_project: NamedRef
  collection: NamedRef
  deployments: { pk: number; deployment_id: string; image_count?: number | null }[]
  /** Whether every deployment of the collection was chosen. */
  all_deployments: boolean
}

/** Which of the selection's images get uploaded (see the backend's
 * services/sampling.py) — the defaults are wildintel-tools' own. */
export interface UploadCriteria {
  /** Seconds between consecutive images that keep them in one sequence. */
  max_interval: number
  images_per_sequence: number
  only_classified: boolean
  remove_middle_humans: boolean
  remove_middle_vehicles: boolean
  /** A sequence left with only "empty" images is reduced to its second one. */
  collapse_empty_sequences: boolean
}

export const DEFAULT_CRITERIA: UploadCriteria = {
  max_interval: 90,
  images_per_sequence: 5,
  only_classified: true,
  remove_middle_humans: true,
  remove_middle_vehicles: false,
  collapse_empty_sequences: false,
}

export interface PreviewCounts {
  images: number
  candidates: number
  sequences: number
  removed_middle: number
  selected: number
}

/** A sequence of a deployment, and what became of each of its images (by
 * media id) — the backend's sampling.SequenceDetail. */
export interface SequenceDetail {
  number: number
  start: string
  end: string
  duration_s: number
  images: number
  /** Every media id, in time order, whatever became of it — the fields
   * below group the same ids by status instead, each internally in time
   * order but not interleaved with the others. */
  order: number[]
  uploaded: number[]
  /** The sequence has more images than are kept from each. */
  not_sampled: number[]
  /** Removed from a middle sequence. */
  removed_human: number[]
  removed_vehicle: number[]
  /** All but the second image of an all-"empty" sequence. */
  collapsed_empty: number[]
}

export type DeploymentCounts = PreviewCounts & {
  deployment_id: string
  /** Only when the preview was asked for detail ("Analyze sequences"). */
  sequence_detail?: SequenceDetail[]
}

/** One line of the backend's NDJSON preview stream. */
export type PreviewEvent =
  | ({ type: 'deployment' } & DeploymentCounts)
  | { type: 'error'; detail: string }
  | { type: 'done' }

/** One image of an upload run — "uploaded" is only simulated in a dry run;
 * "skipped": an earlier run of the session already uploaded it. */
export interface ImageResult {
  media_id: number
  deployment_id: string
  file_name: string
  status: 'uploaded' | 'skipped' | 'failed'
  /** Why it was skipped: uploaded by an earlier run of the session, or
   * already in the subject set (only checked when asked). */
  reason?: 'session' | 'subject_set'
  /** Which step failed, and why. */
  step?: 'download' | 'upload'
  detail?: string
  subject_id?: string | null
}

/** One line of the backend's NDJSON upload stream (see its
 * services/upload_service.py). */
export type UploadEvent =
  /** subject_set.exists: whether it did before the run — a dry run leaves
   * its id null then, a real one creates it. */
  | { type: 'start'; dry_run: boolean; subject_set: { name: string; id: number | null; exists: boolean } }
  /** The subject set's subjects being listed, to skip the images already
   * in it — only when asked, and slow. */
  | { type: 'checking'; done: number; total: number }
  | { type: 'checked'; subjects: number; media: number }
  /** A deployment's images are being fetched from Trapper — each is
   * uploaded before the next one's are fetched. */
  | { type: 'fetching'; deployment_id: string }
  /** Its counts once fetched — "selected" is how many it uploads, after the
   * media lists ("filtered_out": what they left out). */
  | ({ type: 'deployment'; filtered_out?: number } & DeploymentCounts)
  /** An image's download, or its upload, has just started. */
  | { type: 'step'; step: 'download' | 'upload'; media_id: number; deployment_id: string; file_name: string }
  | ({ type: 'image' } & ImageResult)
  | { type: 'done'; dry_run: boolean; uploaded: number; skipped: number; failed: number; filtered_out?: number }
  | { type: 'error'; detail: string }

export interface ZooniverseProject {
  id: number
  display_name: string
  slug: string
}

export interface ZooniverseSubjectSet {
  id: number
  display_name: string
  subjects_count: number
}

/** Where a run's images go — never holds credentials. As wildintel-tools
 * does, a subject set of the project with this name is reused (subjects are
 * added to it); otherwise one is created. */
export interface ZooniverseDestination {
  project: { id: number; name: string; slug: string }
  subject_set_name: string
}

export type Task = 'upload' | 'download'
export type SourceType = 'trapper' | 'local'

/** One wizard run persisted on disk (see the backend's session_store). */
export interface SessionSummary {
  task_id: string
  created_at: string
  updated_at?: string
  /** "uploading": the upload started but didn't finish cleanly (stopped,
   * or with failures) — running it again skips what's already uploaded. */
  phase: 'selected' | 'filtered' | 'destination' | 'uploading'
  status: string
  error: string | null
  task: Task
  source_type: SourceType
  selection: TrapperSelection
  /** Set once the criteria step is done — kept if the selection changes. */
  criteria?: UploadCriteria
  /** Set once the Zooniverse step is done. */
  destination?: ZooniverseDestination
  /** How the last dry run of the upload went — it doesn't change the phase. */
  last_dry_run?: { finished_at: string; uploaded: number; skipped: number; failed: number; subject_set_id: number | null }
  /** The upload's whitelist/blacklist of Trapper media ids — include null:
   * no whitelist. */
  media_lists?: { include: number[] | null; exclude: number[] }
  /** The upload's last run — set once it has started. */
  upload?: {
    subject_set_id: number; started_at: string; finished_at: string | null
    uploaded?: number; skipped?: number; failed?: number
  }
}

/** The app's own settings.toml, as the settings page edits it — passwords
 * are never sent back: has_password says whether one is saved. */
export type LogLevel = 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG'

/** GET /api/version/check — whether a newer release exists. `error` is set when
 * that couldn't be found out (offline...), distinct from "up to date". */
export interface UpdateCheck {
  current: string
  latest: string | null
  update_available: boolean
  release_url: string | null
  download_url: string | null
  error: string | null
}

/** One settings file the app can run on (see the backend's config.ConfigInfo). */
export interface ConfigInfo {
  id: string
  name: string
  path: string
  active: boolean
}

export interface AppSettings {
  GENERAL: {
    log_level: LogLevel
    /** Where the log goes (read-only). */
    log_file: string
    /** The level WILDINTEL_ZOONIVERSE_WEB_LOG_LEVEL sets instead, if any. */
    log_level_override: LogLevel | null
  }
  TRAPPER: {
    base_url: string | null
    user_name: string | null
    has_password: boolean
    /** Images downloaded at once during an upload. */
    download_workers: number
    download_attempts: number
    /** Seconds before the first retry — each next one waits twice as long. */
    download_retry_delay: number
  }
  ZOONIVERSE: {
    user_name: string | null
    has_password: boolean
    upload_workers: number
    upload_attempts: number
    upload_retry_delay: number
    /** Who exported classifications are classified by, in Trapper. */
    export_classified_by: string
    /** Larger exports are split into several CSVs. */
    export_max_file_size_mb: number
  }
  /** The criteria a new wizard run starts from — each run can change its own. */
  SEQUENCES: UploadCriteria
}

/** What saving sends: a blank password keeps the saved one. */
export type AppSettingsUpdate = {
  GENERAL: { log_level: LogLevel }
  TRAPPER: Omit<AppSettings['TRAPPER'], 'has_password'> & { user_password: string }
  ZOONIVERSE: Omit<AppSettings['ZOONIVERSE'], 'has_password'> & { user_password: string }
  SEQUENCES: UploadCriteria
}

/** One line of the backend's NDJSON subject set download stream (see its
 * services/subject_download_service.py). */
export type DownloadEvent =
  /** A subject set starts — total is Zooniverse's own subject count. */
  | { type: 'subject_set'; id: number; name: string; total: number; folder: string }
  /** A subject's image starts downloading. */
  | { type: 'step'; subject_set_id: number; subject_id: number; file_name: string }
  /** "existing": already in the folder, so skipped. */
  /** "filtered_out": left out by the subject lists. */
  | { type: 'subject'; subject_set_id: number; subject_id: number; file_name: string; status: 'downloaded' | 'existing' | 'failed' | 'filtered_out'; detail?: string }
  | { type: 'done'; downloaded: number; existing: number; failed: number; filtered_out?: number; output_dir: string }
  | { type: 'error'; detail: string }

/** What validating a subject set found (see the backend's
 * services/validation_service.py) — the Trapper fields only when compared. */
export interface ValidationReport {
  subject_set: { id: number; name: string }
  subjects: number
  /** Distinct Trapper media among them. */
  media: number
  /** Every Trapper image in the subject set, with its subject(s) —
   * wildintel-tools' uploaded_media. */
  uploaded: { media_id: number; subject_ids: number[] }[]
  duplicated: { media_id: number; subject_ids: number[] }[]
  /** Subjects with no Trapper media id in their metadata. */
  unmatched: number[]
  metadata_issues: { subject_id: number; media_id: number | null; issues: string[] }[]
  compared: boolean
  expected?: number
  missing?: { media_id: number; deployment_id: string; file_name: string }[]
  extra?: { media_id: number; subject_ids: number[] }[]
  deployments?: { deployment_id: string; expected: number; uploaded: number; missing: number }[]
}

/** One line of the backend's NDJSON validation stream. */
export type ValidationEvent =
  | { type: 'subjects'; id: number; name: string; total: number }
  | { type: 'progress'; phase: 'subjects'; done: number }
  | { type: 'trapper'; total: number }
  | ({ type: 'deployment' } & DeploymentCounts)
  | ({ type: 'report' } & ValidationReport)
  | { type: 'done' }
  | { type: 'error'; detail: string }

/** One subject of an Update metadata run (see the backend's
 * services/metadata_service.py). */
export interface MetadataSubjectResult {
  subject_id: number
  media_id: number | null
  status: 'unchanged' | 'unmatched' | 'not_found' | 'would_update' | 'updated' | 'failed' | 'filtered_out'
  changes: { field: string; old: unknown; new: string }[]
  detail?: string
}

export type MetadataStatus = MetadataSubjectResult['status']

/** One line of the backend's NDJSON Update metadata stream. */
export type MetadataEvent =
  | { type: 'trapper'; total: number }
  | { type: 'deployment'; deployment_id: string; media: number }
  | { type: 'subjects'; id: number; name: string; total: number }
  | ({ type: 'subject' } & MetadataSubjectResult)
  | ({ type: 'done'; dry_run: boolean } & Record<MetadataStatus, number>)
  | { type: 'error'; detail: string }

export interface ZooniverseWorkflow {
  id: number
  display_name: string
  active: boolean
  /** Whether the app knows how to turn its classifications into
   * observations (the backend's services/annotations). */
  exportable: boolean
}

/** Why a subject's classifications weren't exported. */
export type ExportSkipReason = 'not_in_trapper' | 'no_media_id' | 'no_valid_classifications' | 'no_decision'

export interface ExportResult {
  workflow: { id: number; name: string }
  subjects: number
  exported: number
  observations: number
  rows: number
  skipped: Record<ExportSkipReason, number>
  /** A few subject ids per reason. */
  samples: Partial<Record<ExportSkipReason, number[]>>
  files: { path: string; rows: number; bytes: number }[]
  zoo_annotations_file: { path: string; rows: number; bytes: number } | null
  output_dir: string
  trapper_import_url: string
}

/** One line of the backend's NDJSON classifications export stream (see its
 * services/classifications_export_service.py). */
export type ExportEvent =
  | { type: 'export'; state: 'generating' | 'ready'; updated_at: string | null }
  | { type: 'classifications'; rows: number; bytes: number; total_bytes: number | null }
  | { type: 'classifications_done'; rows: number; subjects: number }
  | { type: 'trapper'; total: number }
  | { type: 'deployment'; deployment_id: string; media: number; observations: number }
  | { type: 'subjects'; total: number }
  | { type: 'progress'; done: number }
  | ({ type: 'done' } & ExportResult)
  | { type: 'error'; detail: string }

/** One line of the backend's NDJSON Trapper import stream (see its
 * services/trapper_import_service.py). */
export type TrapperImportEvent =
  | { type: 'file'; path: string; index: number; total: number }
  /** task_id: Trapper imports it in the background. */
  | { type: 'imported'; path: string; message: string | null; task_id: string | null }
  | { type: 'failed'; path: string; detail: string }
  | { type: 'done'; imported: number; failed: number }
  | { type: 'error'; detail: string }

/** A Zooniverse subject, as the Subjects utility shows it. */
export interface ZooniverseSubjectInfo {
  id: number
  /** Its image(s) — Zooniverse's own copies. */
  images: string[]
  metadata: Record<string, unknown>
  /** The subject sets it's in. */
  subject_sets: number[]
  created_at: string | null
  /** The Trapper image it is, if its metadata says. */
  media_id: number | null
}
