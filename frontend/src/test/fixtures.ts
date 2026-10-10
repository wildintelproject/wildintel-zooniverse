import { DEFAULT_CRITERIA } from '../types'
import type { AppSettings, DeploymentCounts, SessionSummary, TrapperSelection, ZooniverseDestination } from '../types'

export const RESEARCH_PROJECTS = [{ pk: 2, name: 'Doñana', acronym: 'DONA' }]
export const CLASSIFICATION_PROJECTS = [{ pk: 10, name: 'Main CP', is_active: true }]
export const COLLECTIONS = [
  { pk: 33, name: 'R0033', status: 'Public', total_count: 100, classified_count: 80, approved_count: 70 },
]
export const DEPLOYMENTS = [
  { pk: 4, deployment_id: 'R0033-DONA_0001_A', location_id: 'DONA_0001_A', start_date: '2024-09-04T13:10:00', end_date: '2024-11-04T14:28:00', image_count: 150 },
  { pk: 5, deployment_id: 'R0033-DONA_0007_B', location_id: 'DONA_0007_B', start_date: '2024-09-05T10:00:00', end_date: '2024-11-05T10:00:00', image_count: 200 },
]

export const SELECTION: TrapperSelection = {
  url: 'https://trapper.example.org',
  research_project: { pk: 2, name: 'Doñana' },
  classification_project: { pk: 10, name: 'Main CP' },
  collection: { pk: 33, name: 'R0033' },
  deployments: [{ pk: 4, deployment_id: 'R0033-DONA_0001_A' }, { pk: 5, deployment_id: 'R0033-DONA_0007_B' }],
  all_deployments: true,
}

export const SESSION: SessionSummary = {
  task_id: 'task-1', created_at: '2026-09-25T10:00:00+00:00', phase: 'selected', status: 'done', error: null,
  task: 'upload', source_type: 'trapper', selection: SELECTION,
}

export const FILTERED_SESSION: SessionSummary = {
  ...SESSION, phase: 'filtered', criteria: { ...DEFAULT_CRITERIA, max_interval: 120 },
}

export const PREVIEW_ROWS: DeploymentCounts[] = [
  { deployment_id: 'R0033-DONA_0001_A', images: 150, candidates: 120, sequences: 30, removed_middle: 4, selected: 90 },
  { deployment_id: 'R0033-DONA_0007_B', images: 200, candidates: 180, sequences: 40, removed_middle: 0, selected: 130 },
]

export const ZOONIVERSE_PROJECTS = [
  { id: 30567, display_name: 'European Camera Trap Project', slug: 'wildintel/european-camera-trap-project' },
  { id: 12188, display_name: 'Iberian Camera Trap Project', slug: 'aicensusuhu/iberian-camera-trap-project' },
]

export const SUBJECT_SETS = [
  { id: 134791, display_name: 'Doñana_2_R0033_33_2026-03', subjects_count: 86878 },
  { id: 128950, display_name: 'Kittehs', subjects_count: 30 },
]

export const DESTINATION: ZooniverseDestination = {
  project: { id: 30567, name: 'European Camera Trap Project', slug: 'wildintel/european-camera-trap-project' },
  subject_set_name: 'Doñana_2_R0033_33_2026-03',
}

export const DESTINATION_SESSION: SessionSummary = { ...FILTERED_SESSION, phase: 'destination', destination: DESTINATION }

export const APP_SETTINGS: AppSettings = {
  GENERAL: { log_level: 'INFO', log_file: '/home/me/.config/wildintel-zooniverse/logs/wildintel-zooniverse.log', log_level_override: null },
  TRAPPER: {
    base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true,
    download_workers: 4, download_attempts: 5, download_retry_delay: 15,
  },
  ZOONIVERSE: {
    user_name: null, has_password: false, upload_workers: 4, upload_attempts: 5, upload_retry_delay: 30,
    export_classified_by: 'zooniverse@wildintel-project.org', export_max_file_size_mb: 1.5, export_output_dir: null,
  },
  SEQUENCES: DEFAULT_CRITERIA,
}
