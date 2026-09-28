import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ExportClassificationsPage from './ExportClassificationsPage'
import type { ExportEvent, ExportResult } from '../types'
import { CLASSIFICATION_PROJECTS, COLLECTIONS, DEPLOYMENTS, RESEARCH_PROJECTS, ZOONIVERSE_PROJECTS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    zooniverseGetConfig: vi.fn(),
    zooniverseTestConnection: vi.fn(),
    zooniverseProjects: vi.fn(),
    zooniverseSubjectSets: vi.fn(),
    zooniverseWorkflows: vi.fn(),
    zooniverseWorkflowExport: vi.fn(),
    exportDefaults: vi.fn(),
    exportClassifications: vi.fn(),
    importToTrapper: vi.fn(),
    trapperGetConfig: vi.fn(),
    trapperTestConnection: vi.fn(),
    trapperResearchProjects: vi.fn(),
    trapperClassificationProjects: vi.fn(),
    trapperCollections: vi.fn(),
    trapperDeployments: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

const RESULT: ExportResult = {
  workflow: { id: 29186, name: 'Doñana National Park' },
  subjects: 5, exported: 2, observations: 2, rows: 3,
  skipped: { not_in_trapper: 1, no_media_id: 1, no_valid_classifications: 1, no_decision: 0 },
  samples: { not_in_trapper: [502], no_media_id: [503], no_valid_classifications: [504] },
  files: [{ path: '/exports/observations_wf29186_cp10_col33_20260926-100000.csv', rows: 3, bytes: 900 }],
  zoo_annotations_file: { path: '/exports/zoo_annotations_observations_wf29186.csv', rows: 4, bytes: 300 },
  output_dir: '/exports',
  trapper_import_url: 'https://trapper.example.org/media_classification/classification/import/',
}

function controlledExport() {
  const handle = { send: (_e: ExportEvent) => {}, finish: () => {} }
  mockedApi.exportClassifications.mockImplementation((_c, _wf, _sel, _opts, onEvent, signal) => new Promise<void>((resolve, reject) => {
    handle.send = (event) => act(() => onEvent(event))
    handle.finish = () => act(resolve)
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  return handle
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.zooniverseGetConfig.mockResolvedValue({ user_name: 'SimSan', has_password: true })
  mockedApi.zooniverseTestConnection.mockResolvedValue({ ok: true, login: 'SimSan', display_name: 'SimSan' })
  mockedApi.zooniverseProjects.mockResolvedValue({ results: ZOONIVERSE_PROJECTS })
  mockedApi.zooniverseWorkflows.mockResolvedValue({ results: [
    { id: 29186, display_name: 'Doñana National Park', active: true, exportable: true },
    { id: 5, display_name: 'Old test workflow', active: false, exportable: false },
  ] })
  mockedApi.zooniverseWorkflowExport.mockResolvedValue({ export: { state: 'ready', updated_at: '2026-09-20T10:00:00Z' } })
  mockedApi.exportDefaults.mockResolvedValue({ output_dir: '/exports', classified_by: 'zooniverse@wildintel-project.org', max_file_size_mb: 1.5 })
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true })
  mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 1 })
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: RESEARCH_PROJECTS })
  mockedApi.trapperClassificationProjects.mockResolvedValue({ results: CLASSIFICATION_PROJECTS })
  mockedApi.trapperCollections.mockResolvedValue({ results: COLLECTIONS })
  mockedApi.trapperDeployments.mockResolvedValue({ results: DEPLOYMENTS })
})

async function chooseWorkflow() {
  await userEvent.click(await screen.findByRole('button', { name: /test connection/i }))
  await userEvent.selectOptions(await screen.findByLabelText('Zooniverse project'), '30567')
  await userEvent.selectOptions(await screen.findByLabelText('Workflow'), '29186')
}

async function chooseTrapperImages() {
  await waitFor(() => expect(screen.getByLabelText('Trapper URL')).toHaveValue('https://trapper.example.org'))
  await userEvent.click(screen.getAllByRole('button', { name: /test connection/i })[1])
  await userEvent.type(await screen.findByLabelText('Research project'), 'Doñana')
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
  await userEvent.type(await screen.findByLabelText('Classification project'), 'Main')
  await userEvent.click(await screen.findByRole('option', { name: 'Main CP' }))
  await userEvent.selectOptions(await screen.findByLabelText('Collection'), '33')
  await screen.findByText('R0033-DONA_0001_A')
}

