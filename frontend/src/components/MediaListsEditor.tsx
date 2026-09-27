import { useState } from 'react'
import { api } from '../api'
import IdListsEditor, { NO_LISTS } from './IdListsEditor'
import type { IdLists } from './IdListsEditor'
import type { SessionSummary } from '../types'

const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'

type Save = { kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }

interface Props {
  session: SessionSummary
  onSaved: (session: SessionSummary) => void
  disabled?: boolean
}

/** The upload's whitelist and blacklist of Trapper media ids — wildintel-
 * tools' --media / --exclude-media: applied after sampling, to the dry run
 * and the upload alike, and kept in the session. A file can be loaded: a
 * list of ids, a CSV with a media id column (Download sequences'), or the
 * Validation & audit report (its missing images). */
export default function MediaListsEditor({ session, onSaved, disabled = false }: Props) {
  const [save, setSave] = useState<Save>({ kind: 'idle' })

  async function persist(lists: IdLists) {
    setSave({ kind: 'saving' })
    try {
      onSaved(await api.saveMediaLists(session.task_id, lists.include, lists.exclude))
      setSave({ kind: 'saved' })
    } catch (e) {
      setSave({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save the lists.' })
    }
  }

  return (
    <IdListsEditor
      kind="media" initial={session.media_lists ?? NO_LISTS} onCommit={persist} disabled={disabled}
      intro={<>
        Applied after the filters, to the dry run and the upload alike, and kept in this session. Load a list of ids, a CSV
        with a media id column (e.g. <em>Download sequences</em>&rsquo;), or a <em>Validation &amp; audit</em> report — its
        missing images.
      </>}
      status={<>
        {save.kind === 'saving' && <p className={hintClass}>Saving…</p>}
        {save.kind === 'saved' && <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2">Saved in the session.</p>}
        {save.kind === 'error' && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{save.message}</p>}
      </>}
    />
  )
}
