import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import TrapperSelectionForm from './TrapperSelectionForm'
import { CLASSIFICATION_PROJECTS, COLLECTIONS, DEPLOYMENTS, RESEARCH_PROJECTS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    trapperGetConfig: vi.fn(),
    trapperTestConnection: vi.fn(),
    trapperResearchProjects: vi.fn(),
    trapperClassificationProjects: vi.fn(),
    trapperCollections: vi.fn(),
    trapperDeployments: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true })
  mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 1 })
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: RESEARCH_PROJECTS })
  mockedApi.trapperClassificationProjects.mockResolvedValue({ results: CLASSIFICATION_PROJECTS })
  mockedApi.trapperCollections.mockResolvedValue({ results: COLLECTIONS })
  mockedApi.trapperDeployments.mockResolvedValue({ results: DEPLOYMENTS })
})

async function walkToDeployments() {
  await waitFor(() => expect(screen.getByLabelText('Trapper URL')).toHaveValue('https://trapper.example.org'))
  await userEvent.click(screen.getByRole('button', { name: /test connection/i }))
  await userEvent.selectOptions(await screen.findByLabelText('Research project'), '2')
  await userEvent.selectOptions(await screen.findByLabelText('Classification project'), '10')
  await userEvent.selectOptions(await screen.findByLabelText('Collection'), '33')
  await screen.findByText('R0033-DONA_0001_A')
}

describe('TrapperSelectionForm', () => {
  it('walks research project -> classification project -> collection -> deployments, all chosen by default', async () => {
    const onSelectionChange = vi.fn()
    render(<TrapperSelectionForm onSelectionChange={onSelectionChange} />)
    await walkToDeployments()

    // a blank password reuses the saved one
    expect(mockedApi.trapperTestConnection).toHaveBeenCalledWith({ url: 'https://trapper.example.org', username: 'alice', password: '' })
    // by the collection's own pk — only deployments with images in it come back
    expect(mockedApi.trapperDeployments).toHaveBeenCalledWith(expect.anything(), 2, 33)
    expect(screen.getByText(/70\/100 approved/)).toBeInTheDocument()
    expect(screen.getByText('2 of 2 selected · 350 images')).toBeInTheDocument()
    expect(screen.getByText(/200 images · 2024-09-05 → 2024-11-05/)).toBeInTheDocument()
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      research_project: { pk: 2, name: 'Doñana' },
      classification_project: { pk: 10, name: 'Main CP' },
      collection: { pk: 33, name: 'R0033' },
      all_deployments: true,
    }))
  })

  it('lets the user choose only some deployments, and none is not a valid selection', async () => {
    const onSelectionChange = vi.fn()
    render(<TrapperSelectionForm onSelectionChange={onSelectionChange} />)
    await walkToDeployments()

    await userEvent.click(screen.getByRole('checkbox', { name: 'R0033-DONA_0007_B' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      deployments: [{ pk: 4, deployment_id: 'R0033-DONA_0001_A', image_count: 150 }], all_deployments: false,
    }))

    expect(screen.getByText('1 of 2 selected · 150 images')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i })) // back to all
    expect(screen.getByText('2 of 2 selected · 350 images')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i })) // none
    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByText(/choose at least one deployment/i)).toBeInTheDocument()
  })

  it('clears everything below when an upper level changes', async () => {
    const onSelectionChange = vi.fn()
    render(<TrapperSelectionForm onSelectionChange={onSelectionChange} />)
    await walkToDeployments()

    await userEvent.selectOptions(screen.getByLabelText('Classification project'), '')
    expect(screen.queryByLabelText('Collection')).not.toBeInTheDocument()
    expect(screen.queryByText('R0033-DONA_0001_A')).not.toBeInTheDocument()
    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('filters a long list of deployments', async () => {
    mockedApi.trapperDeployments.mockResolvedValue({
      results: Array.from({ length: 12 }, (_, i) => ({ pk: i, deployment_id: `R0033-SITE_${String(i).padStart(2, '0')}`, image_count: 10 })),
    })
    render(<TrapperSelectionForm onSelectionChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Trapper URL')).toHaveValue('https://trapper.example.org'))
    await userEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await userEvent.selectOptions(await screen.findByLabelText('Research project'), '2')
    await userEvent.selectOptions(await screen.findByLabelText('Classification project'), '10')
    await userEvent.selectOptions(await screen.findByLabelText('Collection'), '33')

    await userEvent.type(await screen.findByLabelText('Filter deployments'), 'SITE_1')
    expect(screen.getByText('R0033-SITE_10')).toBeInTheDocument()
    expect(screen.queryByText('R0033-SITE_02')).not.toBeInTheDocument()
  })

  it('shows a connection error', async () => {
    mockedApi.trapperTestConnection.mockRejectedValue(new Error('Incorrect Trapper username or password.'))
    render(<TrapperSelectionForm onSelectionChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Trapper URL')).toHaveValue('https://trapper.example.org'))
    await userEvent.click(screen.getByRole('button', { name: /test connection/i }))

    expect(await screen.findByText('Incorrect Trapper username or password.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Research project')).not.toBeInTheDocument()
  })
})