describe('ExportClassificationsPage', () => {
  it("lists the project's workflows, only those it can vote enabled, and its latest export", async () => {
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()

    expect(mockedApi.zooniverseWorkflows).toHaveBeenCalledWith({ username: 'SimSan', password: '' }, 30567)
    expect(screen.getByRole('option', { name: /Old test workflow.*can.t be exported/ })).toBeDisabled()
    expect(await screen.findByText(/Latest classifications export/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /make a new export first/i })).not.toBeChecked()
    expect(screen.getByLabelText('Folder')).toHaveValue('/exports')
    expect(screen.getByLabelText('Classified by')).toHaveValue('zooniverse@wildintel-project.org')
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled() // no Trapper images yet
  })

  it('says when the workflow has no export yet', async () => {
    mockedApi.zooniverseWorkflowExport.mockResolvedValue({ export: null })
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()
    expect(await screen.findByText(/no classifications export yet — one will be made first/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /make a new export first/i })).not.toBeInTheDocument()
  })

  it('exports the CSV with its progress, then says how to import it into Trapper', async () => {
    const run = controlledExport()
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()
    await chooseTrapperImages()
    await userEvent.click(screen.getByRole('checkbox', { name: /make a new export first/i }))
    await userEvent.clear(screen.getByLabelText('Largest CSV (MB)'))
    await userEvent.type(screen.getByLabelText('Largest CSV (MB)'), '2.5')
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))

    expect(mockedApi.exportClassifications).toHaveBeenCalledWith(
      { username: 'SimSan', password: '' }, 29186, expect.objectContaining({ collection: { pk: 33, name: 'R0033' } }),
      { outputDir: '/exports', regenerate: true, saveZooAnnotations: true, classifiedBy: 'zooniverse@wildintel-project.org', maxFileSizeMb: 2.5 },
      expect.any(Function), expect.any(AbortSignal),
    )

    run.send({ type: 'export', state: 'generating', updated_at: null })
    expect(screen.getByText(/Making a new classifications export/)).toBeInTheDocument()
    run.send({ type: 'export', state: 'ready', updated_at: '2026-09-26T09:00:00Z' })
    run.send({ type: 'classifications', rows: 5000, bytes: 512 * 1024, total_bytes: 1024 * 1024 })
    expect(screen.getByRole('progressbar', { name: 'Classifications downloaded' })).toHaveAttribute('aria-valuenow', '50')
    run.send({ type: 'classifications_done', rows: 8, subjects: 5 })
    run.send({ type: 'trapper', total: 2 })
    run.send({ type: 'deployment', deployment_id: 'R0033-DONA_0001_A', media: 3, observations: 4 })
    expect(screen.getByText('1 of 2 · 4 observations')).toBeInTheDocument()
    run.send({ type: 'subjects', total: 5 })
    run.send({ type: 'progress', done: 5 })
    run.send({ type: 'done', ...RESULT })
    await run.finish()

    expect(screen.getByText(/Export finished: 2 of 5 subjects → 3 CSV rows/)).toBeInTheDocument()
    expect(screen.getByText(/Not in the Trapper selection/)).toBeInTheDocument()
    expect(screen.getByText(/observations_wf29186_cp10_col33_20260926-100000\.csv/)).toBeInTheDocument()
    // Imported into Trapper only when asked.
    expect(screen.getByRole('button', { name: 'Import into Trapper' })).toBeInTheDocument()
    expect(mockedApi.importToTrapper).not.toHaveBeenCalled()
  })

  it('imports into Trapper right away when asked to', async () => {
    const run = controlledExport()
    mockedApi.importToTrapper.mockResolvedValue()
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()
    await chooseTrapperImages()
    await userEvent.click(screen.getByRole('checkbox', { name: /import into trapper when finished/i }))
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))
    run.send({ type: 'done', ...RESULT })
    await run.finish()

    await waitFor(() => expect(mockedApi.importToTrapper).toHaveBeenCalledWith(
      'https://trapper.example.org', 10, [RESULT.files[0].path], false, expect.any(Function), expect.any(AbortSignal),
    ))
  })

  it('shows why it failed', async () => {
    mockedApi.exportClassifications.mockRejectedValue(new Error('Collection 33 is not in classification project 10.'))
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()
    await chooseTrapperImages()
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))
    expect(await screen.findByText(/is not in classification project/)).toBeInTheDocument()
  })
})
