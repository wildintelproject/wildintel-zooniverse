import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Navbar, { DOCS_URL } from './Navbar'

describe('Navbar', () => {
  it('links to the documentation in a new tab, left of the settings button', () => {
    render(<Navbar version="1.2.3" settingsOpen={false} onOpenSettings={vi.fn()} />)
    const help = screen.getByRole('link', { name: /help/i })
    expect(help).toHaveAttribute('href', 'https://wildintelproject.github.io/wildintel-zooniverse/')
    expect(help).toHaveAttribute('target', '_blank')
    expect(DOCS_URL).toBe(help.getAttribute('href'))
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(help.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the settings', async () => {
    const onOpenSettings = vi.fn()
    render(<Navbar version={null} settingsOpen={false} onOpenSettings={onOpenSettings} />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalled()
  })
})
