import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Combobox from './Combobox'

const OPTIONS = [
  { value: '1', label: 'Doñana' },
  { value: '2', label: 'Sierra Morena' },
  { value: '3', label: 'Sierra Nevada' },
]

/** Combobox is controlled — a thin stateful wrapper lets tests drive it like
 * its real callers do. */
function Wrapped({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <Combobox
      id="project" options={OPTIONS} value={value}
      onChange={(v) => { setValue(v); onChange?.(v) }}
      placeholder="Select a project…" clearLabel="Clear project"
    />
  )
}

describe('Combobox', () => {
  it('shows every option on focus, and filters as you type', async () => {
    render(<Wrapped />)
    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    expect(screen.getAllByRole('option')).toHaveLength(3)

    await userEvent.type(input, 'sierra')
    expect(screen.getByRole('option', { name: 'Sierra Morena' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Sierra Nevada' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Doñana' })).not.toBeInTheDocument()
  })

  it('picks an option by clicking it, and shows its label afterwards', async () => {
    const onChange = vi.fn()
    render(<Wrapped onChange={onChange} />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: 'Sierra Morena' }))

    expect(onChange).toHaveBeenCalledWith('2')
    expect(screen.getByRole('combobox')).toHaveValue('Sierra Morena')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('picks the highlighted option with the keyboard', async () => {
    const onChange = vi.fn()
    render(<Wrapped onChange={onChange} />)
    const input = screen.getByRole('combobox')
    await userEvent.type(input, 'sierra nev{Enter}')

    expect(onChange).toHaveBeenCalledWith('3')
    expect(input).toHaveValue('Sierra Nevada')
  })

  it('clears the selection with the clear button', async () => {
    const onChange = vi.fn()
    render(<Wrapped onChange={onChange} />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: 'Doñana' }))
    expect(screen.getByRole('combobox')).toHaveValue('Doñana')

    await userEvent.click(screen.getByRole('button', { name: 'Clear project' }))
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('reverts to the selected label when clicking away without picking anything', async () => {
    render(<Wrapped />)
    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    await userEvent.click(screen.getByRole('option', { name: 'Doñana' }))

    await userEvent.click(input)
    await userEvent.type(input, 'zzz')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    await userEvent.tab()
    expect(input).toHaveValue('Doñana')
  })
})
