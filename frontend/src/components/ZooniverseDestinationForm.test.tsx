import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ZooniverseDestinationForm, { defaultSubjectSetName } from './ZooniverseDestinationForm'
import { DESTINATION, SELECTION, SUBJECT_SETS, ZOONIVERSE_PROJECTS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    zooniverseProjects: vi.fn(),
    zooniverseSubjectSets: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.zooniverseProjects.mockResolvedValue({ results: ZOONIVERSE_PROJECTS })
  mockedApi.zooniverseSubjectSets.mockResolvedValue({ results: SUBJECT_SETS })
})

async function chooseProject() {
  await waitFor(() => expect(screen.getByLabelText('Zooniverse project')).toBeEnabled())
  await userEvent.click(screen.getByLabelText('Zooniverse project'))
  await userEvent.click(await screen.findByRole('option', { name: /European Camera Trap Project/ }))
}

describe('ZooniverseDestinationForm', () => {
  it("names the subject set as wildintel-tools does", () => {
    expect(defaultSubjectSetName(SELECTION, new Date(2026, 8, 25))).toBe('Doñana_2_R0033_33_2026-09')
  })

  it('reports the destination once a project is chosen, with the default name', async () => {
    const onChange = vi.fn()
    render(<ZooniverseDestinationForm selection={SELECTION} onDestinationChange={onChange} />)
    expect(onChange).toHaveBeenLastCalledWith(null)

    await chooseProject()

    // The saved account: no credentials asked, none sent.
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(mockedApi.zooniverseProjects).toHaveBeenCalledWith({ username: '', password: '' })
    expect(mockedApi.zooniverseSubjectSets).toHaveBeenCalledWith({ username: '', password: '' }, 30567)
    expect(onChange).toHaveBeenLastCalledWith({
      project: { id: 30567, name: 'European Camera Trap Project', slug: 'wildintel/european-camera-trap-project' },
      subject_set_name: defaultSubjectSetName(SELECTION),
    })
    expect(await screen.findByText(/A new subject set will be created/)).toBeInTheDocument()
  })

  it('says when the subject set already exists and will get the images', async () => {
    render(<ZooniverseDestinationForm selection={SELECTION} onDestinationChange={vi.fn()} />)
    await chooseProject()
    await userEvent.clear(screen.getByLabelText('Subject set name'))
    await userEvent.type(screen.getByLabelText('Subject set name'), 'Kittehs')
    expect(await screen.findByText(/already exists \(30 subjects\) — the images will be added to it/)).toBeInTheDocument()
  })

  it('can pick one of the project\'s existing subject sets, searching them', async () => {
    const onChange = vi.fn()
    render(<ZooniverseDestinationForm selection={SELECTION} onDestinationChange={onChange} />)
    await chooseProject()
    await userEvent.click(screen.getByRole('radio', { name: 'Existing subject set' }))
    expect(screen.queryByLabelText('Subject set name')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByText('Choose a subject set.')).toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Subject sets' })
    expect(within(list).getAllByRole('button')).toHaveLength(2)
    await userEvent.type(screen.getByLabelText('Search subject sets'), 'kit')
    expect(within(list).getAllByRole('button')).toHaveLength(1)
    await userEvent.clear(screen.getByLabelText('Search subject sets'))
    await userEvent.type(screen.getByLabelText('Search subject sets'), '134791')
    await userEvent.click(within(list).getByRole('button', { name: /Doñana_2_R0033_33_2026-03/ }))

    expect(within(list).getByRole('button', { name: /Doñana_2_R0033_33_2026-03/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/will be added to/)).toHaveTextContent(/Doñana_2_R0033_33_2026-03 \(86\D?878 subjects\)/)
    expect(onChange).toHaveBeenLastCalledWith({
      project: { id: 30567, name: 'European Camera Trap Project', slug: 'wildintel/european-camera-trap-project' },
      subject_set_name: 'Doñana_2_R0033_33_2026-03',
    })

    // Back to a new one: its own name again.
    await userEvent.click(screen.getByRole('radio', { name: 'New subject set' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ subject_set_name: defaultSubjectSetName(SELECTION) }))
  })

  it('has no destination while the name is blank', async () => {
    const onChange = vi.fn()
    render(<ZooniverseDestinationForm selection={SELECTION} onDestinationChange={onChange} />)
    await chooseProject()
    await userEvent.clear(screen.getByLabelText('Subject set name'))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByText('Give the subject set a name.')).toBeInTheDocument()
  })

  it('chooses a saved destination again once the projects load', async () => {
    const onChange = vi.fn()
    render(<ZooniverseDestinationForm selection={SELECTION} initial={DESTINATION} onDestinationChange={onChange} />)

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(DESTINATION))
    expect(await screen.findByText(/already exists \(86\D?878 subjects\)/)).toBeInTheDocument()
  })

  it('shows a spinner while the projects load', async () => {
    let resolve: (v: { results: typeof ZOONIVERSE_PROJECTS }) => void = () => {}
    mockedApi.zooniverseProjects.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<ZooniverseDestinationForm selection={SELECTION} onDestinationChange={vi.fn()} />)

    expect(screen.getByLabelText('Zooniverse project')).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    await act(async () => resolve({ results: ZOONIVERSE_PROJECTS }))
    await waitFor(() => expect(screen.getByLabelText('Zooniverse project')).toBeEnabled())
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })

  it('shows why the projects could not be loaded', async () => {
    mockedApi.zooniverseProjects.mockRejectedValue(new Error('Missing Zooniverse username — save it in the configuration first.'))
    render(<ZooniverseDestinationForm selection={SELECTION} onDestinationChange={vi.fn()} />)
    expect(await screen.findByText(/Missing Zooniverse username/)).toBeInTheDocument()
  })
})
