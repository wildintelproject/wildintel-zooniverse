import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ExportClassificationsPage from './ExportClassificationsPage'
import type { ExportEvent, ExportResult } from '../types'
import { APP_SETTINGS, CLASSIFICATION_PROJECTS, COLLECTIONS, DEPLOYMENTS, RESEARCH_PROJECTS, ZOONIVERSE_PROJECTS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(),
    zooniverseGetConfig: vi.fn(),
    zooniverseTestConnection: vi.fn(),
    zooniverseProjects: vi.fn(),
    zooniverseSubjectSets: vi.fn(),
    zooniverseWorkflows: vi.fn(),
    zooniverseWorkflowExport: vi.fn(),
    exportClassifications: vi.fn(),
    importToTrapper: vi.fn(),
    openExportFolder: vi.fn(),
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
  subjects: 5, trapper_media: 3, exported: 2, observations: 2, rows: 3,
  skipped: { not_in_trapper: 1, no_media_id: 1, no_valid_classifications: 1, no_decision: 0 },
  samples: { not_in_trapper: [502], no_media_id: [503], no_valid_classifications: [504] },
  files: [{ path: '/exports/observations_wf29186_cp10_col33_20260926-100000.csv', rows: 3, bytes: 900 }],
  zoo_annotations_file: { path: '/exports/zoo_annotations_observations_wf29186.csv', rows: 4, bytes: 300 },
  raw_export_file: { path: '/exports/wf29186_cp10_col33_20260926-100000/zooniverse_classifications_wf29186_20260926-100000.csv', bytes: 5 * 1024 * 1024 },
  output_dir: '/exports',
  run_dir: '/exports/wf29186_cp10_col33_20260926-100000',
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
  mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
  mockedApi.zooniverseGetConfig.mockResolvedValue({ user_name: 'SimSan', has_password: true })
  mockedApi.zooniverseTestConnection.mockResolvedValue({ ok: true, login: 'SimSan', display_name: 'SimSan' })
  mockedApi.zooniverseProjects.mockResolvedValue({ results: ZOONIVERSE_PROJECTS })
  mockedApi.zooniverseWorkflows.mockResolvedValue({ results: [
    { id: 29186, display_name: 'Doñana National Park', active: true, exportable: true },
    { id: 5, display_name: 'Old test workflow', active: false, exportable: false },
  ] })
  mockedApi.zooniverseWorkflowExport.mockResolvedValue({ export: { state: 'ready', pending: false, updated_at: '2026-09-20T10:00:00Z', file_date: '2026-09-20T10:00:00Z' } })
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true })
  mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 1 })
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: RESEARCH_PROJECTS })
  mockedApi.trapperClassificationProjects.mockResolvedValue({ results: CLASSIFICATION_PROJECTS })
  mockedApi.trapperCollections.mockResolvedValue({ results: COLLECTIONS })
  mockedApi.trapperDeployments.mockResolvedValue({ results: DEPLOYMENTS })
})

