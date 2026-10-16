import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
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
  await userEvent.click(await screen.findByLabelText('Project'))
  await userEvent.click(await screen.findByRole('option', { name: /European Camera Trap Project/ }))
  await userEvent.click(await screen.findByLabelText('Subject set'))
  await userEvent.click(await screen.findByRole('option', { name: /#128950/ }))
  await userEvent.click(screen.getByRole('button', { name: /continue to trapper/i }))
  await userEvent.type(await screen.findByLabelText('Research project'), 'Doñana')
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
  await userEvent.type(await screen.findByLabelText('Classification project'), 'Main')
  await userEvent.click(await screen.findByRole('option', { name: 'Main CP' }))
  await userEvent.click(await screen.findByLabelText('Collection'))
  await userEvent.click(await screen.findByRole('option', { name: /R0033/ }))
  await screen.findByText(/\d+ of \d+ deployments selected/)
  await userEvent.click(screen.getByRole('button', { name: /continue to review/i }))
}

describe('UpdateMetadataPage', () => {
  it('needs a subject set and the Trapper images first', async () => {
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByLabelText('Project'))
    await userEvent.click(await screen.findByRole('option', { name: /European Camera Trap Project/ }))
    await userEvent.click(await screen.findByLabelText('Subject set'))
    await userEvent.click(await screen.findByRole('option', { name: /#128950/ }))
    expect(screen.getAllByRole('img', { name: 'Locked' })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^run preview$/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /continue to trapper/i }))
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue to review/i })).toBeDisabled()
  })

  it('goes back to the step before, and out of the task only from the first', async () => {
    const onBack = vi.fn()
    render(<UpdateMetadataPage onBack={onBack} />)
    await userEvent.click(await screen.findByLabelText('Project'))
    await userEvent.click(await screen.findByRole('option', { name: /European Camera Trap Project/ }))
    await userEvent.click(await screen.findByLabelText('Subject set'))
    await userEvent.click(await screen.findByRole('option', { name: /#128950/ }))
    await userEvent.click(screen.getByRole('button', { name: /continue to trapper/i }))

    // Step 2's Back (the last one) returns to step 1: the task isn't left.
    await userEvent.click(screen.getAllByRole('button', { name: 'Back' }).at(-1)!)
    expect(onBack).not.toHaveBeenCalled()
    // Step 1's Back leaves for the menu.
    await userEvent.click(screen.getAllByRole('button', { name: 'Back' })[0])
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('a dry run shows every change it would make, and makes none', async () => {
    const run = controlledRun()
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await chooseEverything()
    await userEvent.click(screen.getByRole('button', { name: /^run preview$/i }))

    expect(mockedApi.updateMetadata).toHaveBeenCalledWith(
      { username: '', password: '' }, 128950, expect.objectContaining({ collection: { pk: 33, name: 'R0033' } }), true,
      expect.any(Function), expect.any(AbortSignal), { include: null, exclude: [] },
    )
    expect(screen.getByRole('heading', { name: 'Update results' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Locked' })).not.toBeInTheDocument()
    run.send({ type: 'trapper', total: 2 })
    run.send({ type: 'deployment', deployment_id: 'R0033-DONA_0001_A', media: 150 })
    run.send({ type: 'deployment', deployment_id: 'R0033-DONA_0007_B', media: 200 })
    run.send({ type: 'subjects', id: 128950, name: 'Kittehs', total: 4 })
    run.send({ type: 'subject', subject_id: 101, media_id: 1, status: 'unchanged', changes: [] })
    run.send({ type: 'subject', subject_id: 102, media_id: 2, status: 'would_update', changes: [CHANGE] })
    run.send({ type: 'subject', subject_id: 103, media_id: null, status: 'unmatched', changes: [] })

    expect(screen.getByRole('progressbar', { name: 'Subjects checked' })).toHaveAttribute('aria-valuenow', '75')
    expect(screen.getByRole('status', { name: 'In progress' })).toBeInTheDocument()
    expect(screen.getByText('2 of 2 deployments · 350 images')).toBeInTheDocument()
    // The changes show as they are found, in Details (open while it runs).
    expect(screen.getByText('IMG_2.JPG')).toBeInTheDocument()
    expect(screen.getByText('2_x_R0033-DONA_0001_A_x_IMG_2.JPG')).toBeInTheDocument()

    run.send({ type: 'done', dry_run: true, ...DONE, would_update: 1, unchanged: 1, unmatched: 1 })
    await run.finish()
    expect(screen.getByText('Preview completed')).toBeInTheDocument()
    expect(screen.getByText(/1 subject\(s\) would be updated — nothing was changed/)).toBeInTheDocument()
    expect(screen.getByText('Already right')).toBeInTheDocument()
    expect(screen.getByText(/Would change, by field/)).toBeInTheDocument()
    expect(screen.getByText('in 1 subjects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export report/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Update results' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^details$/i }))
    expect(screen.getByText('IMG_2.JPG')).toBeInTheDocument()
  })

  it('shows why it failed, and asks again before a real update is retried', async () => {
    mockedApi.updateMetadata.mockRejectedValue(new Error('Zooniverse went away'))
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await chooseEverything()
    await userEvent.click(screen.getByRole('radio', { name: /apply the update/i }))
    await userEvent.click(screen.getByRole('button', { name: /^review and update$/i }))
    await userEvent.click(screen.getByRole('button', { name: /yes, update/i }))

    expect(await screen.findByText('The update was interrupted')).toBeInTheDocument()
    expect(screen.getAllByText('Zooniverse went away').length).toBeGreaterThan(0)
    expect(screen.getByText('Error')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mockedApi.updateMetadata).toHaveBeenCalledTimes(1) // not again until confirmed
    expect(screen.getByText(/can.t undo it/)).toBeInTheDocument()
  })

  it('processes only the subjects the lists keep', async () => {
    const run = controlledRun()
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await chooseEverything()
    expect(screen.getByRole('radio', { name: /all eligible subjects/i })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /only specific subjects/i }))
    await userEvent.type(screen.getByLabelText('Only these subjects'), '101 103 104')
    await userEvent.tab()
    await userEvent.click(screen.getByRole('checkbox', { name: /leave some subjects out/i }))
    await userEvent.type(screen.getByLabelText('Never these subjects'), '103, 104')
    await userEvent.tab()
    await userEvent.click(screen.getByRole('button', { name: /^run preview$/i }))

    expect(mockedApi.updateMetadata.mock.calls[0][6]).toEqual({ include: [101, 103, 104], exclude: [103, 104] })
    run.send({ type: 'subjects', id: 128950, name: 'Kittehs', total: 2 })
    run.send({ type: 'subject', subject_id: 103, media_id: null, status: 'filtered_out', changes: [] })
    run.send({ type: 'done', dry_run: true, ...DONE, filtered_out: 1 })
    await run.finish()
    expect(screen.getByText('Left out')).toBeInTheDocument()
  })

  it('updates for real only once confirmed', async () => {
    const run = controlledRun()
    render(<UpdateMetadataPage onBack={vi.fn()} />)
    await chooseEverything()
    await userEvent.click(screen.getByRole('radio', { name: /apply the update/i }))
    await userEvent.click(screen.getByRole('button', { name: /^review and update$/i }))
    expect(mockedApi.updateMetadata).not.toHaveBeenCalled()
    expect(screen.getByText(/can.t undo it/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /yes, update/i }))
    expect(mockedApi.updateMetadata.mock.calls[0][3]).toBe(false)
    run.send({ type: 'subjects', id: 128950, name: 'Kittehs', total: 2 })
    run.send({ type: 'subject', subject_id: 102, media_id: 2, status: 'updated', changes: [CHANGE] })
    run.send({ type: 'subject', subject_id: 104, media_id: 4, status: 'failed', changes: [CHANGE], detail: 'reset' })
    run.send({ type: 'done', dry_run: false, ...DONE, updated: 1, failed: 1 })
    await run.finish()

    expect(screen.getByText('Update completed')).toBeInTheDocument()
    expect(screen.getByText(/1 subject\(s\) updated, 1 failed — update again to retry them/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^details$/i }))
    expect(screen.getByText('Failed: reset')).toBeInTheDocument()
  })
})
