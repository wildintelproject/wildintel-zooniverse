import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import SettingsPage from './SettingsPage'
import { APP_SETTINGS } from '../test/fixtures'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), saveSettings: vi.fn(), clearLog: vi.fn() } }))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
  mockedApi.saveSettings.mockImplementation(async (update) => ({
    GENERAL: { ...APP_SETTINGS.GENERAL, ...update.GENERAL },
    TRAPPER: { ...APP_SETTINGS.TRAPPER, ...update.TRAPPER },
    ZOONIVERSE: { ...APP_SETTINGS.ZOONIVERSE, ...update.ZOONIVERSE, has_password: !!update.ZOONIVERSE.user_password },
    SEQUENCES: update.SEQUENCES,
  }))
})

const section = (name: string) => userEvent.click(screen.getByRole('button', { name }))

describe('SettingsPage', () => {
  it('shows one section at a time, from the sidebar', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    expect(await screen.findByLabelText('Level')).toHaveValue('INFO')
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page')
    await section('Trapper')
    expect(screen.getByLabelText('URL')).toHaveValue('https://trapper.example.org')
    expect(screen.getByRole('button', { name: 'Trapper' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Parallel downloads')).toHaveValue('4')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByText(/a password is saved — leave it blank to keep it/i)).toBeInTheDocument()

    await section('Zooniverse')
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Attempts per upload')).toHaveValue('5')
    expect(screen.getByText(/no password saved yet/i)).toBeInTheDocument()

    await section('Sequences')
    expect(screen.getByLabelText('Max. gap within a sequence')).toHaveValue('90')
    expect(screen.getByRole('checkbox', { name: 'Remove humans' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Remove vehicles' })).not.toBeChecked()
  })

  it('saves every section at once, a blank password keeping the saved one', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    await screen.findByLabelText('Level')
    await section('Trapper')
    const workers = screen.getByLabelText('Parallel downloads')
    await userEvent.clear(workers)
    await userEvent.type(workers, '8')
    await section('Zooniverse')
    await userEvent.type(screen.getByLabelText('Username'), 'bob')
    await userEvent.type(screen.getByLabelText('Password'), 'pw')
    await section('Sequences')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Remove vehicles' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi.saveSettings).toHaveBeenCalledWith({
      GENERAL: { log_level: 'INFO' },
      TRAPPER: {
        base_url: 'https://trapper.example.org', user_name: 'alice', user_password: '',
        download_workers: 8, download_attempts: 5, download_retry_delay: 15,
      },
      ZOONIVERSE: {
        user_name: 'bob', user_password: 'pw', upload_workers: 4, upload_attempts: 5, upload_retry_delay: 30,
        export_classified_by: 'zooniverse@wildintel-project.org', export_max_file_size_mb: 1.5,
      },
      SEQUENCES: { ...APP_SETTINGS.SEQUENCES, remove_middle_vehicles: true },
    })
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    await section('Zooniverse')
    // The password isn't kept in the form once saved.
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('marks an invalid value, and its section in the sidebar, and cannot save', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    await screen.findByLabelText('Level')
    await section('Trapper')
    const attempts = screen.getByLabelText('Attempts per download')
    await userEvent.clear(attempts)
    await userEvent.type(attempts, '0')
    expect(screen.getByText('A whole number from 1 to 20.')).toBeInTheDocument()
    expect(screen.getByTitle('Has an invalid value')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    // Still marked from another section.
    await section('Sequences')
    expect(screen.getByTitle('Has an invalid value')).toBeInTheDocument()
    expect(screen.getByText(/fix the values marked in red/i)).toBeInTheDocument()
  })

  it('sets the log level, and shows where the log file is', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    const level = await screen.findByLabelText('Level')
    expect(screen.getByText(APP_SETTINGS.GENERAL.log_file)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /download log/i })).toHaveAttribute('href', '/api/settings/log')

    await userEvent.selectOptions(level, 'DEBUG')
    expect(screen.getByText(/each image downloaded and uploaded/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockedApi.saveSettings.mock.calls[0][0].GENERAL).toEqual({ log_level: 'DEBUG' })
  })

  it('clears the log only once confirmed', async () => {
    mockedApi.clearLog.mockResolvedValue({ deleted: 2 })
    render(<SettingsPage onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Clear log' }))
    expect(mockedApi.clearLog).not.toHaveBeenCalled()
    expect(screen.getByText(/can.t be undone/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/can.t be undone/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear log' }))
    await userEvent.click(screen.getByRole('button', { name: /yes, clear it/i }))
    expect(mockedApi.clearLog).toHaveBeenCalledOnce()
    expect(await screen.findByText(/Log cleared — a new one starts now/)).toBeInTheDocument()
  })

  it('says when the environment overrides the log level', async () => {
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, GENERAL: { ...APP_SETTINGS.GENERAL, log_level_override: 'DEBUG' } })
    render(<SettingsPage onClose={vi.fn()} />)
    expect(await screen.findByText(/WILDINTEL_ZOONIVERSE_WEB_LOG_LEVEL/)).toBeInTheDocument()
  })

  it('goes back', async () => {
    const onClose = vi.fn()
    render(<SettingsPage onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalled()
  })
})
