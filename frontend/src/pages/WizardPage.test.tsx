import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import WizardPage from './WizardPage'
import {
  APP_SETTINGS, CLASSIFICATION_PROJECTS, COLLECTIONS, DEPLOYMENTS, DESTINATION, DESTINATION_SESSION, FILTERED_SESSION, RESEARCH_PROJECTS,
  SESSION, SUBJECT_SETS, ZOONIVERSE_PROJECTS,
} from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    trapperGetConfig: vi.fn(),
    trapperTestConnection: vi.fn(),
    trapperResearchProjects: vi.fn(),
    trapperClassificationProjects: vi.fn(),
    trapperCollections: vi.fn(),
    trapperDeployments: vi.fn(),
    saveSelection: vi.fn(),
    saveCriteria: vi.fn(),
    saveDestination: vi.fn(),
    zooniverseGetConfig: vi.fn(),
    zooniverseTestConnection: vi.fn(),
    zooniverseProjects: vi.fn(),
    zooniverseSubjectSets: vi.fn(),
    trapperUploadPreview: vi.fn(),
    getSettings: vi.fn(),
    exportDefaults: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true })
  mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 1 })
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: RESEARCH_PROJECTS })
  mockedApi.trapperClassificationProjects.mockResolvedValue({ results: CLASSIFICATION_PROJECTS })
  mockedApi.trapperCollections.mockResolvedValue({ results: COLLECTIONS })
  mockedApi.trapperDeployments.mockResolvedValue({ results: DEPLOYMENTS })
  mockedApi.saveSelection.mockImplementation(async (selection, taskId) => ({ ...SESSION, task_id: taskId ?? 'new-task', selection }))
  mockedApi.saveCriteria.mockImplementation(async (taskId, criteria) => ({ ...SESSION, task_id: taskId, phase: 'filtered', criteria }))
  mockedApi.saveDestination.mockImplementation(async (taskId, destination) => (
    { ...FILTERED_SESSION, task_id: taskId, phase: 'destination', destination }
  ))
  mockedApi.zooniverseGetConfig.mockResolvedValue({ user_name: 'SimSan', has_password: true })
  mockedApi.zooniverseTestConnection.mockResolvedValue({ ok: true, login: 'SimSan', display_name: 'SimSan' })
  mockedApi.zooniverseProjects.mockResolvedValue({ results: ZOONIVERSE_PROJECTS })
  mockedApi.zooniverseSubjectSets.mockResolvedValue({ results: SUBJECT_SETS })
  mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
})

async function reachImagesStep() {
  await userEvent.click(screen.getByRole('button', { name: /upload images to zooniverse/i }))
  await userEvent.click(screen.getByRole('button', { name: /trapper instance/i }))
  await waitFor(() => expect(screen.getByLabelText('Trapper URL')).toHaveValue('https://trapper.example.org'))
}

async function chooseImages() {
  await userEvent.click(screen.getByRole('button', { name: /test connection/i }))
  await userEvent.type(await screen.findByLabelText('Research project'), 'Doñana')
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
  await userEvent.type(await screen.findByLabelText('Classification project'), 'Main')
  await userEvent.click(await screen.findByRole('option', { name: 'Main CP' }))
  await userEvent.selectOptions(await screen.findByLabelText('Collection'), '33')
  await screen.findByText('R0033-DONA_0001_A')
}

/** The Zooniverse step's own section — the Trapper form stays mounted
 * (hidden) too, with its own Username/Test Connection. */
function zooniverseStep() {
  return within(screen.getByText('Where to upload them').parentElement!)
}

