import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WelcomePage from './WelcomePage'

describe('WelcomePage', () => {
  it('says what the app does and starts the wizard', async () => {
    const onStart = vi.fn()
    render(<WelcomePage onStart={onStart} />)

    expect(screen.getByText(/send a set of images \(a revision\) to a zooniverse project/i)).toBeInTheDocument()
    expect(screen.getByText(/classifications volunteers made in a zooniverse workflow into observations for trapper/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /get started/i }))
    expect(onStart).toHaveBeenCalled()
  })
})
