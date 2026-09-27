import { useState } from 'react'
import OptionCards from '../components/OptionCards'
import type { Option } from '../components/OptionCards'
import DownloadSubjectSetsPage from './DownloadSubjectSetsPage'
import UpdateMetadataPage from './UpdateMetadataPage'
import SubjectsPage from './SubjectsPage'
import ValidationPage from './ValidationPage'

export type Util = 'update-metadata' | 'download-subject-sets' | 'validate' | 'subjects'

/** wildintel-tools' own zooniverse utilities (update-metadata, download_ss,
 * and the check-* commands). */
const UTIL_OPTIONS: Option<Util>[] = [
  {
    value: 'update-metadata', emoji: '🏷️', title: 'Update metadata',
    description: "Rewrite the metadata of a subject set's subjects from Trapper — e.g. for subjects uploaded by older tools.",
    available: true,
  },
  {
    value: 'download-subject-sets', emoji: '🖼️', title: 'Download subject sets',
    description: 'Download the images of one or more Zooniverse subject sets to this computer.',
    available: true,
  },
  {
    value: 'validate', emoji: '🔍', title: 'Validation & audit',
    description: 'Check a subject set against its Trapper collection: missing, extra, duplicated or untraceable images, and their metadata.',
    available: true,
  },
  {
    value: 'subjects', emoji: '🔎', title: 'Subjects',
    description: "Look Zooniverse subjects up by id, or browse a subject set's: their image, Trapper image and metadata.",
    available: true,
  },
]

const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors'

interface Props {
  onBack: () => void
}

/** The utilities besides uploading and retrieving classifications — each
 * shown in place of the list once chosen. */
export default function UtilsPage({ onBack }: Props) {
  const [util, setUtil] = useState<Util | null>(null)

  if (util === 'download-subject-sets') return <DownloadSubjectSetsPage onBack={() => setUtil(null)} />
  if (util === 'validate') return <ValidationPage onBack={() => setUtil(null)} />
  if (util === 'update-metadata') return <UpdateMetadataPage onBack={() => setUtil(null)} />
  if (util === 'subjects') return <SubjectsPage onBack={() => setUtil(null)} />

  return (
    <div>
      <h4 className="text-lg font-semibold mb-1">Utilities</h4>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Maintenance and checks for images already in Zooniverse.
      </p>
      <OptionCards options={UTIL_OPTIONS} selected={null} onChoose={setUtil} />
      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack}>Back</button>
      </div>
    </div>
  )
}
