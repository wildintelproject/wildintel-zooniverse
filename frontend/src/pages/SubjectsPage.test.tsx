import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import SubjectsPage from './SubjectsPage'
import type { ZooniverseSubjectInfo } from '../types'
import { SUBJECT_SETS, ZOONIVERSE_PROJECTS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    zooniverseGetConfig: vi.fn(),
    zooniverseTestConnection: vi.fn(),
    zooniverseProjects: vi.fn(),
    zooniverseSubjectSets: vi.fn(),
    zooniverseLookupSubjects: vi.fn(),
    zooniverseSubjectSetPage: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

const subject = (id: number, media_id: number | null = 7): ZooniverseSubjectInfo => ({
  id, images: [`https://panoptes/${id}.jpeg`], subject_sets: [128950], created_at: '2026-03-01T10:00:00Z', media_id,
  metadata: { Filename: `${media_id}_x_D_x_IMG.JPG`, link: `https://trapper.example.org/storage/resource/media/${media_id}/file/` },
})

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.zooniverseGetConfig.mockResolvedValue({ user_name: 'SimSan', has_password: true })
  mockedApi.zooniverseTestConnection.mockResolvedValue({ ok: true, login: 'SimSan', display_name: 'SimSan' })
  mockedApi.zooniverseProjects.mockResolvedValue({ results: ZOONIVERSE_PROJECTS })
  mockedApi.zooniverseSubjectSets.mockResolvedValue({ results: SUBJECT_SETS })
})

async function connect() {
  await userEvent.click(await screen.findByRole('button', { name: /test connection/i }))
  await screen.findByText(/Connected as SimSan/)
}

describe('SubjectsPage', () => {
  it('looks subjects up by id once connected, saying which were not found', async () => {
    mockedApi.zooniverseLookupSubjects.mockResolvedValue({ subjects: [subject(501), subject(502, null)], not_found: [999] })
    render(<SubjectsPage onBack={vi.fn()} />)
    expect(screen.queryByLabelText('Subject ids')).not.toBeInTheDocument()
    await connect()

    await userEvent.type(screen.getByLabelText('Subject ids'), '501, 502 999 x')
    expect(screen.getByText(/1 not an id, ignored/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }))

    expect(mockedApi.zooniverseLookupSubjects).toHaveBeenCalledWith({ username: 'SimSan', password: '' }, [501, 502, 999])
    const found = await screen.findByRole('list', { name: 'Subjects found' })
    const first = within(found).getByRole('listitem', { name: 'Subject 501' })
    expect(within(first).getByRole('link', { name: '7' })).toHaveAttribute('href', 'https://trapper.example.org/storage/resource/media/7/file/')
    expect(within(first).getByRole('img')).toHaveAttribute('src', 'https://panoptes/501.jpeg')
    expect(within(found).getByRole('listitem', { name: 'Subject 502' })).toHaveTextContent('unknown')
    expect(screen.getByText(/not found \(or not visible to you\)/)).toHaveTextContent('999')
  })

  it("browses a subject set's subjects a page at a time", async () => {
    mockedApi.zooniverseSubjectSetPage.mockImplementation(async (_c, _id, page) => ({
      subjects: [subject(600 + page)], page, page_count: 3, count: 120, page_size: 50,
    }))
    render(<SubjectsPage onBack={vi.fn()} />)
    await connect()
    await userEvent.selectOptions(await screen.findByLabelText('Zooniverse project'), '30567')
    await userEvent.selectOptions(await screen.findByLabelText('Subject set'), '128950')

    expect(mockedApi.zooniverseSubjectSetPage).toHaveBeenCalledWith({ username: 'SimSan', password: '' }, 128950, 1)
    expect(await screen.findByText(/of 3 · 120 subjects/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole('listitem', { name: 'Subject 601' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(mockedApi.zooniverseSubjectSetPage).toHaveBeenLastCalledWith({ username: 'SimSan', password: '' }, 128950, 2)
    expect(await screen.findByRole('listitem', { name: 'Subject 602' })).toBeInTheDocument()
  })
})
