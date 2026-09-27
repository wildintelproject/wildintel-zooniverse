/** What the ids are: Trapper media ids (an upload's lists) or Zooniverse
 * subject ids (the utilities'). */
export type IdKind = 'media' | 'subject'

const COLUMNS: Record<IdKind, string[]> = {
  media: ['media_id', 'mediaid', 'media_ids', 'media'],
  subject: ['subject_id', 'subjectid', 'subject_ids', 'subject'],
}

/** Reads Trapper media ids from what a user loads or pastes — see parseIds. */
export function parseMediaIds(text: string): { ids: number[]; ignored: number } {
  return parseIds(text, 'media')
}

/** Reads ids from what a user loads or pastes:
 *  - a plain list — one per line, or separated by commas, spaces, "|"…;
 *  - a CSV/TSV with a header: its id column ("media_id", "mediaID",
 *    "media_ids"… or "subject_id", "subject_ids"… — "|"-separated lists
 *    too, as "Download sequences" writes them);
 *  - a JSON array of ids, or of objects with one (media_id / subject_id,
 *    subject_ids) — or a report of the app's: for media ids, the
 *    Validation & audit report's missing images; for subject ids, its
 *    subjects with metadata issues, or an Update metadata log's subjects.
 * Returns the ids, unique and sorted, and how many tokens weren't ids. */
export function parseIds(text: string, kind: IdKind): { ids: number[]; ignored: number } {
  const trimmed = text.trim()
  if (!trimmed) return { ids: [], ignored: 0 }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const fromJson = parseJson(trimmed, kind)
    if (fromJson) return fromJson
  }
  const lines = trimmed.split(/\r?\n/)
  const header = lines[0].split(/[,;\t]/).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase())
  const column = header.findIndex((h) => COLUMNS[kind].includes(h))
  if (column >= 0) {
    const tokens = lines.slice(1).flatMap((line) => (line.split(/[,;\t]/)[column] ?? '').replace(/"/g, '').split('|'))
    return collect(tokens)
  }
  return collect(trimmed.split(/[\s,;|]+/))
}

function collect(tokens: string[]): { ids: number[]; ignored: number } {
  const ids = new Set<number>()
  let ignored = 0
  for (const raw of tokens) {
    const token = raw.trim()
    if (!token) continue
    if (/^\d+$/.test(token)) ids.add(Number(token))
    else ignored += 1
  }
  return { ids: [...ids].sort((a, b) => a - b), ignored }
}

function parseJson(text: string, kind: IdKind): { ids: number[]; ignored: number } | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  // A report of the app's: the list that matters for this kind of id.
  const reportKeys = kind === 'media' ? ['missing'] : ['metadata_issues', 'subjects']
  let items: unknown[] = []
  if (Array.isArray(data)) items = data
  else if (data && typeof data === 'object') {
    const key = reportKeys.find((k) => Array.isArray((data as Record<string, unknown>)[k]))
    if (key) items = (data as Record<string, unknown[]>)[key]
  }
  const field = kind === 'media' ? 'media_id' : 'subject_id'
  return collect(items.flatMap((item) => {
    if (typeof item === 'number' || typeof item === 'string') return [String(item)]
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (field in record) return [String(record[field])]
      if (kind === 'subject' && Array.isArray(record.subject_ids)) return record.subject_ids.map(String)
    }
    return ['?']
  }))
}
