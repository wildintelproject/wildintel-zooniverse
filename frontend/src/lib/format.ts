const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const two = (n: number) => String(n).padStart(2, '0')

/** "9 Oct 2026, 16:44" — in the browser's time zone — or, with `utc`,
 * "9 Oct 2026, 16:44 UTC" (Zooniverse's own dates: the same whatever the
 * time zone of the browser). `seconds` adds them: "16:44:31". */
export function formatDateTime(
  value: string | number | Date | null | undefined, { utc = false, seconds = false }: { utc?: boolean; seconds?: boolean } = {},
): string {
  const d = value === null || value === undefined || value === '' ? null : new Date(value)
  if (!d || Number.isNaN(d.getTime())) return 'unknown date'
  const [day, month, year, h, m, s] = utc
    ? [d.getUTCDate(), d.getUTCMonth(), d.getUTCFullYear(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    : [d.getDate(), d.getMonth(), d.getFullYear(), d.getHours(), d.getMinutes(), d.getSeconds()]
  return `${day} ${MONTHS[month]} ${year}, ${two(h)}:${two(m)}${seconds ? `:${two(s)}` : ''}${utc ? ' UTC' : ''}`
}

/** "3 s", "2 min 14 s", "1 h 5 min". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** "5 minutes ago", "2 hours ago", "3 days ago" — empty if the date isn't one. */
export function formatAgo(iso: string | null, now = Date.now()): string {
  const ms = iso ? now - new Date(iso).getTime() : NaN
  if (Number.isNaN(ms)) return ''
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 60) return plural(minutes, 'minute')
  if (minutes < 60 * 24) return plural(Math.round(minutes / 60), 'hour')
  return plural(Math.round(minutes / 60 / 24), 'day')
}

/** "512 KB", "5.0 MB". */
export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
