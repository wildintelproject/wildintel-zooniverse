import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Stepper from './Stepper'

describe('Stepper', () => {
  it('ticks the steps before the current one and numbers the rest', () => {
    render(<Stepper labels={['Source', 'Images', 'Zooniverse']} current={1} />)
    expect(screen.getByText('✓')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Zooniverse')).toBeInTheDocument()
  })

  it('gives every step a column of the same width, whatever its label', () => {
    const { container } = render(<Stepper labels={['Source', 'Zooniverse', 'Upload']} current={0} />)
    expect((container.firstChild as HTMLElement).style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
  })
})
