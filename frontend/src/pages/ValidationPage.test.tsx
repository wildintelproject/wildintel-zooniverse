import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ValidationPage from './ValidationPage'
import type { ValidationEvent, ValidationReport } from '../types'
import {
  APP_SETTINGS, CLASSIFICATION_PROJECTS, COLLECTIONS, DEPLOYMENTS, RESEARCH_PROJECTS, SUBJECT_SETS, ZOONIVERSE_PROJECTS,
} from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    zooniverseGetConfig: vi.fn(),
    zooniverseTestConnection: vi.fn(),
    zooniverseProjects: vi.fn(),
    zooniverseSubjectSets: vi.fn(),
    trapperGetConfig: vi.fn(),
    trapperTestConnection: vi.fn(),
    trapperResearchProjects: vi.fn(),
    trapperClassificationProjects: vi.fn(),
    trapperCollections: vi.fn(),
    trapperDeployments: vi.fn(),
    trapperUploadPreview: vi.fn(),
    getSettings: vi.fn(),
    validateSubjectSet: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

const REPORT: ValidationReport = {
  subject_set: { id: 128950, name: 'Kittehs' },
  subjects: 5, media: 3,
  uploaded: [{ media_id: 1, subject_ids: [101, 102] }, { media_id: 2, subject_ids: [103] }, { media_id: 9, subject_ids: [104] }],
  duplicated: [{ media_id: 1, subject_ids: [101, 102] }],
  unmatched: [105],
  metadata_issues: [{ subject_id: 103, media_id: 2, issues: ['link: expected \'a\', got \'b\''] }],
  compared: true, expected: 3,
  missing: [{ media_id: 3, deployment_id: 'R0033-DONA_0001_A', file_name: 'IMG_3.JPG' }],
  extra: [{ media_id: 9, subject_ids: [104] }],
  deployments: [{ deployment_id: 'R0033-DONA_0001_A', expected: 3, uploaded: 2, missing: 1 }],
}

function controlledValidation() {
  const handle = { send: (_e: ValidationEvent) => {}, finish: () => {} }
  mockedApi.validateSubjectSet.mockImplementation((_c, _id, _t, onEvent, signal) => new Promise<void>((resolve, reject) => {
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
  mockedApi.zooniverseSubjectSets.mockResolvedValue({ results: SUBJECT_SETS })
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true })
  mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 1 })
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: RESEARCH_PROJECTS })
  mockedApi.trapperClassificationProjects.mockResolvedValue({ results: CLASSIFICATION_PROJECTS })
  mockedApi.trapperCollections.mockResolvedValue({ results: COLLECTIONS })
  mockedApi.trapperDeployments.mockResolvedValue({ results: DEPLOYMENTS })
  mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, SEQUENCES: { ...APP_SETTINGS.SEQUENCES, max_interval: 300 } })
})

async function chooseSubjectSet() {
  await userEvent.click(await screen.findByRole('button', { name: /test connection/i }))
  await userEvent.selectOptions(await screen.findByLabelText('Zooniverse project'), '30567')
  await userEvent.selectOptions(await screen.findByLabelText('Subject set'), '128950')
}

