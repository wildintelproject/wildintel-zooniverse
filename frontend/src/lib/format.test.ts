import { describe, expect, it } from 'vitest'
import { formatAgo, formatBytes, formatDateTime, formatDuration } from './format'

describe('format', () => {
  it('writes dates the same way everywhere, in UTC when asked', () => {
    expect(formatDateTime('2026-10-09T16:44:31Z', { utc: true })).toBe('9 Oct 2026, 16:44 UTC')
    expect(formatDateTime('2026-10-09T16:44:31Z', { utc: true, seconds: true })).toBe('9 Oct 2026, 16:44:31 UTC')
    expect(formatDateTime(new Date(2026, 9, 9, 8, 5, 3), { seconds: true })).toBe('9 Oct 2026, 08:05:03')
    expect(formatDateTime(null)).toBe('unknown date')
    expect(formatDateTime('nonsense')).toBe('unknown date')
  })

  it('writes durations, ages and sizes', () => {
    expect(formatDuration(3000)).toBe('3 s')
    expect(formatDuration(134000)).toBe('2 min 14 s')
    expect(formatDuration(3900000)).toBe('1 h 5 min')
    expect(formatAgo('2026-10-09T10:00:00Z', Date.parse('2026-10-09T12:00:00Z'))).toBe('2 hours ago')
    expect(formatAgo(null)).toBe('')
    expect(formatBytes(512 * 1024)).toBe('512 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
