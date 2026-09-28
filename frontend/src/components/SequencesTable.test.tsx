import { describe, expect, it } from 'vitest'
import { sequencesCsv } from './SequencesTable'
import { PREVIEW_ROWS } from '../test/fixtures'

describe('sequencesCsv', () => {
  it("writes wildintel-tools' analyze-sequences columns, plus why images aren't uploaded", () => {
    const csv = sequencesCsv([{
      ...PREVIEW_ROWS[0],
      sequence_detail: [{
        number: 1, start: '2024-09-04T12:00:00', end: '2024-09-04T12:00:40', duration_s: 40, images: 4,
        uploaded: [1, 4], not_sampled: [2], removed_human: [3], removed_vehicle: [], collapsed_empty: [],
      }],
    }, { ...PREVIEW_ROWS[1] }])

    expect(csv.split('\n')).toEqual([
      'deploymentID,sequence_n,total_images,media_ids,first_date,last_date,duration_s,not_sampled_media_ids,removed_human_media_ids,removed_vehicle_media_ids,collapsed_empty_media_ids',
      'R0033-DONA_0001_A,1,4,1|4,2024-09-04T12:00:00,2024-09-04T12:00:40,40,2,3,,',
      '',
    ])
  })
})