describe('ValidationPage', () => {
  it('checks the subject set on its own, and reports what it found', async () => {
    const run = controlledValidation()
    render(<ValidationPage onBack={vi.fn()} />)
    await chooseSubjectSet()
    await userEvent.click(screen.getByRole('checkbox', { name: /compare with what an upload would send/i }))
    await userEvent.click(screen.getByRole('button', { name: /^validate$/i }))

    expect(mockedApi.validateSubjectSet).toHaveBeenCalledWith(
      { username: 'SimSan', password: '' }, 128950, null, expect.any(Function), expect.any(AbortSignal),
    )
    run.send({ type: 'subjects', id: 128950, name: 'Kittehs', total: 5 })
    run.send({ type: 'progress', phase: 'subjects', done: 2 })
    expect(screen.getByRole('progressbar', { name: 'Subjects listed' })).toHaveAttribute('aria-valuenow', '40')

    const { missing: _m, extra: _e, deployments: _d, expected: _x, ...alone } = REPORT
    run.send({ type: 'report', ...alone, compared: false })
    run.send({ type: 'done' })
    await run.finish()

    expect(screen.getByText(/Subject set Kittehs: 3 finding\(s\)/)).toBeInTheDocument()
    expect(screen.queryByText('Missing')).not.toBeInTheDocument()
    expect(screen.getByText('Duplicated media')).toBeInTheDocument()
    expect(screen.getByText('101, 102')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download report/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download uploaded media ids/i })).toBeEnabled()
  })

  it('compares with a Trapper selection, starting from the saved criteria', async () => {
    const run = controlledValidation()
    render(<ValidationPage onBack={vi.fn()} />)
    await chooseSubjectSet()
    expect(screen.getByRole('button', { name: /^validate$/i })).toBeDisabled()

    await waitFor(() => expect(screen.getByLabelText('Trapper URL')).toHaveValue('https://trapper.example.org'))
    await userEvent.click(screen.getAllByRole('button', { name: /test connection/i })[1])
    await userEvent.type(await screen.findByLabelText('Research project'), 'Doñana')
    await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
    await userEvent.type(await screen.findByLabelText('Classification project'), 'Main')
    await userEvent.click(await screen.findByRole('option', { name: 'Main CP' }))
    await userEvent.selectOptions(await screen.findByLabelText('Collection'), '33')
    await screen.findByText('R0033-DONA_0001_A')
    expect(await screen.findByLabelText(/max\. gap within a sequence/i)).toHaveValue('300')

    await userEvent.click(screen.getByRole('button', { name: /^validate$/i }))
    expect(mockedApi.validateSubjectSet).toHaveBeenCalledWith(
      { username: 'SimSan', password: '' }, 128950,
      { selection: expect.objectContaining({ collection: { pk: 33, name: 'R0033' } }), criteria: expect.objectContaining({ max_interval: 300 }) },
      expect.any(Function), expect.any(AbortSignal),
    )
    run.send({ type: 'subjects', id: 128950, name: 'Kittehs', total: 5 })
    run.send({ type: 'trapper', total: 2 })
    run.send({ type: 'deployment', deployment_id: 'R0033-DONA_0001_A', images: 3, candidates: 3, sequences: 3, removed_middle: 0, selected: 3 })
    expect(screen.getByRole('progressbar', { name: 'Trapper deployments fetched' })).toHaveAttribute('aria-valuenow', '50')

    run.send({ type: 'report', ...REPORT })
    run.send({ type: 'done' })
    await run.finish()
    expect(screen.getByText(/5 finding\(s\)/)).toBeInTheDocument()
    expect(screen.getByText('Missing media')).toBeInTheDocument()
    expect(screen.getByText('IMG_3.JPG')).toBeInTheDocument()
    expect(screen.getByText('Extra media')).toBeInTheDocument()
  })

  it('says when nothing is wrong', async () => {
    const run = controlledValidation()
    render(<ValidationPage onBack={vi.fn()} />)
    await chooseSubjectSet()
    await userEvent.click(screen.getByRole('checkbox', { name: /compare with what an upload would send/i }))
    await userEvent.click(screen.getByRole('button', { name: /^validate$/i }))
    run.send({ type: 'report', ...REPORT, compared: false, duplicated: [], unmatched: [], metadata_issues: [], missing: undefined, extra: undefined })
    run.send({ type: 'done' })
    await run.finish()
    expect(screen.getByText('Subject set Kittehs: no problems found.')).toBeInTheDocument()
  })

  it('shows why it failed', async () => {
    mockedApi.validateSubjectSet.mockRejectedValue(new Error("Could not find subject_set with id='128950'"))
    render(<ValidationPage onBack={vi.fn()} />)
    await chooseSubjectSet()
    await userEvent.click(screen.getByRole('checkbox', { name: /compare with what an upload would send/i }))
    await userEvent.click(screen.getByRole('button', { name: /^validate$/i }))
    expect(await screen.findByText(/Could not find subject_set/)).toBeInTheDocument()
  })
})
