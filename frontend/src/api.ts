import type {
  AppSettings, AppSettingsUpdate, ConfigInfo, UpdateCheck, ClassificationProject, DownloadEvent, ExportEvent, MetadataEvent, Collection, Deployment, DeploymentCounts, PreviewEvent, ResearchProject, SessionSummary,
  TrapperImportEvent, TrapperSelection, UploadCriteria, UploadEvent, ValidationEvent, ZooniverseDestination, ZooniverseProject, ZooniverseSubjectSet,
  ZooniverseSubjectInfo, ZooniverseWorkflow,
} from './types'

/** A failed response's message — FastAPI's `detail` when there is one. */
async function errorMessage(r: Response): Promise<string> {
  const text = await r.text().catch(() => r.statusText)
  let message = text
  try { message = JSON.parse(text).detail ?? text } catch { /* not JSON */ }
  return typeof message === 'string' ? message : JSON.stringify(message)
}

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options)
  if (!r.ok) throw new Error(await errorMessage(r))
  return r.json() as Promise<T>
}

function post<T>(url: string, body: unknown): Promise<T> {
  return req<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** POSTs body and reads the response as NDJSON: every event goes to
 * onEvent; resolves on {"type": "done"}, rejects on {"type": "error"} — or
 * with endedEarly if the stream ends before either. */
async function streamNdjson<E extends { type: string }>(
  url: string, body: unknown, onEvent: (event: E) => void, endedEarly: string, signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!r.ok || !r.body) throw new Error(await errorMessage(r))
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line) as E
      if (event.type === 'error') throw new Error((event as unknown as { detail: string }).detail)
      onEvent(event)
      if (event.type === 'done') return
    }
  }
  throw new Error(endedEarly)
}

/** Blank fields fall back to what's saved in settings.toml (the password is
 * never sent back to the frontend — see services.trapper_service). */
export interface TrapperCredentials {
  url: string
  username: string
  password: string
}

/** Blank fields fall back to what's saved in settings.toml, as for Trapper. */
export interface ZooniverseCredentials {
  username: string
  password: string
}

/** A utility's whitelist (null: none) and blacklist of subject ids. */
export interface SubjectLists {
  include: number[] | null
  exclude: number[]
}

const NO_SUBJECT_LISTS: SubjectLists = { include: null, exclude: [] }

export interface UploadOptions {
  /** Also skip the images already in the subject set, whoever uploaded
   * them — slow: all its subjects are listed first. */
  skipInSubjectSet?: boolean
}

