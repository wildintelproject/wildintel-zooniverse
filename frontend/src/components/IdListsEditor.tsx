import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { parseIds } from '../lib/mediaIds'
import ChoiceCard from './ChoiceCard'
import type { IdKind } from '../lib/mediaIds'

const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
const btnSmall = 'px-3 py-1 text-xs border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50'
const textareaClass = 'w-full h-24 px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60'

/** A whitelist (null: none) and a blacklist of ids. */
export interface IdLists {
  include: number[] | null
  exclude: number[]
}

export const NO_LISTS: IdLists = { include: null, exclude: [] }

const WORDS: Record<IdKind, { title: string; noun: string; plural: string; action: string; idName: string }> = {
  media: { title: 'Media lists', noun: 'image', plural: 'images', action: 'Upload', idName: 'Media ids' },
  subject: { title: 'Subject lists', noun: 'subject', plural: 'subjects', action: 'Process', idName: 'Subject ids' },
}

function IdList({ id, label, hint, text, kind, onText, onCommit, disabled, variant = 'plain' }: {
  id: string; label: string; hint: string; text: string; kind: IdKind; variant?: 'plain' | 'field'
  onText: (text: string) => void; onCommit: (text: string) => void; disabled: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { ids, ignored } = parseIds(text, kind)
  const words = WORDS[kind]

  async function loadFile(file: File | undefined) {
    if (!file) return
    const listed = parseIds(await file.text(), kind).ids.join('\n')
    onText(listed)
    onCommit(listed)
  }

  if (variant === 'field') {
    return (
      <div>
        <label className="sr-only" htmlFor={id}>{label}</label>
        <textarea
          id={id} className={`${textareaClass} h-24 !text-sm`} value={text} disabled={disabled}
          placeholder={`${words.idName} — one per line, or separated by commas or spaces`}
          onChange={(e) => onText(e.target.value)} onBlur={(e) => onCommit(e.target.value)}
        />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <input
            ref={fileRef} type="file" accept=".txt,.csv,.tsv,.json,text/plain,text/csv,application/json" className="hidden"
            aria-label={`${label} file`} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = '' }}
          />
          <button type="button" className={btnSmall} disabled={disabled} onClick={() => fileRef.current?.click()}>Load from file…</button>
          <button type="button" className={btnSmall} disabled={disabled || !text} onClick={() => { onText(''); onCommit('') }}>Clear</button>
          <span className="ml-auto text-xs text-zinc-600 dark:text-zinc-300">
            <strong>{ids.length.toLocaleString()}</strong> {ids.length === 1 ? words.noun : words.plural}
            {ignored > 0 && <span className="text-amber-700 dark:text-amber-400"> · {ignored} not an id, ignored</span>}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="block text-sm font-semibold mb-1 text-zinc-700 dark:text-zinc-300" htmlFor={id}>{label}</label>
      <textarea
        id={id} className={textareaClass} value={text} disabled={disabled}
        placeholder={`${words.idName} — one per line, or separated by commas or spaces`}
        onChange={(e) => onText(e.target.value)} onBlur={(e) => onCommit(e.target.value)}
      />
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <input
          ref={fileRef} type="file" accept=".txt,.csv,.tsv,.json,text/plain,text/csv,application/json" className="hidden"
          aria-label={`${label} file`} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = '' }}
        />
        <button type="button" className={btnSmall} disabled={disabled} onClick={() => fileRef.current?.click()}>Load file…</button>
        <button type="button" className={btnSmall} disabled={disabled || !text} onClick={() => { onText(''); onCommit('') }}>Clear</button>
        <span className="text-xs text-zinc-600 dark:text-zinc-300">
          <strong>{ids.length.toLocaleString()}</strong> {ids.length === 1 ? words.noun : words.plural}
          {ignored > 0 && <span className="text-amber-700 dark:text-amber-400"> · {ignored} not an id, ignored</span>}
        </span>
      </div>
      <p className={hintClass}>{hint}</p>
    </div>
  )
}

