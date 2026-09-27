import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import UploadRunPanel from './UploadRunPanel'
import type { UploadEvent } from '../types'
import { DESTINATION, DESTINATION_SESSION, PREVIEW_ROWS } from '../test/fixtures'

vi.mock('../api', () => ({ api: { uploadDryRun: vi.fn(), uploadStart: vi.fn() } }))

const mockedApi = vi.mocked(api)

/** A dry run the test drives: send() emits one event, finish()/fail() end
 * it — as the backend's stream would. */
function controlledRun(call: 'uploadDryRun' | 'uploadStart' = 'uploadDryRun') {
  const handle = {
    send: (_event: UploadEvent) => {},
    finish: () => {},
    fail: (_e: Error) => {},
  }
  mockedApi[call].mockImplementation((_taskId, onEvent, signal) => new Promise<void>((resolve, reject) => {
    handle.send = (event) => act(() => onEvent(event))
    handle.finish = () => act(resolve)
    handle.fail = reject
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  return handle
}

const image = (media_id: number, extra: Partial<UploadEvent & { type: 'image' }> = {}): UploadEvent => ({
  type: 'image', media_id, deployment_id: 'R0033-DONA_0001_A', file_name: `${media_id}_x_R0033-DONA_0001_A_x_IMG.JPG`,
  status: 'uploaded', subject_id: null, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UploadRunPanel', () => {
  it('shows a progress bar for each deployment and one for the whole run', async () => {
    const run = controlledRun()
    render(<UploadRunPanel session={DESTINATION_SESSION} />)
    const bar = (name: string) => screen.getByRole('progressbar', { name })
    const [first, second] = ['R0033-DONA_0001_A', 'R0033-DONA_0007_B']

    await userEvent.click(screen.getByRole('button', { name: /^dry run$/i }))
    expect(mockedApi.uploadDryRun).toHaveBeenCalledWith('task-1', expect.any(Function), expect.any(AbortSignal), { skipInSubjectSet: false })
    expect(screen.getAllByText('Waiting')).toHaveLength(2)

    run.send({ type: 'start', dry_run: true, subject_set: { name: DESTINATION.subject_set_name, id: null, exists: false } })
    expect(screen.getByText(/the upload would create it/i)).toBeInTheDocument()

    run.send({ type: 'fetching', deployment_id: first })
    expect(screen.getByText(/fetching images from trapper/i)).toBeInTheDocument()

    run.send({ type: 'deployment', ...PREVIEW_ROWS[0], selected: 4 })
    run.send(image(1))
    run.send(image(2, { status: 'failed', step: 'download', detail: 'Media 2 has no file URL in Trapper.' }))
    expect(screen.getByText('2 of 4 simulated')).toBeInTheDocument()
    expect(bar(first)).toHaveAttribute('aria-valuenow', '50')
    expect(bar(second)).toHaveAttribute('aria-valuenow', '0')
    // Each deployment weighs half the total.
    expect(bar('Total')).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText(/of 4 images simulated so far/)).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 deployments fetched/)).toBeInTheDocument()
    expect(screen.getByText('Media 2 has no file URL in Trapper.')).toBeInTheDocument()

    run.send(image(3))
    run.send(image(4))
    expect(bar(first)).toHaveAttribute('aria-valuenow', '100')
    expect(bar('Total')).toHaveAttribute('aria-valuenow', '50')

    run.send({ type: 'fetching', deployment_id: second })
    run.send({ type: 'deployment', ...PREVIEW_ROWS[1], deployment_id: second, selected: 1 })
    run.send(image(5, { deployment_id: second }))
    run.send({ type: 'done', dry_run: true, uploaded: 4, skipped: 0, failed: 1 })
    await run.finish()
    expect(bar('Total')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText(/Dry run finished: 4 images would be uploaded, 1 failed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dry run again/i })).toBeInTheDocument()
  })

  it('shows the files being downloaded and uploaded under their deployment', async () => {
    const run = controlledRun()
    render(<UploadRunPanel session={DESTINATION_SESSION} />)
    await userEvent.click(screen.getByRole('button', { name: /^dry run$/i }))
    const deployment = 'R0033-DONA_0001_A'
    const inFlight = () => screen.queryByRole('list', { name: `${deployment} in progress` })
    const step = (media_id: number, s: 'download' | 'upload') => ({
      type: 'step' as const, step: s, media_id, deployment_id: deployment, file_name: `${media_id}_x_${deployment}_x_IMG.JPG`,
    })

    run.send({ type: 'fetching', deployment_id: deployment })
    run.send({ type: 'deployment', ...PREVIEW_ROWS[0], selected: 2 })
    run.send(step(1, 'download'))
    run.send(step(2, 'download'))
    run.send(step(1, 'upload'))
    expect(within(inFlight()!).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      `↑1_x_${deployment}_x_IMG.JPG`, `↓2_x_${deployment}_x_IMG.JPG`,
    ])
    expect(within(inFlight()!).getByTitle('Uploading to Zooniverse')).toBeInTheDocument()
    expect(within(inFlight()!).getByTitle('Downloading from Trapper')).toBeInTheDocument()

    run.send(image(1))
    expect(within(inFlight()!).getAllByRole('listitem')).toHaveLength(1)
    run.send(image(2, { status: 'failed', step: 'download', detail: 'boom' }))
    expect(inFlight()).not.toBeInTheDocument()
  })

  it('clears the files in flight once stopped', async () => {
    const run = controlledRun()
    render(<UploadRunPanel session={DESTINATION_SESSION} />)
    await userEvent.click(screen.getByRole('button', { name: /^dry run$/i }))
    run.send({ type: 'deployment', ...PREVIEW_ROWS[0], selected: 2 })
    run.send({ type: 'step', step: 'download', media_id: 1, deployment_id: 'R0033-DONA_0001_A', file_name: 'a.JPG' })
    expect(screen.getByText('a.JPG')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /stop/i }))
    await screen.findByText(/stopped/i)
    expect(screen.queryByText('a.JPG')).not.toBeInTheDocument()
  })

  it('can skip the images already in the subject set — slowly, with its own progress', async () => {
    const run = controlledRun('uploadStart')
    render(<UploadRunPanel session={DESTINATION_SESSION} />)
    const option = screen.getByRole('checkbox', { name: /skip images already in the subject set/i })
    expect(option).not.toBeChecked()
    expect(screen.getByText(/Slow: every subject of the subject set is listed/)).toBeInTheDocument()

    await userEvent.click(option)
    await userEvent.click(screen.getByRole('button', { name: /upload to zooniverse/i }))
    expect(screen.getByText(/and so are those already in the subject set/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /yes, upload/i }))
    expect(mockedApi.uploadStart).toHaveBeenCalledWith(
      'task-1', expect.any(Function), expect.any(AbortSignal), { skipInSubjectSet: true },
    )
    expect(screen.queryByRole('checkbox', { name: /skip images already/i })).not.toBeInTheDocument()

    run.send({ type: 'start', dry_run: false, subject_set: { name: DESTINATION.subject_set_name, id: 555, exists: true } })
    run.send({ type: 'checking', done: 200, total: 800 })
    expect(screen.getByText(/Listing the subject set.s subjects/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Subjects listed' })).toHaveAttribute('aria-valuenow', '25')
    run.send({ type: 'checked', subjects: 800, media: 790 })
    expect(screen.getByText(/790 Trapper images already in the subject set — skipped/)).toBeInTheDocument()
  })

  it('says how many images the media lists left out', async () => {
    const run = controlledRun()
    render(<UploadRunPanel session={DESTINATION_SESSION} />)
    await userEvent.click(screen.getByRole('button', { name: /^dry run$/i }))
    run.send({ type: 'deployment', ...PREVIEW_ROWS[0], selected: 1, filtered_out: 3 })
    run.send(image(1))
    run.send({ type: 'deployment', ...PREVIEW_ROWS[1], deployment_id: 'R0033-DONA_0007_B', selected: 0, filtered_out: 2 })
    run.send({ type: 'done', dry_run: true, uploaded: 1, skipped: 0, failed: 0, filtered_out: 5 })
    await run.finish()
    expect(screen.getByText(/5 left out by the media lists/)).toBeInTheDocument()
  })

  it('can be stopped', async () => {
    controlledRun()
    render(<UploadRunPanel session={DESTINATION_SESSION} />)
    await userEvent.click(screen.getByRole('button', { name: /^dry run$/i }))
    await userEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(await screen.findByText(/stopped/i)).toBeInTheDocument()
  })

  it('shows why it failed', async () => {
    mockedApi.uploadDryRun.mockRejectedValue(new Error('Incorrect Zooniverse username or password.'))
    render(<UploadRunPanel session={DESTINATION_SESSION} />)
    await userEvent.click(screen.getByRole('button', { name: /^dry run$/i }))
    expect(await screen.findByText('Incorrect Zooniverse username or password.')).toBeInTheDocument()
  })

  it("recalls the session's last dry run", () => {
    render(<UploadRunPanel session={{
      ...DESTINATION_SESSION,
      last_dry_run: { finished_at: '2026-09-25T10:00:00+00:00', uploaded: 220, skipped: 0, failed: 0, subject_set_id: 134791 },
    }} />)
    expect(screen.getByText(/220 images would be uploaded, 0 failed/)).toBeInTheDocument()
  })

  it('uploads for real only once confirmed, skipping what was already uploaded', async () => {
    const run = controlledRun('uploadStart')
    render(<UploadRunPanel session={DESTINATION_SESSION} />)

    await userEvent.click(screen.getByRole('button', { name: /upload to zooniverse/i }))
    expect(mockedApi.uploadStart).not.toHaveBeenCalled()
    expect(screen.getByText(/can.t remove them afterwards/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByText(/can.t remove them afterwards/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /upload to zooniverse/i }))
    await userEvent.click(screen.getByRole('button', { name: /yes, upload/i }))
    expect(mockedApi.uploadStart).toHaveBeenCalledWith('task-1', expect.any(Function), expect.any(AbortSignal), { skipInSubjectSet: false })
    expect(mockedApi.uploadDryRun).not.toHaveBeenCalled()

    run.send({ type: 'start', dry_run: false, subject_set: { name: DESTINATION.subject_set_name, id: 555, exists: false } })
    expect(screen.getByText(/created \(#555\)/)).toBeInTheDocument()
    expect(screen.queryByText('Dry run', { selector: 'span' })).not.toBeInTheDocument()

    run.send({ type: 'fetching', deployment_id: 'R0033-DONA_0001_A' })
    run.send({ type: 'deployment', ...PREVIEW_ROWS[0], selected: 2 })
    run.send(image(1, { status: 'skipped' }))
    run.send(image(2, { subject_id: '9001' }))
    expect(screen.getByText('1 uploaded')).toBeInTheDocument()
    expect(screen.getByText(/1 already uploaded/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'R0033-DONA_0001_A' })).toHaveAttribute('aria-valuenow', '100')

    run.send({ type: 'fetching', deployment_id: 'R0033-DONA_0007_B' })
    run.send({ type: 'deployment', ...PREVIEW_ROWS[1], deployment_id: 'R0033-DONA_0007_B', selected: 0 })
    run.send({ type: 'done', dry_run: false, uploaded: 1, skipped: 1, failed: 0 })
    await run.finish()
    expect(screen.getByText(/Upload finished: 1 images uploaded, 1 already uploaded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload again/i })).toBeInTheDocument()
  })

  it('says a stopped upload keeps what it uploaded', async () => {
    controlledRun('uploadStart')
    render(<UploadRunPanel session={DESTINATION_SESSION} />)
    await userEvent.click(screen.getByRole('button', { name: /upload to zooniverse/i }))
    await userEvent.click(screen.getByRole('button', { name: /yes, upload/i }))
    await userEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(await screen.findByText(/stay uploaded; uploading again skips them/i)).toBeInTheDocument()
  })

  it('offers to continue an upload that did not finish', () => {
    render(<UploadRunPanel session={{
      ...DESTINATION_SESSION, phase: 'uploading',
      upload: { subject_set_id: 555, started_at: '2026-09-26T09:00:00+00:00', finished_at: '2026-09-26T10:00:00+00:00', uploaded: 180, skipped: 0, failed: 3 },
    }} />)
    expect(screen.getByText(/180 uploaded, 3 failed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload again/i })).toBeInTheDocument()
  })
})
