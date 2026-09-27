import { describe, expect, it } from 'vitest'
import { parseIds, parseMediaIds } from './mediaIds'

describe('parseMediaIds', () => {
  it('reads a plain list, however separated, unique and sorted', () => {
    expect(parseMediaIds('12\n7, 9 ;12|3\n\nabc')).toEqual({ ids: [3, 7, 9, 12], ignored: 1 })
  })

  it('reads the media id column of a CSV — also "|"-separated lists', () => {
    const csv = 'deploymentID,sequence_n,media_ids,duration_s\nR1-A,1,10|11,40\nR1-A,2,12,5\n'
    expect(parseMediaIds(csv)).toEqual({ ids: [10, 11, 12], ignored: 0 })
    expect(parseMediaIds('mediaID;other\n5;99\n6;98').ids).toEqual([5, 6])
  })

  it("reads a JSON list, or the validation report's missing images", () => {
    expect(parseMediaIds('[3, "4", {"media_id": 5}]').ids).toEqual([3, 4, 5])
    const report = JSON.stringify({ subjects: 10, missing: [{ media_id: 8, deployment_id: 'D' }, { media_id: 2 }], extra: [{ media_id: 99 }] })
    expect(parseMediaIds(report).ids).toEqual([2, 8])
  })

  it('is empty for nothing', () => {
    expect(parseMediaIds('  ')).toEqual({ ids: [], ignored: 0 })
  })

  it('reads subject ids: a CSV column, or the metadata issues / update log of a report', () => {
    expect(parseIds('subject_id,media\n501,1\n502,2\n', 'subject').ids).toEqual([501, 502])
    const validation = JSON.stringify({ missing: [{ media_id: 1 }], metadata_issues: [{ subject_id: 9, media_id: 1, issues: [] }] })
    expect(parseIds(validation, 'subject').ids).toEqual([9])
    expect(parseIds(validation, 'media').ids).toEqual([1])
    const updateLog = JSON.stringify({ dry_run: true, subjects: [{ subject_id: 12 }, { subject_id: 11 }] })
    expect(parseIds(updateLog, 'subject').ids).toEqual([11, 12])
    expect(parseIds('[{"subject_ids": [3, 4]}]', 'subject').ids).toEqual([3, 4])
  })
})