describe('WizardPage', () => {
  it('offers both tasks', () => {
    render(<WizardPage />)
    expect(screen.getByRole('button', { name: /upload images to zooniverse/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /retrieve classifications/i })).toBeEnabled()
  })

  it('retrieving classifications opens its own page, and comes back', async () => {
    mockedApi.exportDefaults.mockResolvedValue({ output_dir: '/exports', classified_by: 'zoo@x.org', max_file_size_mb: 1.5 })
    render(<WizardPage />)
    await userEvent.click(screen.getByRole('button', { name: /retrieve classifications/i }))
    expect(screen.getByRole('heading', { name: 'Retrieve classifications' })).toBeInTheDocument()
    expect(screen.getByText('What do you want to do?').closest('.hidden')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.queryByRole('heading', { name: 'Retrieve classifications' })).not.toBeInTheDocument()
    expect(screen.getByText('What do you want to do?').closest('.hidden')).toBeNull()
  })

  it('opens the utilities from the first step, and comes back', async () => {
    render(<WizardPage />)
    await userEvent.click(screen.getByRole('button', { name: /utils/i }))

    expect(screen.getByRole('heading', { name: 'Utilities' })).toBeInTheDocument()
    // Hidden, not unmounted — the wizard keeps its state.
    expect(screen.getByText('What do you want to do?').closest('.hidden')).not.toBeNull()
    for (const name of [/Update metadata/, /Download subject sets/, /Validation & audit/]) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }

    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.queryByRole('heading', { name: 'Utilities' })).not.toBeInTheDocument()
    expect(screen.getByText('What do you want to do?').closest('.hidden')).toBeNull()
  })

  it('offers Trapper as the only available source for now', async () => {
    render(<WizardPage />)
    await userEvent.click(screen.getByRole('button', { name: /upload images to zooniverse/i }))
    expect(screen.getByRole('button', { name: /trapper instance/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /local files/i })).toBeDisabled()
  })

  it('saves the chosen images into a session and shows them on the filters step', async () => {
    render(<WizardPage />)
    await reachImagesStep()
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()

    await chooseImages()
    await userEvent.click(screen.getByRole('button', { name: /^next$/i }))

    expect(mockedApi.saveSelection).toHaveBeenCalledWith(expect.objectContaining({ all_deployments: true }), undefined)
    expect(await screen.findByText('Choose which images to upload')).toBeInTheDocument()
    expect(screen.getByText(/^All 2/)).toBeInTheDocument()
    expect(screen.getByText('· 350 images')).toBeInTheDocument()
    expect(screen.getByLabelText(/max\. gap within a sequence/i)).toHaveValue('90')
  })

  it("starts a new run's criteria from the settings page's own", async () => {
    mockedApi.getSettings.mockResolvedValue({
      ...APP_SETTINGS, SEQUENCES: { ...APP_SETTINGS.SEQUENCES, max_interval: 300, remove_middle_vehicles: true },
    })
    render(<WizardPage resumeSession={SESSION} />)
    expect(await screen.findByLabelText(/max\. gap within a sequence/i)).toHaveValue('300')
    expect(screen.getByRole('checkbox', { name: /remove vehicles/i })).toBeChecked()
  })

  it("keeps a resumed run's own criteria over the settings page's", async () => {
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, SEQUENCES: { ...APP_SETTINGS.SEQUENCES, max_interval: 300 } })
    render(<WizardPage resumeSession={{ ...FILTERED_SESSION, phase: 'selected' }} />)
    expect(await screen.findByLabelText(/max\. gap within a sequence/i)).toHaveValue('120')
  })

  it('saves the criteria into the session and goes on to the Zooniverse step', async () => {
    render(<WizardPage resumeSession={SESSION} />)
    await userEvent.clear(await screen.findByLabelText(/images per sequence/i))
    await userEvent.type(screen.getByLabelText(/images per sequence/i), '3')
    await userEvent.click(screen.getByRole('checkbox', { name: /remove vehicles/i }))
    await userEvent.click(screen.getByRole('button', { name: /^next$/i }))

    expect(mockedApi.saveCriteria).toHaveBeenCalledWith('task-1', {
      max_interval: 90, images_per_sequence: 3, only_classified: true, remove_middle_humans: true, remove_middle_vehicles: true,
    })
    expect(await screen.findByText('Where to upload them')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByLabelText(/images per sequence/i)).toHaveValue('3')
  })

  it('saves the Zooniverse destination and shows everything on the upload step', async () => {
    render(<WizardPage resumeSession={FILTERED_SESSION} />)
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()
    await waitFor(() => expect(zooniverseStep().getByLabelText('Username')).toHaveValue('SimSan'))
    await userEvent.click(zooniverseStep().getByRole('button', { name: /test connection/i }))
    await userEvent.selectOptions(await screen.findByLabelText('Zooniverse project'), '30567')
    await userEvent.clear(screen.getByLabelText('Subject set name'))
    await userEvent.type(screen.getByLabelText('Subject set name'), DESTINATION.subject_set_name)
    await userEvent.click(screen.getByRole('button', { name: /^next$/i }))

    expect(mockedApi.saveDestination).toHaveBeenCalledWith('task-1', DESTINATION)
    expect(await screen.findByRole('heading', { name: 'Upload to Zooniverse' })).toBeInTheDocument()
    expect(screen.getByText(/Gap over 120 s/)).toBeInTheDocument()
    expect(screen.getByText('European Camera Trap Project')).toBeInTheDocument()
    expect(screen.getByText(DESTINATION.subject_set_name)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^dry run$/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByLabelText('Zooniverse project')).toHaveValue('30567')
    expect(screen.getByLabelText('Subject set name')).toHaveValue(DESTINATION.subject_set_name)
  })

  it('does not go on while a criterion is invalid', async () => {
    render(<WizardPage resumeSession={SESSION} />)
    await userEvent.clear(await screen.findByLabelText(/max\. gap within a sequence/i))
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()
    expect(screen.getByText(/whole numbers of at least 1/)).toBeInTheDocument()
  })

  it('keeps the Trapper choices when going Back, and updates the same session', async () => {
    render(<WizardPage />)
    await reachImagesStep()
    await chooseImages()
    await userEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await screen.findByText('Choose which images to upload')

    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByLabelText('Collection')).toHaveValue('33')
    await userEvent.click(screen.getByRole('checkbox', { name: 'R0033-DONA_0007_B' }))
    await userEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(mockedApi.saveSelection).toHaveBeenCalledTimes(2))
    expect(mockedApi.saveSelection).toHaveBeenLastCalledWith(expect.objectContaining({ all_deployments: false }), 'new-task')
    expect(await screen.findByText(/^1 selected/)).toBeInTheDocument()
    expect(screen.getByText('· 150 images')).toBeInTheDocument()
  })

  it('resumes a session with only its images chosen on the filters step', () => {
    render(<WizardPage resumeSession={SESSION} />)
    expect(screen.getByText('Choose which images to upload')).toBeInTheDocument()
    expect(screen.getByText('R0033')).toBeInTheDocument()
  })

  it('resumes a session with its criteria set on the Zooniverse step', () => {
    render(<WizardPage resumeSession={FILTERED_SESSION} />)
    expect(screen.getByText('Where to upload them')).toBeInTheDocument()
  })

  it('resumes a session with its destination set on the upload step, and can go back to it', async () => {
    render(<WizardPage resumeSession={DESTINATION_SESSION} />)
    expect(screen.getByRole('heading', { name: 'Upload to Zooniverse' })).toBeInTheDocument()
    expect(screen.getByText(DESTINATION.subject_set_name)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByText('Where to upload them')).toBeInTheDocument()
    await waitFor(() => expect(zooniverseStep().getByLabelText('Username')).toHaveValue('SimSan'))
    await userEvent.click(zooniverseStep().getByRole('button', { name: /test connection/i }))
    // The saved project is chosen again once connected.
    await waitFor(() => expect(screen.getByLabelText('Zooniverse project')).toHaveValue('30567'))
    expect(screen.getByLabelText('Subject set name')).toHaveValue(DESTINATION.subject_set_name)
  })

  it('starts over from the first step', async () => {
    render(<WizardPage resumeSession={DESTINATION_SESSION} />)
    await userEvent.click(screen.getByRole('button', { name: /start over/i }))
    expect(screen.getByText('What do you want to do?')).toBeInTheDocument()
  })
})
