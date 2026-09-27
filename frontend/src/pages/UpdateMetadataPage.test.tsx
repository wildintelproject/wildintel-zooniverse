import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import UpdateMetadataPage from './UpdateMetadataPage'
import type { MetadataEvent } from '../types'
import {
  CLASSIFICATION_PROJECTS, COLLECTIONS, DEPLOYMENTS, RESEARCH_PROJECTS, SUBJECT_SETS, ZOONIVERSE_PROJECTS,
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
    updateMetadata: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

function controlledRun() {
  const handle = { send: (_e: MetadataEvent) => {}, finish: () => {} }
  mockedApi.updateMetadata.mockImplementation((_c, _id, _sel, _dry, onEvent, signal) => new Promise<void>((resolve, reject) => {
    handle.send = (event) => act(() => onEvent(event))
    handle.finish = () => act(resolve)
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  return handle
}

const DONE = { would_update: 0, updated: 0, unchanged: 0, unmatched: 0, not_found: 0, failed: 0, filtered_out: 0 }
const CHANGE = { field: 'Filename', old: 'IMG_2.JPG', new: '2_x_R0033-DONA_0001_A_x_IMG_2.JPG' }

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
})

async function chooseEverything() {
  await userEvent.click(await screen.findByRole('button', { name: /test connection/i }))
  await userEvent.selectOptions(await screen.findByLabelText('Zooniverse project'), '30567')
  await userEvent.selectOptions(await screen.findByLabelText('Subject set'), '128950')
  await waitFor(() => expect(screen.getByLabelText('Trapper URL')).toHaveValue('https://trapper.example.org'))
  await userEvent.click(screen.getAllByRole('button', { name: /test connection/i })[1])
  await userEvent.selectOptions(await screen.findByLabelText('Research project'), '2')
  await userEvent.selectOptions(await screen.findByLabelText('Classification project'), '10')
  await userEvent.selectOptions(await screen.findByLabelText('Collection'), '33')
  await screen.findByText('R0033-DONA_0001_A')
}

describe('UpdateMetadataPage', () => {
  it('needs a subject set and the Trapper images first', async () => {
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /test connection/i }))
    await userEvent.selectOptions(await screen.findByLabelText('Zooniverse project'), '30567')
    await userEvent.selectOptions(await screen.findByLabelText('Subject set'), '128950')
    expect(screen.getByRole('button', { name: /^dry run$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^update metadata$/i })).toBeDisabled()
  })

  it('a dry run shows every change it would make, and makes none', async () => {
    const run = controlledRun()
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await chooseEverything()
    await userEvent.click(screen.getByRole('button', { name: /^dry run$/i }))

    expect(mockedApi.updateMetadata).toHaveBeenCalledWith(
      { username: 'SimSan', password: '' }, 128950, expect.objectContaining({ collection: { pk: 33, name: 'R0033' } }), true,
      expect.any(Function), expect.any(AbortSignal), { include: null, exclude: [] },
    )
    run.send({ type: 'trapper', total: 2 })
    run.send({ type: 'deployment', deployment_id: 'R0033-DONA_0001_A', media: 150 })
    run.send({ type: 'deployment', deployment_id: 'R0033-DONA_0007_B', media: 200 })
    run.send({ type: 'subjects', id: 128950, name: 'Kittehs', total: 4 })
    run.send({ type: 'subject', subject_id: 101, media_id: 1, status: 'unchanged', changes: [] })
    run.send({ type: 'subject', subject_id: 102, media_id: 2, status: 'would_update', changes: [CHANGE] })
    run.send({ type: 'subject', subject_id: 103, media_id: null, status: 'unmatched', changes: [] })

    expect(screen.getByRole('progressbar', { name: 'Subjects checked' })).toHaveAttribute('aria-valuenow', '75')
    expect(screen.getByText('2 of 2 · 350 images')).toBeInTheDocument()
    expect(screen.getByText('IMG_2.JPG')).toBeInTheDocument()
    expect(screen.getByText('2_x_R0033-DONA_0001_A_x_IMG_2.JPG')).toBeInTheDocument()
    expect(screen.getByText(/Would change/)).toHaveTextContent('Filename in 1')

    run.send({ type: 'done', dry_run: true, ...DONE, would_update: 1, unchanged: 1, unmatched: 1 })
    await run.finish()
    expect(screen.getByText(/Dry run finished: 1 subject\(s\) would be updated — nothing was changed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download log/i })).toBeInTheDocument()
  })

  it('processes only the subjects the lists keep', async () => {
    const run = controlledRun()
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await chooseEverything()
    await userEvent.click(screen.getByRole('button', { name: /subject lists/i }))
    await userEvent.type(screen.getByLabelText('Never these subjects'), '103, 104')
    await userEvent.tab()
    await userEvent.click(screen.getByRole('button', { name: /^dry run$/i }))

    expect(mockedApi.updateMetadata.mock.calls[0][6]).toEqual({ include: null, exclude: [103, 104] })
    run.send({ type: 'subjects', id: 128950, name: 'Kittehs', total: 2 })
    run.send({ type: 'subject', subject_id: 103, media_id: null, status: 'filtered_out', changes: [] })
    expect(screen.getByText('Left out')).toBeInTheDocument()
  })

  it('updates for real only once confirmed', async () => {
    const run = controlledRun()
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await chooseEverything()
    await userEvent.click(screen.getByRole('button', { name: /^update metadata$/i }))
    expect(mockedApi.updateMetadata).not.toHaveBeenCalled()
    expect(screen.getByText(/can.t undo it/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /yes, update/i }))
    expect(mockedApi.updateMetadata.mock.calls[0][3]).toBe(false)
    run.send({ type: 'subjects', id: 128950, name: 'Kittehs', total: 2 })
    run.send({ type: 'subject', subject_id: 102, media_id: 2, status: 'updated', changes: [CHANGE] })
    run.send({ type: 'subject', subject_id: 104, media_id: 4, status: 'failed', changes: [CHANGE], detail: 'reset' })
    run.send({ type: 'done', dry_run: false, ...DONE, updated: 1, failed: 1 })
    await run.finish()

    expect(screen.getByText(/Update finished: 1 subject\(s\) updated, 1 failed/)).toBeInTheDocument()
    expect(screen.getByText('Failed: reset')).toBeInTheDocument()
  })
})
