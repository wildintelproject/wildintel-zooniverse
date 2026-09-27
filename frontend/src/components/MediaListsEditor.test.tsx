import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import MediaListsEditor from './MediaListsEditor'
import { DESTINATION_SESSION } from '../test/fixtures'

vi.mock('../api', () => ({ api: { saveMediaLists: vi.fn() } }))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.saveMediaLists.mockImplementation(async (taskId, include, exclude) => (
    { ...DESTINATION_SESSION, task_id: taskId, media_lists: { include, exclude } }
  ))
})

describe('MediaListsEditor', () => {
  it('saves a blacklist typed in, once left', async () => {
    const onSaved = vi.fn()
    render(<MediaListsEditor session={DESTINATION_SESSION} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: /media lists/i }))

    await userEvent.type(screen.getByLabelText('Never these images'), '12, 7 x 12')
    expect(screen.getByText('not an id, ignored', { exact: false })).toBeInTheDocument()
    await userEvent.tab()

    expect(mockedApi.saveMediaLists).toHaveBeenCalledWith('task-1', null, [7, 12])
    expect(await screen.findByText('Saved in the session.')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ media_lists: { include: null, exclude: [7, 12] } }))
    expect(screen.getByText('never 2 image(s)')).toBeInTheDocument()
  })

  it('loads a whitelist from a file — here, the validation report', async () => {
    render(<MediaListsEditor session={DESTINATION_SESSION} onSaved={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /media lists/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /upload only some images/i }))
    expect(mockedApi.saveMediaLists).toHaveBeenLastCalledWith('task-1', [], [])

    const report = new File([JSON.stringify({ missing: [{ media_id: 30 }, { media_id: 4 }] })], 'validation.json', { type: 'application/json' })
    await userEvent.upload(screen.getByLabelText('Only these images file'), report)

    expect(await screen.findByLabelText('Only these images')).toHaveValue('4\n30')
    expect(mockedApi.saveMediaLists).toHaveBeenLastCalledWith('task-1', [4, 30], [])
    expect(screen.getByText('only 2 image(s)')).toBeInTheDocument()
  })

  it("starts from the session's own lists, and can clear them", async () => {
    render(<MediaListsEditor session={{ ...DESTINATION_SESSION, media_lists: { include: [1, 2], exclude: [9] } }} onSaved={vi.fn()} />)
    expect(screen.getByText('only 2 image(s) · never 1 image(s)')).toBeInTheDocument()
    expect(screen.getByLabelText('Only these images')).toHaveValue('1\n2')

    await userEvent.click(screen.getAllByRole('button', { name: 'Clear' })[1])
    expect(mockedApi.saveMediaLists).toHaveBeenLastCalledWith('task-1', [1, 2], [])
    await userEvent.click(screen.getByRole('checkbox', { name: /upload only some images/i }))
    expect(mockedApi.saveMediaLists).toHaveBeenLastCalledWith('task-1', null, [])
  })

  it('warns about ids in both lists — they are never uploaded', async () => {
    render(<MediaListsEditor session={{ ...DESTINATION_SESSION, media_lists: { include: [1, 2, 3], exclude: [3, 9] } }} onSaved={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('1 id is in both lists — never these wins, so it won’t be uploaded: 3')

    await userEvent.type(screen.getByLabelText('Never these images'), '\n2')
    expect(screen.getByRole('status')).toHaveTextContent('2 ids are in both lists — never these wins, so they won’t be uploaded: 2, 3')

    // Without the whitelist, nothing to warn about.
    await userEvent.click(screen.getByRole('checkbox', { name: /upload only some images/i }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