async function chooseWorkflow() {
  await userEvent.click(await screen.findByLabelText('Project'))
  await userEvent.click(await screen.findByRole('option', { name: /European Camera Trap Project/ }))
  await userEvent.click(await screen.findByLabelText('Workflow'))
  await userEvent.click(await screen.findByRole('option', { name: /Doñana National Park \(#29186\)/ }))
}

const next = () => userEvent.click(screen.getByRole('button', { name: /^next$/i }))

async function chooseTrapperImages() {
  await userEvent.type(await screen.findByLabelText('Research project'), 'Doñana')
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
  await userEvent.type(await screen.findByLabelText('Classification project'), 'Main')
  await userEvent.click(await screen.findByRole('option', { name: 'Main CP' }))
  await userEvent.click(await screen.findByLabelText('Collection'))
  await userEvent.click(await screen.findByRole('option', { name: /R0033/ }))
  await screen.findByText('R0033-DONA_0001_A')
}

/** The three steps, up to the summary with its Export CSV button. */
async function reachSummary() {
  await chooseWorkflow()
  await next()
  await chooseTrapperImages()
  await next()
}

describe('ExportClassificationsPage', () => {
  it("lists the project's workflows, only those it can vote enabled, and its latest export", async () => {
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()

    expect(mockedApi.zooniverseWorkflows).toHaveBeenCalledWith({ username: '', password: '' }, 30567)
    expect(await screen.findByText(/Classification export available/)).toBeInTheDocument()
    expect(screen.getByText('20 Sep 2026, 10:00 UTC')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /generate a new export/i })).not.toBeChecked()
    // Folder, classified by and CSV size come from the settings: nothing to ask here.
    expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Classified by')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Largest CSV (MB)')).not.toBeInTheDocument()
    // The export itself is the last step.
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument()
  })

  it('uses the saved connection: no credentials to fill in, and the projects load by themselves', async () => {
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()

    expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Trapper URL')).not.toBeInTheDocument()
    expect(mockedApi.zooniverseProjects).toHaveBeenCalledWith({ username: '', password: '' })
    // Trapper's research projects load once its step is reached.
    expect(mockedApi.trapperResearchProjects).not.toHaveBeenCalled()
    await next()
    await waitFor(() => expect(mockedApi.trapperResearchProjects).toHaveBeenCalledWith({ url: '', username: '', password: '' }))
  })

  it('shows a spinner in a dropdown while its options load, and filters them as you type', async () => {
    let resolve: (v: { results: typeof ZOONIVERSE_PROJECTS }) => void = () => {}
    mockedApi.zooniverseProjects.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<ExportClassificationsPage onBack={vi.fn()} />)

    const field = await screen.findByLabelText('Project')
    expect(field).toBeDisabled()
    expect(field).toHaveAttribute('placeholder', 'Loading your projects…')
    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0)

    await act(async () => resolve({ results: ZOONIVERSE_PROJECTS }))
    await waitFor(() => expect(field).toBeEnabled())
    await userEvent.type(field, 'iberian')
    expect(screen.getByRole('option', { name: /Iberian Camera Trap Project/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /European/ })).not.toBeInTheDocument()
  })

  it('doesn’t let a workflow that can’t be exported be chosen', async () => {
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByLabelText('Project'))
    await userEvent.click(await screen.findByRole('option', { name: /European Camera Trap Project/ }))
    await userEvent.click(await screen.findByLabelText('Workflow'))
    const old = await screen.findByRole('option', { name: /Old test workflow.*can.t be exported/ })
    expect(old).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(old)
    expect(mockedApi.zooniverseWorkflowExport).not.toHaveBeenCalled()
  })

  it('goes step by step: Zooniverse, Trapper images, then the summary and the export', async () => {
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await screen.findByLabelText('Project')
    expect(screen.getByRole('heading', { name: 'Zooniverse project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled() // no workflow yet

    // A tick for each choice: the project, then the workflow.
    expect(screen.queryByRole('img', { name: 'Done' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Project'))
    await userEvent.click(await screen.findByRole('option', { name: /European Camera Trap Project/ }))
    expect(screen.getAllByRole('img', { name: 'Done' })).toHaveLength(1)
    await userEvent.click(await screen.findByLabelText('Workflow'))
    await userEvent.click(await screen.findByRole('option', { name: /Doñana National Park \(#29186\)/ }))
    expect(screen.getAllByRole('img', { name: 'Done' })).toHaveLength(2)
    await next()
    expect(screen.getByRole('heading', { name: 'Trapper images' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled() // no images yet

    // The first step stays mounted (hidden): its two ticks are still there, and none of Trapper's yet.
    expect(screen.getAllByRole('img', { name: 'Done' })).toHaveLength(2)
    await chooseTrapperImages()
    // A tick for each of them: research project, classification project, collection, deployments.
    expect(screen.getAllByRole('img', { name: 'Done' })).toHaveLength(2 + 4)
    await next()
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument()
    expect(screen.getByText('European Camera Trap Project')).toBeInTheDocument()
    expect(screen.getAllByText(/Doñana National Park/).length).toBeGreaterThan(0)
    expect(screen.getByText(/The latest, of 20 Sep 2026, 10:00 UTC/)).toBeInTheDocument()
    expect(screen.getByText('Main CP')).toBeInTheDocument()
    expect(screen.getByText(/classified by zooniverse@wildintel-project.org/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export csv/i })).toBeEnabled()

    // Back keeps what was chosen.
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByLabelText('Collection')).toHaveDisplayValue(/R0033/)
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByLabelText('Workflow')).toHaveDisplayValue(/Doñana National Park/)
  })

  it('leaves for the task choice from its first step', async () => {
    const onBack = vi.fn()
    render(<ExportClassificationsPage onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('says when the workflow has no export yet', async () => {
    mockedApi.zooniverseWorkflowExport.mockResolvedValue({ export: null })
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()
    expect(await screen.findByText(/One will be made first/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /generate a new export/i })).not.toBeInTheDocument()
  })

  it('uses the file of an export Zooniverse still says is being created, and lets it be asked again', async () => {
    mockedApi.zooniverseWorkflowExport.mockResolvedValue({
      export: { state: 'creating', pending: true, updated_at: '2026-10-02T08:48:00Z', file_date: '2026-10-02T07:57:00Z' },
    })
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()
    expect(await screen.findByText(/Classification export available/)).toBeInTheDocument()
    expect(screen.getByText(/never finished — it can be asked again/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /generate a new export/i })).toBeEnabled()
  })

  it('doesn’t let a new export be asked for within 24 hours of the last request', async () => {
    const now = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    mockedApi.zooniverseWorkflowExport.mockResolvedValue({
      export: { state: 'creating', pending: true, updated_at: now, file_date: '2026-10-02T07:57:00Z' },
    })
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await chooseWorkflow()
    expect(await screen.findByText(/isn’t done yet — this one is used/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /generate a new export/i })).toBeDisabled()
    expect(screen.getByText(/once every 24 hours.*next request will be available on/)).toBeInTheDocument()
  })

  it('exports the CSV with its progress, then says how to import it into Trapper', async () => {
    const run = controlledExport()
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await reachSummary()
    await userEvent.click(screen.getByRole('checkbox', { name: /generate a new export/i }))
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))

    expect(mockedApi.exportClassifications).toHaveBeenCalledWith(
      { username: '', password: '' }, 29186, expect.objectContaining({ collection: { pk: 33, name: 'R0033' } }),
      { regenerate: true, saveZooAnnotations: true, saveRawExport: false },
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
    expect(screen.getByText('Images classified')).toBeInTheDocument()
    expect(screen.getByText('Subjects exported')).toBeInTheDocument()
    expect(screen.getByText(/Not in the Trapper selection/)).toBeInTheDocument()
    // The files aren't listed one by one: a summary, and a button to the folder.
    expect(screen.queryByText(/observations_wf29186_cp10_col33_20260926-100000\.csv/)).not.toBeInTheDocument()
    expect(screen.getByText(/3 rows · 900 KB.*plus the volunteers’ answers|3 rows · 1 KB.*plus the volunteers’ answers/)).toBeInTheDocument()
    mockedApi.openExportFolder.mockResolvedValue({ ok: true, path: '/exports' })
    expect(screen.getByText('/exports/wf29186_cp10_col33_20260926-100000')).toBeInTheDocument()
    expect(screen.getByText(/and Zooniverse’s CSV \(5\.0 MB\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /open folder/i }))
    // This export's own folder, not the export folder.
    expect(mockedApi.openExportFolder).toHaveBeenCalledWith('/exports/wf29186_cp10_col33_20260926-100000')
    // Imported into Trapper only when asked.
    expect(screen.getByRole('button', { name: 'Import into Trapper' })).toBeInTheDocument()
    expect(mockedApi.importToTrapper).not.toHaveBeenCalled()
  })

  it('keeps Zooniverse’s own CSV only when asked to', async () => {
    controlledExport()
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await reachSummary()
    expect(screen.getByRole('checkbox', { name: /keep zooniverse.s classifications csv/i })).not.toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: /keep zooniverse.s classifications csv/i }))
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))

    expect(mockedApi.exportClassifications).toHaveBeenCalledWith(
      expect.anything(), 29186, expect.anything(),
      { regenerate: false, saveZooAnnotations: true, saveRawExport: true },
      expect.any(Function), expect.any(AbortSignal),
    )
  })

  it('imports into Trapper right away when asked to', async () => {
    const run = controlledExport()
    mockedApi.importToTrapper.mockResolvedValue()
    render(<ExportClassificationsPage onBack={vi.fn()} />)
    await reachSummary()
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
    await reachSummary()
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))
    expect(await screen.findByText(/is not in classification project/)).toBeInTheDocument()
  })
})
