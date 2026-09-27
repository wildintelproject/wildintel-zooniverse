import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ResumeSessionsPage from './ResumeSessionsPage'
import { SESSION } from '../test/fixtures'

vi.mock('../api', () => ({ api: { discardSession: vi.fn() } }))

describe('ResumeSessionsPage', () => {
  it('shows what each session had chosen, and resumes or discards it', async () => {
    const onResume = vi.fn()
    const onDiscarded = vi.fn()
    vi.mocked(api.discardSession).mockResolvedValue({ status: 'discarded' })
    render(<ResumeSessionsPage sessions={[SESSION]} onResume={onResume} onDiscarded={onDiscarded} onSkip={vi.fn()} />)

    expect(screen.getByText('Upload to Zooniverse: R0033')).toBeInTheDocument()
    expect(screen.getByText('All (2)')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^resume$/i }))
    expect(onResume).toHaveBeenCalledWith(SESSION)

    await userEvent.click(screen.getByRole('button', { name: /discard/i }))
    await waitFor(() => expect(onDiscarded).toHaveBeenCalledWith('task-1'))
  })
})
