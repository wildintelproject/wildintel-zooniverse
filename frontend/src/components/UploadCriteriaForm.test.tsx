import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import UploadCriteriaForm from './UploadCriteriaForm'
import { DEFAULT_CRITERIA } from '../types'
import type { DeploymentCounts } from '../types'
import { PREVIEW_ROWS, SELECTION } from '../test/fixtures'

vi.mock('../api', () => ({ api: { trapperUploadPreview: vi.fn() } }))

const mockedApi = vi.mocked(api)

/** A preview the test drives: send() emits one deployment's counts,
 * finish()/fail() end it — as the backend's stream would. */
function controlledPreview() {
  const handle = {
    send: (_row: DeploymentCounts) => {},
    finish: () => {},
    fail: (_e: Error) => {},
    signal: undefined as AbortSignal | undefined,
  }
  mockedApi.trapperUploadPreview.mockImplementation((_selection, _criteria, onDeployment, signal) => new Promise<void>((resolve, reject) => {
    handle.send = onDeployment
    handle.finish = resolve
    handle.fail = reject
    handle.signal = signal
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  return handle
}

function renderForm() {
  render(<UploadCriteriaForm selection={SELECTION} initial={DEFAULT_CRITERIA} onCriteriaChange={vi.fn()} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UploadCriteriaForm', () => {
  it("starts from wildintel-tools' defaults", () => {
    const onChange = vi.fn()
    render(<UploadCriteriaForm selection={SELECTION} initial={DEFAULT_CRITERIA} onCriteriaChange={onChange} />)
    expect(screen.getByLabelText(/images per sequence/i)).toHaveValue('5')
    expect(screen.getByRole('checkbox', { name: /remove humans/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /remove vehicles/i })).not.toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_CRITERIA)
  })

  it('reports null while a number is invalid', async () => {
    const onChange = vi.fn()
    render(<UploadCriteriaForm selection={SELECTION} initial={DEFAULT_CRITERIA} onCriteriaChange={onChange} />)
    await userEvent.clear(screen.getByLabelText(/images per sequence/i))
    await userEvent.type(screen.getByLabelText(/images per sequence/i), '0')
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('button', { name: /preview/i })).toBeDisabled()
  })

  it('shows each deployment as soon as it is counted, with a running total', async () => {
    const preview = controlledPreview()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: /preview/i }))
    expect(mockedApi.trapperUploadPreview).toHaveBeenCalledWith(SELECTION, DEFAULT_CRITERIA, expect.any(Function), expect.any(AbortSignal), false)

    preview.send(PREVIEW_ROWS[0])
    expect(await screen.findByText('R0033-DONA_0001_A')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 deployments counted/)).toBeInTheDocument()
    expect(within(screen.getByText('Total so far').closest('tr')!).getByText('90')).toBeInTheDocument()

    preview.send(PREVIEW_ROWS[1])
    preview.finish()
    expect(await screen.findByText('Total')).toBeInTheDocument()
    expect(screen.getByText(/of 350 images would be uploaded/)).toBeInTheDocument()
    expect(screen.queryByText(/deployments counted/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /count again/i })).toBeInTheDocument()
  })

  it('explains what candidates are, following the criteria', async () => {
    const preview = controlledPreview()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: /preview/i }))
    preview.send(PREVIEW_ROWS[0])
    expect(await screen.findByText(/can be uploaded: their file is public/)).toHaveTextContent(/other than .unclassified/)

    await userEvent.click(screen.getByRole('checkbox', { name: /only classified/i }))
    await userEvent.click(screen.getByRole('button', { name: /^preview$/i }))
    preview.send(PREVIEW_ROWS[0])
    expect(await screen.findByText(/can be uploaded: their file is public/)).toHaveTextContent('(classified or not)')
  })

  it('can be stopped, keeping what was already counted', async () => {
    const preview = controlledPreview()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: /preview/i }))
    preview.send(PREVIEW_ROWS[0])
    await userEvent.click(await screen.findByRole('button', { name: /stop/i }))

    expect(preview.signal?.aborted).toBe(true)
    expect(await screen.findByText(/Stopped/)).toBeInTheDocument()
    expect(screen.getByText('R0033-DONA_0001_A')).toBeInTheDocument()
  })

  it('cancels and forgets the preview when the criteria change', async () => {
    const preview = controlledPreview()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: /preview/i }))
    preview.send(PREVIEW_ROWS[0])
    await screen.findByText('R0033-DONA_0001_A')

    await userEvent.click(screen.getByRole('checkbox', { name: /only classified/i }))
    expect(preview.signal?.aborted).toBe(true)
    expect(screen.queryByText('R0033-DONA_0001_A')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^preview$/i })).toBeEnabled()
  })

  it('shows an error midway, keeping the deployments counted before it', async () => {
    const preview = controlledPreview()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: /preview/i }))
    preview.send(PREVIEW_ROWS[0])
    preview.fail(new Error('Trapper resource not found.'))
    expect(await screen.findByText('Trapper resource not found.')).toBeInTheDocument()
    expect(screen.getByText('R0033-DONA_0001_A')).toBeInTheDocument()
  })

  it('analyzes each deployment\'s sequences, down to what becomes of each image', async () => {
    const preview = controlledPreview()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: /analyze sequences/i }))
    expect(mockedApi.trapperUploadPreview.mock.calls[0][4]).toBe(true)

    preview.send({
      ...PREVIEW_ROWS[0],
      sequence_detail: [
        { number: 1, start: '2024-09-04T12:00:00', end: '2024-09-04T12:00:40', duration_s: 40, images: 3,
          uploaded: [1, 3], not_sampled: [2], removed_human: [], removed_vehicle: [], collapsed_empty: [] },
        { number: 2, start: '2024-09-04T13:00:00', end: '2024-09-04T13:00:10', duration_s: 10, images: 1,
          uploaded: [], not_sampled: [], removed_human: [4], removed_vehicle: [], collapsed_empty: [] },
      ],
    })
    preview.finish()

    await userEvent.click(await screen.findByText(/R0033-DONA_0001_A/))
    const sequences = screen.getByRole('table', { name: 'R0033-DONA_0001_A sequences' })
    expect(within(sequences).getAllByRole('row')).toHaveLength(3) // header + 2

    await userEvent.click(within(sequences).getByText(/▸ 1/))
    const image = screen.getByRole('link', { name: '2' })
    expect(image).toHaveAttribute('title', 'Not sampled')
    expect(image).toHaveAttribute('href', 'https://trapper.example.org/storage/resource/media/2/pfile/')
    expect(screen.getByRole('button', { name: /download sequences \(csv\)/i })).toBeInTheDocument()
  })
})
