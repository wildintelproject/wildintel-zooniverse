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

async function openSubjectSet() {
  await userEvent.click(await screen.findByLabelText('Project'))
  await userEvent.click(await screen.findByRole('option', { name: /European Camera Trap Project/ }))
  await userEvent.click(await screen.findByLabelText('Subject set'))
  await userEvent.click(await screen.findByRole('option', { name: /#128950/ }))
  await userEvent.click(screen.getByRole('button', { name: /continue to the subjects/i }))
}

describe('SubjectsPage', () => {
  it('goes from the subject set to its subjects, a page at a time', async () => {
    mockedApi.zooniverseSubjectSetPage.mockImplementation(async (_c, _id, page) => ({
      subjects: [subject(600 + page)], page, page_count: 3, count: 120, page_size: 50,
    }))
    render(<SubjectsPage onBack={vi.fn()} />)
    await screen.findByLabelText('Project')
    expect(screen.getByRole('heading', { name: 'Subject set' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue to the subjects/i })).toBeDisabled() // no subject set yet
    expect(screen.getByRole('img', { name: 'Locked' })).toBeInTheDocument()
    await openSubjectSet()

    expect(mockedApi.zooniverseSubjectSetPage).toHaveBeenCalledWith({ username: '', password: '' }, 128950, 1)
    expect(await screen.findByText(/of 3 · 120 subjects/)).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole('listitem', { name: 'Subject 601' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(mockedApi.zooniverseSubjectSetPage).toHaveBeenLastCalledWith({ username: '', password: '' }, 128950, 2)
    expect(await screen.findByRole('listitem', { name: 'Subject 602' })).toBeInTheDocument()
  })

  it('filters the subject set by ids, saying which are elsewhere or not found', async () => {
    mockedApi.zooniverseSubjectSetPage.mockResolvedValue({ subjects: [subject(601)], page: 1, page_count: 1, count: 1, page_size: 50 })
    mockedApi.zooniverseLookupSubjects.mockResolvedValue({
      subjects: [subject(501), { ...subject(502, null), subject_sets: [128950] }, { ...subject(503), subject_sets: [999] }], not_found: [999999],
    })
    render(<SubjectsPage onBack={vi.fn()} />)
    await openSubjectSet()
    await screen.findByRole('listitem', { name: 'Subject 601' })

    await userEvent.type(screen.getByLabelText('Filter by id'), '501, 502 503 999999 x')
    expect(screen.getByText(/1 not an id, ignored/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Apply filter' }))

    expect(mockedApi.zooniverseLookupSubjects).toHaveBeenCalledWith({ username: '', password: '' }, [501, 502, 503, 999999])
    const found = await screen.findByRole('list', { name: 'Subjects found' })
    // Only what is in this subject set; the rest is said, not listed.
    expect(within(found).getAllByRole('listitem')).toHaveLength(2)
    const first = within(found).getByRole('listitem', { name: 'Subject 501' })
    expect(within(first).getByRole('link', { name: '7' })).toHaveAttribute('href', 'https://trapper.example.org/storage/resource/media/7/file/')
    expect(within(found).getByRole('listitem', { name: 'Subject 502' })).toHaveTextContent('unknown')
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '2 of 4 found in this subject set')).toBeInTheDocument()
    expect(screen.getByText(/In other subject sets, not this one/)).toHaveTextContent('503')
    expect(screen.getByText(/not found \(or not visible to you\)/i)).toHaveTextContent('999999')
    expect(screen.queryByRole('listitem', { name: 'Subject 601' })).not.toBeInTheDocument()

    // Clearing the filter returns to the whole subject set.
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(await screen.findByRole('listitem', { name: 'Subject 601' })).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by id')).toHaveValue('')
  })

  it('pages a long filtered list', async () => {
    mockedApi.zooniverseSubjectSetPage.mockResolvedValue({ subjects: [], page: 1, page_count: 1, count: 0, page_size: 50 })
    mockedApi.zooniverseLookupSubjects.mockResolvedValue({
      subjects: Array.from({ length: 25 }, (_, i) => subject(700 + i)), not_found: [],
    })
    render(<SubjectsPage onBack={vi.fn()} />)
    await openSubjectSet()
    await userEvent.type(screen.getByLabelText('Filter by id'), '700 701')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filter' }))

    const list = await screen.findByRole('list', { name: 'Subjects found' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(20)
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(within(screen.getByRole('list', { name: 'Subjects found' })).getAllByRole('listitem')).toHaveLength(5)
  })

  it('goes back to the subject set, and out of the task from the first step', async () => {
    mockedApi.zooniverseSubjectSetPage.mockResolvedValue({ subjects: [], page: 1, page_count: 1, count: 0, page_size: 50 })
    const onBack = vi.fn()
    render(<SubjectsPage onBack={onBack} />)
    await openSubjectSet()
    await userEvent.click(screen.getAllByRole('button', { name: 'Back' }).at(-1)!)
    expect(onBack).not.toHaveBeenCalled()
    await userEvent.click(screen.getAllByRole('button', { name: 'Back' })[0])
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
