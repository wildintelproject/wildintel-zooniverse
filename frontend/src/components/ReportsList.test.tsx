import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ReportsList from './ReportsList'
import type { Report, ReportSummary } from '../types'

vi.mock('../api', () => ({
  api: {
    listReports: vi.fn(), getReport: vi.fn(), deleteReport: vi.fn(), deleteOldReports: vi.fn(),
    reportUrl: (id: string, format: string) => `/api/reports/${id}/download?format=${format}`,
  },
}))

const mockedApi = vi.mocked(api)

const DRY: ReportSummary = {
  id: '20261009-184431_update_metadata', kind: 'update_metadata', title: 'Dry run of metadata — Kittehs',
  created_at: '2026-10-09T16:44:31+00:00', finished_at: '2026-10-09T16:46:45+00:00', status: 'done',
  totals: { would_update: 1 }, entries_total: 1,
}
const FAILED: ReportSummary = {
  id: '20261008-100000_export_classifications', kind: 'export_classifications', title: 'Export of classifications — Doñana',
  created_at: '2026-10-08T08:00:00+00:00', finished_at: '2026-10-08T08:00:30+00:00', status: 'error', totals: {}, entries_total: 0,
}
const FULL: Report = {
  ...DRY, parameters: { subject_set_id: 8, dry_run: true, collection: 'R0033' }, outputs: {},
  entries: [{ subject_id: 102, field: 'Filename', old: 'IMG_2.JPG', new: '2_x_IMG_2.JPG' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.listReports.mockResolvedValue([DRY, FAILED])
  mockedApi.getReport.mockResolvedValue(FULL)
})

describe('ReportsList', () => {
  it('lists the reports, saying how each run ended', async () => {
    render(<ReportsList />)
    const first = await screen.findByRole('listitem', { name: DRY.title })
    expect(within(first).getByText('Completed')).toBeInTheDocument()
    expect(within(first).getByText('Update metadata')).toBeInTheDocument()
    expect(within(first).getByText(/2 min 14 s/)).toBeInTheDocument()
    expect(within(screen.getByRole('listitem', { name: FAILED.title })).getByText('Error')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: 'CSV' })).toHaveAttribute('href', `/api/reports/${DRY.id}/download?format=csv`)
  })

  it('shows what a report holds when it is opened', async () => {
    render(<ReportsList />)
    const item = await screen.findByRole('listitem', { name: DRY.title })
    await userEvent.click(within(item).getByRole('button', { name: 'View' }))
    expect(await within(item).findByText('2_x_IMG_2.JPG')).toBeInTheDocument()
    expect(within(item).getByText('R0033')).toBeInTheDocument()
    expect(within(item).getByText('Would update')).toBeInTheDocument()
    await userEvent.click(within(item).getByRole('button', { name: 'Hide' }))
    expect(within(item).queryByText('2_x_IMG_2.JPG')).not.toBeInTheDocument()
  })

  it('deletes a report only once confirmed', async () => {
    mockedApi.deleteReport.mockResolvedValue({ status: 'ok' })
    render(<ReportsList />)
    const item = await screen.findByRole('listitem', { name: DRY.title })
    await userEvent.click(within(item).getByRole('button', { name: 'Delete' }))
    expect(mockedApi.deleteReport).not.toHaveBeenCalled()
    await userEvent.click(within(item).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: DRY.title })).not.toBeInTheDocument())
    expect(mockedApi.deleteReport).toHaveBeenCalledWith(DRY.id)
  })

  it('deletes the old ones', async () => {
    mockedApi.deleteOldReports.mockResolvedValue({ deleted: 1 })
    render(<ReportsList />)
    await screen.findByRole('listitem', { name: DRY.title })
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    expect(mockedApi.deleteOldReports).toHaveBeenCalledWith(60)
    expect(await screen.findByText('1 report(s) deleted.')).toBeInTheDocument()
  })

  it('says when there are none', async () => {
    mockedApi.listReports.mockResolvedValue([])
    render(<ReportsList />)
    expect(await screen.findByText(/no reports yet/i)).toBeInTheDocument()
  })
})
