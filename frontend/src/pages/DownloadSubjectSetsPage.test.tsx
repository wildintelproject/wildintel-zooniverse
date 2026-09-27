import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import DownloadSubjectSetsPage from './DownloadSubjectSetsPage'
import type { DownloadEvent } from '../types'
import { SUBJECT_SETS, ZOONIVERSE_PROJECTS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    zooniverseGetConfig: vi.fn(),
    zooniverseTestConnection: vi.fn(),
    zooniverseProjects: vi.fn(),
    zooniverseSubjectSets: vi.fn(),
    zooniverseDownloadDefaults: vi.fn(),
    zooniverseDownloadSubjectSets: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

/** A download the test drives, as the backend's stream would. */
function controlledDownload() {
  const handle = { send: (_e: DownloadEvent) => {}, finish: () => {} }
  mockedApi.zooniverseDownloadSubjectSets.mockImplementation((_c, _ids, _dir, _ow, onEvent, signal) => new Promise<void>((resolve, reject) => {
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
  mockedApi.zooniverseDownloadDefaults.mockResolvedValue({ output_dir: '/home/me/Documents/wildintel-zooniverse/downloads' })
})

async function chooseSubjectSets(...names: string[]) {
  await userEvent.click(await screen.findByRole('button', { name: /test connection/i }))
  await userEvent.selectOptions(await screen.findByLabelText('Zooniverse project'), '30567')
  for (const name of names) await userEvent.click(await screen.findByRole('checkbox', { name: new RegExp(name) }))
}

describe('DownloadSubjectSetsPage', () => {
  it("lists the project's subject sets to choose from, and the default folder", async () => {
    render(<DownloadSubjectSetsPage onBack={vi.fn()} />)
    await chooseSubjectSets('Kittehs')

    expect(screen.getByText('1 chosen · 30 images')).toBeInTheDocument()
    expect(screen.getByLabelText('Folder')).toHaveValue('/home/me/Documents/wildintel-zooniverse/downloads')

    await userEvent.click(screen.getByRole('checkbox', { name: /all subject sets/i }))
    expect(screen.getByText(/^2 chosen · 86\D?908 images$/)).toBeInTheDocument()
  })

  it('downloads the chosen subject sets, with a bar for each and the files in flight', async () => {
    const run = controlledDownload()
    render(<DownloadSubjectSetsPage onBack={vi.fn()} />)
    await chooseSubjectSets('Kittehs')
    await userEvent.click(screen.getByRole('checkbox', { name: /download again images already there/i }))
    await userEvent.click(screen.getByRole('button', { name: /^download$/i }))

    expect(mockedApi.zooniverseDownloadSubjectSets).toHaveBeenCalledWith(
      { username: 'SimSan', password: '' }, [128950], '/home/me/Documents/wildintel-zooniverse/downloads', true,
      expect.any(Function), expect.any(AbortSignal), { include: null, exclude: [] },
    )
    run.send({ type: 'subject_set', id: 128950, name: 'Kittehs', total: 4, folder: '/dl/128950_Kittehs' })
    run.send({ type: 'step', subject_set_id: 128950, subject_id: 1, file_name: '1_cat.jpg' })
    const inFlight = screen.getByRole('list', { name: 'Kittehs in progress' })
    expect(within(inFlight).getByText('1_cat.jpg')).toBeInTheDocument()

    run.send({ type: 'subject', subject_set_id: 128950, subject_id: 1, file_name: '1_cat.jpg', status: 'downloaded' })
    run.send({ type: 'subject', subject_set_id: 128950, subject_id: 2, file_name: '2_cat.jpg', status: 'existing' })
    expect(screen.queryByText('1_cat.jpg')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Kittehs' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText(/1 already there/)).toBeInTheDocument()

    run.send({ type: 'subject', subject_set_id: 128950, subject_id: 3, file_name: '3_cat.jpg', status: 'failed', detail: 'reset' })
    run.send({ type: 'subject', subject_set_id: 128950, subject_id: 4, file_name: '4_cat.jpg', status: 'downloaded' })
    run.send({ type: 'done', downloaded: 2, existing: 1, failed: 1, output_dir: '/dl' })
    await run.finish()

    expect(screen.getByRole('progressbar', { name: 'Total' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText(/Download finished: 2 images downloaded, 1 already there, 1 failed/)).toBeInTheDocument()
    expect(screen.getByText('reset')).toBeInTheDocument()
  })

  it('downloads only the subjects the lists keep', async () => {
    const run = controlledDownload()
    render(<DownloadSubjectSetsPage onBack={vi.fn()} />)
    await chooseSubjectSets('Kittehs')
    await userEvent.click(screen.getByRole('button', { name: /subject lists/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /process only some subjects/i }))
    await userEvent.type(screen.getByLabelText('Only these subjects'), '1 2 3')
    await userEvent.type(screen.getByLabelText('Never these subjects'), '3')
    await userEvent.tab()
    expect(screen.getByRole('status')).toHaveTextContent('1 id is in both lists')
    await userEvent.click(screen.getByRole('button', { name: /^download$/i }))

    expect(mockedApi.zooniverseDownloadSubjectSets.mock.calls[0][6]).toEqual({ include: [1, 2, 3], exclude: [3] })
    run.send({ type: 'subject_set', id: 128950, name: 'Kittehs', total: 2, folder: '/dl/128950_Kittehs' })
    run.send({ type: 'subject', subject_set_id: 128950, subject_id: 1, file_name: '1_cat.jpg', status: 'downloaded' })
    run.send({ type: 'subject', subject_set_id: 128950, subject_id: 3, file_name: '3_cat.jpg', status: 'filtered_out' })
    run.send({ type: 'done', downloaded: 1, existing: 0, failed: 0, filtered_out: 1, output_dir: '/dl' })
    await run.finish()
    expect(screen.getByText(/1 images downloaded, 1 left out by the subject lists/)).toBeInTheDocument()
  })

  it('can be stopped, and only goes back once stopped', async () => {
    controlledDownload()
    const onBack = vi.fn()
    render(<DownloadSubjectSetsPage onBack={onBack} />)
    await chooseSubjectSets('Kittehs')
    await userEvent.click(screen.getByRole('button', { name: /^download$/i }))
    expect(screen.getByRole('button', { name: /^back$/i })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(await screen.findByText(/stopped — the images above are kept/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows why it failed', async () => {
    mockedApi.zooniverseDownloadSubjectSets.mockRejectedValue(new Error("Can't use the folder /nope: Permission denied"))
    render(<DownloadSubjectSetsPage onBack={vi.fn()} />)
    await chooseSubjectSets('Kittehs')
    await userEvent.click(screen.getByRole('button', { name: /^download$/i }))
    expect(await screen.findByText(/Permission denied/)).toBeInTheDocument()
  })
})