interface Props {
  kind: IdKind
  initial: IdLists
  /** Called when a list is committed — left, loaded, cleared or toggled. */
  onCommit: (lists: IdLists) => void
  /** What the lists apply to, and what files can be loaded. */
  intro: ReactNode
  /** Below the lists — e.g. whether they were saved. */
  status?: ReactNode
  disabled?: boolean
  className?: string
  /** 'cards': always open, the two lists side by side — a list is on while it
   * has ids (no checkbox) — with a note on how they combine. */
  layout?: 'collapsible' | 'cards' | 'choices'
}

/** A collapsible whitelist and blacklist of ids — an upload's Trapper
 * media ids, or a utility's Zooniverse subject ids: with the whitelist, only
 * its ids; never the blacklist's, which wins when an id is in both (a
 * warning says so). Each can be typed, pasted or loaded from a file (see
 * parseIds). */
export default function IdListsEditor({ kind, initial, onCommit, intro, status, disabled = false, className = 'mt-4', layout = 'collapsible' }: Props) {
  const words = WORDS[kind]
  const [whitelistOn, setWhitelistOn] = useState(initial.include != null)
  const [includeText, setIncludeText] = useState((initial.include ?? []).join('\n'))
  const [excludeText, setExcludeText] = useState(initial.exclude.join('\n'))
  const [open, setOpen] = useState(initial.include != null || initial.exclude.length > 0)
  // The 'choices' layout: whether the exclusion list is switched on (the whitelist is, with whitelistOn).
  const [excludeOn, setExcludeOn] = useState(initial.exclude.length > 0)

  function commit(on: boolean, include: string, exclude: string) {
    onCommit({ include: on ? parseIds(include, kind).ids : null, exclude: parseIds(exclude, kind).ids })
  }

  const includeIds = whitelistOn ? parseIds(includeText, kind).ids : null
  const excludeIds = parseIds(excludeText, kind).ids
  // In both lists: the blacklist wins.
  const excluded = new Set(excludeIds)
  const inBoth = (includeIds ?? []).filter((id) => excluded.has(id))
  const summary = [
    includeIds !== null && `only ${includeIds.length.toLocaleString()} ${words.noun}(s)`,
    excludeIds.length > 0 && `never ${excludeIds.length.toLocaleString()} ${words.noun}(s)`,
  ].filter(Boolean).join(' · ')

  const inBothNote = inBoth.length > 0 && (
    <p className="text-xs text-amber-700 dark:text-amber-400 mt-3" role="status">
      {inBoth.length === 1 ? '1 id is' : `${inBoth.length.toLocaleString()} ids are`} in both lists — never these wins,
      so {inBoth.length === 1 ? 'it' : 'they'} won&rsquo;t be {kind === 'media' ? 'uploaded' : 'processed'}:{' '}
      <span className="font-mono">{inBoth.slice(0, 10).join(', ')}{inBoth.length > 10 ? '…' : ''}</span>
    </p>
  )

  if (layout === 'choices') {
    const commitChoices = (specific: boolean, include: string, leaveOut: boolean, exclude: string) =>
      onCommit({ include: specific ? parseIds(include, kind).ids : null, exclude: leaveOut ? parseIds(exclude, kind).ids : [] })
    const note = `Will process ${whitelistOn ? `only the ${words.plural} on your list` : `every eligible ${words.noun}`}${excludeOn ? `, minus the ones you leave out` : ''}.`
    return (
      <div className={className}>
        <div className="space-y-3">
          <ChoiceCard
            group={`${kind}-scope`} name={`All eligible ${words.plural}`} selected={!whitelistOn} disabled={disabled}
            onSelect={() => { setWhitelistOn(false); commitChoices(false, includeText, excludeOn, excludeText) }}
          >
            <p className={hintClass}>Every {words.noun} that can be updated is processed.</p>
          </ChoiceCard>
          <ChoiceCard
            group={`${kind}-scope`} name={`Only specific ${words.plural}`} selected={whitelistOn} disabled={disabled}
            onSelect={() => { setWhitelistOn(true); commitChoices(true, includeText, excludeOn, excludeText) }}
            extra={whitelistOn && (
              <IdList
                id={`${kind}-whitelist`} kind={kind} label={`Only these ${words.plural}`} disabled={disabled} hint="" variant="field"
                text={includeText} onText={setIncludeText} onCommit={(t) => commitChoices(true, t, excludeOn, excludeText)}
              />
            )}
          >
            <p className={hintClass}>Everything that isn&rsquo;t on your list is skipped.</p>
          </ChoiceCard>
          <ChoiceCard
            type="checkbox" name={`Leave some ${words.plural} out`} selected={excludeOn} disabled={disabled}
            onSelect={() => { setExcludeOn(!excludeOn); commitChoices(whitelistOn, includeText, !excludeOn, excludeText) }}
            extra={excludeOn && (
              <IdList
                id={`${kind}-blacklist`} kind={kind} label={`Never these ${words.plural}`} disabled={disabled} hint="" variant="field"
                text={excludeText} onText={setExcludeText} onCommit={(t) => commitChoices(whitelistOn, includeText, true, t)}
              />
            )}
          >
            <p className={hintClass}>These are always skipped, even if they&rsquo;re on the list above.</p>
          </ChoiceCard>
        </div>
        <p className="mt-3 px-4 py-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-300">{note}</p>
        {whitelistOn && excludeOn && inBothNote}
        {status}
      </div>
    )
  }

  if (layout === 'cards') {
    const card = 'p-4 rounded-lg border border-zinc-200 dark:border-zinc-700'
    return (
      <div className={className}>
        {intro && <p className={`${hintClass} mb-3`}>{intro}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={card}>
            <IdList
              id={`${kind}-whitelist`} kind={kind} label={`Only these ${words.plural}`} disabled={disabled}
              hint={`Whitelist · only the ids listed are ${kind === 'media' ? 'uploaded' : 'processed'}.`}
              text={includeText}
              onText={setIncludeText}
              onCommit={(t) => { setWhitelistOn(parseIds(t, kind).ids.length > 0); commit(parseIds(t, kind).ids.length > 0, t, excludeText) }}
            />
          </div>
          <div className={card}>
            <IdList
              id={`${kind}-blacklist`} kind={kind} label={`Never these ${words.plural}`} disabled={disabled}
              hint="Blacklist · the ids listed are left out."
              text={excludeText} onText={setExcludeText}
              onCommit={(t) => commit(parseIds(includeText, kind).ids.length > 0, includeText, t)}
            />
          </div>
        </div>
        <div className="mt-4 p-4 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-600 dark:text-zinc-300">
          <p className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">How the filters apply</p>
          With a whitelist, only those {words.plural} are considered. The blacklist leaves out {words.plural} even if
          they&rsquo;re in the whitelist. Without a whitelist, every eligible {words.noun} is considered, except the excluded ones.
        </div>
        {inBothNote}
        {status}
      </div>
    )
  }

  return (
    <div className={`${className} rounded-lg border border-zinc-200 dark:border-zinc-700`}>
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm"
      >
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">{open ? '▾' : '▸'} {words.title}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{summary || `${words.action} only some ${words.plural}, or leave some out`}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className={`${hintClass} mb-3`}>{intro}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
                <input
                  type="checkbox" checked={whitelistOn} disabled={disabled}
                  onChange={(e) => { setWhitelistOn(e.target.checked); commit(e.target.checked, includeText, excludeText) }}
                />
                <span className="text-zinc-700 dark:text-zinc-300">{words.action} only some {words.plural}</span>
              </label>
              {whitelistOn && (
                <IdList
                  id={`${kind}-whitelist`} kind={kind} label={`Only these ${words.plural}`} disabled={disabled}
                  hint={`Any other ${words.noun} is left out.`}
                  text={includeText} onText={setIncludeText} onCommit={(t) => commit(true, t, excludeText)}
                />
              )}
            </div>
            <IdList
              id={`${kind}-blacklist`} kind={kind} label={`Never these ${words.plural}`} disabled={disabled}
              hint="Left out even if they're in the list of only these."
              text={excludeText} onText={setExcludeText} onCommit={(t) => commit(whitelistOn, includeText, t)}
            />
          </div>
          {inBothNote}
          {status}
        </div>
      )}
    </div>
  )
}
