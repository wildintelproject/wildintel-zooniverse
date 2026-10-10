import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import TrapperImportPanel from './TrapperImportPanel'
import type { TrapperImportEvent } from '../types'

vi.mock('../api', () => ({ api: { importToTrapper: vi.fn() } }))

const mockedApi = vi.mocked(api)

const FILES = ['/exports/observations_part001.csv', '/exports/observations_part002.csv']
const MANUAL = 'https://trapper.example.org/media_classification/classification/import/'

function controlledImport() {
  const handle = { send: (_e: TrapperImportEvent) => {}, finish: () => {} }
  mockedApi.importToTrapper.mockImplementation((_u, _p, _f, _a, onEvent, signal) => new Promise<void>((resolve, reject) => {
    handle.send = (event) => act(() => onEvent(event))
    handle.finish = () => act(resolve)
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  return handle
}

function renderPanel(autoStart = false) {
  render(
    <TrapperImportPanel
      files={FILES} trapperUrl="https://trapper.example.org" project={{ pk: 10, name: 'Main CP' }}
      manualUrl={MANUAL} autoStart={autoStart}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('TrapperImportPanel', () => {
  it('imports only once confirmed, file by file, not approved by default', async () => {
    const run = controlledImport()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Import into Trapper' }))
    expect(mockedApi.importToTrapper).not.toHaveBeenCalled()
    expect(screen.getByText(/can.t undo it/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /yes, import/i }))
    expect(mockedApi.importToTrapper).toHaveBeenCalledWith(
      'https://trapper.example.org', 10, FILES, false, expect.any(Function), expect.any(AbortSignal),
    )
    run.send({ type: 'file', path: FILES[0], index: 1, total: 2 })
    expect(screen.getByText(/uploading/)).toBeInTheDocument()
    run.send({ type: 'imported', path: FILES[0], message: 'Import scheduled', task_id: 'abc-123' })
    run.send({ type: 'file', path: FILES[1], index: 2, total: 2 })
    run.send({ type: 'failed', path: FILES[1], detail: 'Invalid rows' })
    run.send({ type: 'done', imported: 1, failed: 1 })
    await run.finish()

    expect(screen.getByText(/Import scheduled \(task abc-123\)/)).toBeInTheDocument()
    expect(screen.getByText(/Invalid rows/)).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 files imported — import again to retry the rest/)).toBeInTheDocument()
    expect(screen.getByText(/in the background/)).toBeInTheDocument()
    // The manual way, when something failed.
    expect(screen.getByRole('link', { name: MANUAL })).toHaveAttribute('href', MANUAL)
  })

  it('can approve them', async () => {
    controlledImport()
    renderPanel()
    // The choice is offered once Import is pressed, with the confirmation.
    expect(screen.queryByRole('checkbox', { name: /approve the imported classifications/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import into Trapper' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /approve the imported classifications/i }))
    await userEvent.click(screen.getByRole('button', { name: /yes, import and approve/i }))
    expect(mockedApi.importToTrapper.mock.calls[0][3]).toBe(true)
  })

  it("starts right away when asked — once, even in React's strict mode", async () => {
    controlledImport()
    render(
      <StrictMode>
        <TrapperImportPanel
          files={FILES} trapperUrl="https://trapper.example.org" project={{ pk: 10, name: 'Main CP' }}
          manualUrl={MANUAL} autoStart
        />
      </StrictMode>,
    )
    await waitFor(() => expect(mockedApi.importToTrapper).toHaveBeenCalledOnce())
    expect((mockedApi.importToTrapper.mock.calls[0][5] as AbortSignal).aborted).toBe(false)
  })
})