export const api = {
  checkHealth: async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/health')
      return r.ok
    } catch {
      return false
    }
  },

  checkVersion: () => req<{ current: string }>('/api/version'),

  // Asks GitHub whether a newer release exists (only when the user presses the button).
  checkForUpdate: () => req<UpdateCheck>('/api/version/check'),

  trapperGetConfig: () =>
    req<{ base_url: string | null; user_name: string | null; has_password: boolean }>('/api/trapper/config'),

  trapperTestConnection: (creds: TrapperCredentials) =>
    post<{ ok: boolean; research_projects_count: number }>('/api/trapper/test-connection', creds),

  trapperResearchProjects: (creds: TrapperCredentials) =>
    post<{ results: ResearchProject[] }>('/api/trapper/research-projects', creds),

  trapperClassificationProjects: (creds: TrapperCredentials, researchProjectPk: number) =>
    post<{ results: ClassificationProject[] }>('/api/trapper/classification-projects', {
      ...creds, research_project_pk: researchProjectPk,
    }),

  trapperCollections: (creds: TrapperCredentials, classificationProjectPk: number) =>
    post<{ results: Collection[] }>('/api/trapper/collections', {
      ...creds, classification_project_pk: classificationProjectPk,
    }),

  // The research project's deployments with images in the collection, each
  // with how many it has there.
  trapperDeployments: (creds: TrapperCredentials, researchProjectPk: number, collectionPk: number) =>
    post<{ results: Deployment[] }>('/api/trapper/deployments', {
      ...creds, research_project_pk: researchProjectPk, collection_pk: collectionPk,
    }),

  // How many of the selection's images the criteria keep — onDeployment
  // gets each deployment's counts as soon as the backend has them (an NDJSON
  // stream); resolves once every deployment is counted. Blank credentials:
  // the ones saved when the connection was tested.
  // With detail, each deployment also lists its sequences and what became
  // of each image — wildintel-tools' analyze-sequences.
  // taskId (once the Selection step has saved one): each deployment's
  // images/observations are cached for the rest of the session, so tweaking
  // the criteria and previewing again doesn't ask Trapper for them again.
  trapperUploadPreview: (
    selection: TrapperSelection, criteria: UploadCriteria,
    onDeployment: (counts: DeploymentCounts) => void, signal?: AbortSignal, detail = false, taskId?: string,
  ): Promise<void> =>
    streamNdjson<PreviewEvent>(
      '/api/trapper/upload-preview', { url: selection.url, selection, criteria, detail, task_id: taskId ?? null },
      (event) => { if (event.type === 'deployment') onDeployment(event) },
      'The preview stopped before every deployment was counted.', signal,
    ),

  // Runs the session's upload without uploading anything: every event
  // (start, each deployment, each image, done) goes to onEvent as the
  // backend streams it; resolves after "done". Blank credentials: the ones
  // saved when each connection was tested.
  uploadDryRun: (
    taskId: string, onEvent: (event: UploadEvent) => void, signal?: AbortSignal, options: UploadOptions = {},
  ): Promise<void> =>
    streamNdjson<UploadEvent>(
      '/api/upload/dry-run', { task_id: taskId, skip_in_subject_set: options.skipInSubjectSet ?? false }, onEvent,
      'The dry run stopped before it finished.', signal,
    ),

  // Uploads the session's images for real — the same events as the dry
  // run. Aborting the request stops the upload (images already uploaded
  // stay, and are skipped next time).
  uploadStart: (
    taskId: string, onEvent: (event: UploadEvent) => void, signal?: AbortSignal, options: UploadOptions = {},
  ): Promise<void> =>
    streamNdjson<UploadEvent>(
      '/api/upload/start', { task_id: taskId, skip_in_subject_set: options.skipInSubjectSet ?? false }, onEvent,
      'The connection to the upload was lost before it finished.', signal,
    ),

  zooniverseGetConfig: () =>
    req<{ user_name: string | null; has_password: boolean }>('/api/zooniverse/config'),

  zooniverseTestConnection: (creds: ZooniverseCredentials) =>
    post<{ ok: boolean; login: string; display_name: string }>('/api/zooniverse/test-connection', creds),

  // The projects the user owns or collaborates on.
  zooniverseProjects: (creds: ZooniverseCredentials) =>
    post<{ results: ZooniverseProject[] }>('/api/zooniverse/projects', creds),

  zooniverseSubjectSets: (creds: ZooniverseCredentials, projectId: number) =>
    post<{ results: ZooniverseSubjectSet[] }>('/api/zooniverse/subject-sets', { ...creds, project_id: projectId }),

  // Subjects by id — those not found (or not visible) come back apart.
  zooniverseLookupSubjects: (creds: ZooniverseCredentials, subjectIds: number[]) =>
    post<{ subjects: ZooniverseSubjectInfo[]; not_found: number[] }>(
      '/api/zooniverse/subjects/lookup', { ...creds, subject_ids: subjectIds },
    ),

  // One page of a subject set's subjects.
  zooniverseSubjectSetPage: (creds: ZooniverseCredentials, subjectSetId: number, page: number) =>
    post<{ subjects: ZooniverseSubjectInfo[]; page: number; page_count: number; count: number; page_size: number }>(
      '/api/zooniverse/subjects/page', { ...creds, subject_set_id: subjectSetId, page },
    ),

  zooniverseDownloadDefaults: () => req<{ output_dir: string }>('/api/zooniverse/download-defaults'),

  // Downloads the subject sets' images into outputDir (blank: the app's own
  // downloads folder), one folder per subject set — every event goes to
  // onEvent as the backend streams it. Aborting stops the download.
  zooniverseDownloadSubjectSets: (
    creds: ZooniverseCredentials, subjectSetIds: number[], outputDir: string, overwrite: boolean,
    onEvent: (event: DownloadEvent) => void, signal?: AbortSignal, subjects: SubjectLists = NO_SUBJECT_LISTS,
  ): Promise<void> =>
    streamNdjson<DownloadEvent>(
      '/api/zooniverse/download-subject-sets',
      {
        ...creds, subject_set_ids: subjectSetIds, output_dir: outputDir, overwrite,
        include_subjects: subjects.include, exclude_subjects: subjects.exclude,
      }, onEvent,
      'The connection to the download was lost before it finished.', signal,
    ),

  // Validates a subject set — compared with what an upload of `trapper`
  // would send, when given. Every event goes to onEvent as streamed. Blank
  // credentials: the saved ones.
  validateSubjectSet: (
    creds: ZooniverseCredentials, subjectSetId: number,
    trapper: { selection: TrapperSelection; criteria: UploadCriteria } | null,
    onEvent: (event: ValidationEvent) => void, signal?: AbortSignal,
  ): Promise<void> =>
    streamNdjson<ValidationEvent>(
      '/api/validation/subject-set',
      { ...creds, subject_set_id: subjectSetId, trapper: trapper && { url: trapper.selection.url, ...trapper } }, onEvent,
      'The validation stopped before it finished.', signal,
    ),

  // Rebuilds the subject set's metadata from the Trapper selection — or,
  // as a dry run, only reports what it would change. Every event goes to
  // onEvent as streamed; aborting stops it.
  updateMetadata: (
    creds: ZooniverseCredentials, subjectSetId: number, selection: TrapperSelection, dryRun: boolean,
    onEvent: (event: MetadataEvent) => void, signal?: AbortSignal, subjects: SubjectLists = NO_SUBJECT_LISTS,
  ): Promise<void> =>
    streamNdjson<MetadataEvent>(
      '/api/metadata/update',
      {
        ...creds, subject_set_id: subjectSetId, trapper: { url: selection.url, selection }, dry_run: dryRun,
        include_subjects: subjects.include, exclude_subjects: subjects.exclude,
      }, onEvent,
      'The metadata update stopped before it finished.', signal,
    ),

  zooniverseWorkflows: (creds: ZooniverseCredentials, projectId: number) =>
    post<{ results: ZooniverseWorkflow[] }>('/api/zooniverse/workflows', { ...creds, project_id: projectId }),

  // The workflow's latest classifications export, or null if it has none:
  // when it was requested, when its file was made (null if there is none —
  // not to be told from "state", which can stay "creating" with the file
  // there) and whether a request is pending.
  zooniverseWorkflowExport: (creds: ZooniverseCredentials, workflowId: number) =>
    post<{ export: WorkflowExport | null }>(
      '/api/zooniverse/workflow-export', { ...creds, workflow_id: workflowId },
    ),

  // Writes the workflow's classifications as a Trapper observations CSV —
  // into the settings' folder, classified by the settings' account — every event goes to onEvent as streamed; aborting stops it.
  exportClassifications: (
    creds: ZooniverseCredentials, workflowId: number, selection: TrapperSelection,
    options: { regenerate: boolean; saveZooAnnotations: boolean; saveRawExport: boolean },
    onEvent: (event: ExportEvent) => void, signal?: AbortSignal,
  ): Promise<void> =>
    streamNdjson<ExportEvent>(
      '/api/export/classifications',
      {
        ...creds, workflow_id: workflowId, trapper: { url: selection.url, selection },
        regenerate: options.regenerate, save_zoo_annotations: options.saveZooAnnotations,
        save_raw_export: options.saveRawExport,
      },
      onEvent, 'The export stopped before it finished.', signal,
    ),

  // Opens the settings' export folder — where the CSVs are — in the file manager.
  // An export's own folder, or — without a path — the export folder.
  openExportFolder: (path?: string) => post<{ ok: boolean; path: string }>('/api/export/open-folder', { path: path ?? null }),

  // Imports an export's CSVs into Trapper — only expert classifications,
  // as wildintel-tools did; approved only if asked. Blank credentials: the
  // saved ones. Every event goes to onEvent as streamed.
  importToTrapper: (
    trapperUrl: string, classificationProjectId: number, files: string[], approve: boolean,
    onEvent: (event: TrapperImportEvent) => void, signal?: AbortSignal,
  ): Promise<void> =>
    streamNdjson<TrapperImportEvent>(
      '/api/export/import',
      { url: trapperUrl, classification_project_id: classificationProjectId, files, approve }, onEvent,
      'The import stopped before it finished.', signal,
    ),

  getSettings: () => req<AppSettings>('/api/settings'),

  saveSettings: (settings: AppSettingsUpdate) =>
    req<AppSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  // Deletes the log file and its rotated copies — logging goes on, into a new one.
  clearLog: () => req<{ deleted: number }>('/api/settings/log', { method: 'DELETE' }),

  // The settings files the user can switch to (the default settings.toml plus the
  // ones created with addConfig); each one's file itself is downloaded straight
  // from /api/settings/configs/<id>/download.
  configs: () => req<ConfigInfo[]>('/api/settings/configs'),
  addConfig: (name: string) => post<ConfigInfo[]>('/api/settings/configs', { name }),
  activateConfig: (id: string) => post<ConfigInfo[]>(`/api/settings/configs/${encodeURIComponent(id)}/activate`, {}),
  openConfigFolder: (id: string) => post<{ ok: boolean }>(`/api/settings/configs/${encodeURIComponent(id)}/open-folder`, {}),

  listSessions: () => req<SessionSummary[]>('/api/sessions'),

  // Saves the chosen images into this run's session — creating it when
  // taskId is undefined (the response carries the new task_id).
  saveSelection: (selection: TrapperSelection, taskId?: string) =>
    post<SessionSummary>('/api/sessions/selection', { task_id: taskId ?? null, selection }),

  saveCriteria: (taskId: string, criteria: UploadCriteria) =>
    post<SessionSummary>('/api/sessions/criteria', { task_id: taskId, criteria }),

  saveDestination: (taskId: string, destination: ZooniverseDestination) =>
    post<SessionSummary>('/api/sessions/destination', { task_id: taskId, destination }),

  // The upload's whitelist (null: none) and blacklist of Trapper media ids.
  saveMediaLists: (taskId: string, include: number[] | null, exclude: number[]) =>
    post<SessionSummary>('/api/sessions/media-lists', { task_id: taskId, include, exclude }),

  discardSession: (taskId: string) =>
    req<{ status: string }>(`/api/sessions/${taskId}`, { method: 'DELETE' }),
}

export interface WorkflowExport {
  state: string | null
  pending: boolean
  updated_at: string | null
  file_date: string | null
}
