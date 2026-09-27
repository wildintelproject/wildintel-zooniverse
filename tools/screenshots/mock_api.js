// The web app's backend, faked inside the page for the documentation's
// screenshots (see capture.py): window.fetch answers /api/* from the sample
// data below — no Trapper, no Zooniverse, no real account. Streaming
// endpoints send their NDJSON events a few milliseconds apart; with
// hold: true the stream stays open after them, so a screenshot catches the
// run midway. capture.py changes window.__mock before a step when needed.
(() => {
  const TRAPPER_URL = 'https://trapper.example.org'

  const DEPLOYMENTS = [
    ['R0033-DONA_0001_A', 4812], ['R0033-DONA_0003_A', 3120], ['R0033-DONA_0007_B', 6254],
    ['R0033-DONA_0012_A', 1893], ['R0033-DONA_0015_B', 2740], ['R0033-DONA_0021_A', 5102],
  ].map(([deployment_id, image_count], i) => ({
    pk: 40 + i, deployment_id, location_id: deployment_id.slice(6), image_count,
    start_date: `2024-09-0${i + 2}T10:00:00`, end_date: `2024-11-1${i}T16:30:00`,
  }))

  const counts = (d) => {
    const candidates = Math.round(d.image_count * 0.62)
    const sequences = Math.round(candidates / 7.5)
    const removed_middle = Math.round(sequences * 0.04)
    return {
      deployment_id: d.deployment_id, images: d.image_count, candidates, sequences, removed_middle,
      selected: Math.min(candidates, sequences * 5) - removed_middle * 3,
    }
  }

  const sequenceDetail = (d) => {
    const out = []
    let media = d.pk * 100000
    const start = new Date(`2024-09-04T06:12:00Z`).getTime()
    for (let n = 1; n <= 24; n++) {
      const images = [3, 8, 5, 12, 2, 6, 9, 4][n % 8]
      const ids = Array.from({ length: images }, () => ++media)
      const middleHuman = n === 7
      const t0 = start + n * 3.7 * 3600e3
      out.push({
        number: n, start: new Date(t0).toISOString().slice(0, 19), end: new Date(t0 + images * 11e3).toISOString().slice(0, 19),
        duration_s: images * 11, images,
        uploaded: middleHuman ? [] : ids.slice(0, 5), not_sampled: middleHuman ? [] : ids.slice(5),
        removed_human: middleHuman ? ids : [], removed_vehicle: [],
      })
    }
    return out
  }

  const SUBJECT_SETS = [
    { id: 134791, display_name: 'Doñana_2_R0033_33_2026-03', subjects_count: 86878 },
    { id: 131022, display_name: 'Doñana_2_R0031_31_2025-12', subjects_count: 40211 },
    { id: 128950, display_name: 'Pilot — autumn 2025', subjects_count: 1250 },
  ]

  const PROJECTS = [
    { id: 30567, display_name: 'European Camera Trap Project', slug: 'wildintel/european-camera-trap-project' },
    { id: 12188, display_name: 'Iberian Camera Trap Project', slug: 'wildintel/iberian-camera-trap-project' },
  ]

  const SETTINGS = {
    GENERAL: { log_level: 'INFO', log_file: '/home/me/.config/wildintel-zooniverse/logs/wildintel-zooniverse.log', log_level_override: null },
    TRAPPER: {
      base_url: TRAPPER_URL, user_name: 'field.team', has_password: true,
      download_workers: 4, download_attempts: 5, download_retry_delay: 15,
    },
    ZOONIVERSE: {
      user_name: 'field.team', has_password: true, upload_workers: 4, upload_attempts: 5, upload_retry_delay: 30,
      export_classified_by: 'zooniverse@wildintel-project.org', export_max_file_size_mb: 1.5,
    },
    SEQUENCES: { max_interval: 90, images_per_sequence: 5, only_classified: true, remove_middle_humans: true, remove_middle_vehicles: false },
  }

  const SELECTION = {
    url: TRAPPER_URL,
    research_project: { pk: 2, name: 'Doñana' },
    classification_project: { pk: 10, name: 'Doñana 2024' },
    collection: { pk: 33, name: 'R0033' },
    deployments: DEPLOYMENTS.map(({ pk, deployment_id, image_count }) => ({ pk, deployment_id, image_count })),
    all_deployments: true,
  }

  const file = (d, media) => `${media}_x_${d}_x_IMG_${String(media % 10000).padStart(4, '0')}.JPG`

  // An upload: the first deployments done, one halfway with images in
  // flight — held open there.
  const uploadEvents = (dryRun) => {
    const name = mock.session?.destination?.subject_set_name ?? SUBJECT_SETS[0].display_name
    const existing = SUBJECT_SETS.find((ss) => ss.display_name === name)
    const events = [{ type: 'start', dry_run: dryRun, subject_set: { name, id: existing?.id ?? (dryRun ? null : 135002), exists: !!existing } }]
    DEPLOYMENTS.slice(0, 3).forEach((d, i) => {
      const c = counts(d)
      events.push({ type: 'fetching', deployment_id: d.deployment_id })
      events.push({ type: 'deployment', ...c, filtered_out: 0 })
      const done = i < 2 ? c.selected : Math.round(c.selected * 0.46)
      for (let k = 0; k < done; k++) {
        const media = d.pk * 100000 + k
        const failed = i === 1 && k % 173 === 5
        events.push({
          type: 'image', media_id: media, deployment_id: d.deployment_id, file_name: file(d.deployment_id, media),
          status: failed ? 'failed' : 'uploaded', ...(failed ? { step: 'download', detail: 'Trapper answered 404: the file is missing' } : {}),
        })
      }
      if (i === 2) {
        for (let k = done; k < done + 4; k++) {
          const media = d.pk * 100000 + k
          events.push({ type: 'step', step: k < done + 2 ? 'upload' : 'download', media_id: media, deployment_id: d.deployment_id, file_name: file(d.deployment_id, media) })
        }
      }
    })
    return events
  }

  const metadataEvents = () => {
    const events = [{ type: 'trapper', total: 6 }]
    DEPLOYMENTS.forEach((d) => events.push({ type: 'deployment', deployment_id: d.deployment_id, media: counts(d).selected }))
    events.push({ type: 'subjects', id: 134791, name: 'Doñana_2_R0033_33_2026-03', total: 1250 })
    const tally = { unchanged: 0, unmatched: 0, not_found: 0, would_update: 0, updated: 0, failed: 0, filtered_out: 0 }
    for (let i = 0; i < 1250; i++) {
      const media = 4000000 + i
      const status = i % 9 === 0 ? 'would_update' : i === 611 ? 'unmatched' : 'unchanged'
      tally[status]++
      events.push({
        type: 'subject', subject_id: 98000000 + i, media_id: status === 'unmatched' ? null : media, status,
        changes: status === 'would_update'
          ? [{ field: 'Filename', old: `IMG_${i}.JPG`, new: `${media}_x_R0033-DONA_0001_A_x_IMG_${i}.JPG` },
             { field: 'image_name', old: `IMG_${i}.JPG`, new: `${media}_x_R0033-DONA_0001_A_x_IMG_${i}.JPG` }]
          : [],
      })
    }
    events.push({ type: 'done', dry_run: true, ...tally })
    return events
  }

  const downloadEvents = () => {
    const events = []
    SUBJECT_SETS.slice(1, 3).reverse().forEach((ss, i) => {
      const total = ss.subjects_count
      events.push({ type: 'subject_set', id: ss.id, name: ss.display_name, total, folder: `/home/me/Documents/wildintel-zooniverse/downloads/${ss.id}` })
      const done = i === 0 ? total : 14000
      for (let k = 0; k < done; k++) {
        events.push({ type: 'subject', subject_set_id: ss.id, subject_id: 97000000 + i * 10000 + k, file_name: `subject_${k}.jpg`, status: k < 40 && i === 0 ? 'existing' : 'downloaded' })
      }
      if (i === 1) for (let k = done; k < done + 3; k++) events.push({ type: 'step', subject_set_id: ss.id, subject_id: 97010000 + k, file_name: `${97010000 + k}.jpg` })
    })
    return events
  }

  const validationEvents = () => {
    const subjects = 26114
    const deployments = DEPLOYMENTS.map((d) => { const c = counts(d); return { ...c, expected: c.selected } })
    const expected = deployments.reduce((s, d) => s + d.expected, 0)
    const missing = Array.from({ length: 37 }, (_, i) => ({ media_id: 4300000 + i * 17, deployment_id: DEPLOYMENTS[2].deployment_id, file_name: `IMG_${2200 + i}.JPG` }))
    return [
      { type: 'subjects', id: 134791, name: 'Doñana_2_R0033_33_2026-03', total: subjects },
      { type: 'progress', phase: 'subjects', done: subjects },
      { type: 'trapper', total: 6 },
      ...deployments.map((d) => ({ type: 'deployment', ...counts(DEPLOYMENTS.find((x) => x.deployment_id === d.deployment_id)) })),
      {
        type: 'report', subject_set: { id: 134791, name: 'Doñana_2_R0033_33_2026-03' }, subjects, media: subjects - 3,
        uploaded: [], duplicated: [
          { media_id: 4012345, subject_ids: [98011201, 98033410] }, { media_id: 4012388, subject_ids: [98011244, 98033453] },
          { media_id: 4051002, subject_ids: [98021990, 98034001] },
        ],
        unmatched: [98000611],
        metadata_issues: [
          { subject_id: 98000611, media_id: null, issues: ['no #mediaID'] },
          { subject_id: 98001702, media_id: 4001702, issues: ['external_id points to another Trapper instance'] },
        ],
        compared: true, expected, missing, extra: [{ media_id: 3999001, subject_ids: [97999001] }],
        deployments: deployments.map((d) => ({
          deployment_id: d.deployment_id, expected: d.expected,
          missing: d.deployment_id === DEPLOYMENTS[2].deployment_id ? 37 : 0,
          uploaded: d.expected - (d.deployment_id === DEPLOYMENTS[2].deployment_id ? 37 : 0),
        })),
      },
      { type: 'done' },
    ]
  }

  const exportEvents = () => [
    { type: 'export', state: 'ready', updated_at: '2026-09-20T08:14:00Z' },
    { type: 'classifications', rows: 412000, bytes: 180e6, total_bytes: 180e6 },
    { type: 'classifications_done', rows: 412377, subjects: 26114 },
    { type: 'trapper', total: 6 },
    ...DEPLOYMENTS.map((d) => ({ type: 'deployment', deployment_id: d.deployment_id, media: counts(d).selected, observations: Math.round(counts(d).selected * 1.1) })),
    { type: 'subjects', total: 26114 },
    { type: 'progress', done: 26114 },
    {
      type: 'done', workflow: { id: 29186, name: 'Species identification' }, subjects: 26114, exported: 24987,
      observations: 26402, rows: 27711,
      skipped: { not_in_trapper: 12, no_media_id: 1, no_valid_classifications: 311, no_decision: 803 },
      samples: { not_in_trapper: [98000011, 98000019], no_media_id: [98000611], no_valid_classifications: [98000101], no_decision: [98000201, 98000202] },
      files: [
        { path: '/home/me/Documents/wildintel-zooniverse/exports/observations_wf29186_cp10_col33_20260927-101500_part001.csv', rows: 14012, bytes: 1_550_000 },
        { path: '/home/me/Documents/wildintel-zooniverse/exports/observations_wf29186_cp10_col33_20260927-101500_part002.csv', rows: 13699, bytes: 1_498_000 },
      ],
      zoo_annotations_file: { path: '/home/me/Documents/wildintel-zooniverse/exports/zoo_annotations_observations_wf29186_cp10_col33_20260927-101500.csv', rows: 101223, bytes: 9_800_000 },
      output_dir: '/home/me/Documents/wildintel-zooniverse/exports',
      trapper_import_url: `${TRAPPER_URL}/media_classification/classification/import/`,
    },
  ]

  // A stand-in for a camera-trap photo: a night-vision-grey scene.
  const placeholder = (i) => 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="#8a8f86"/><stop offset="1" stop-color="#3d423a"/></linearGradient></defs>`
    + `<rect width="640" height="480" fill="url(#g)"/><path d="M0 330 Q160 ${280 + (i % 5) * 12} 320 320 T640 300 V480 H0Z" fill="#2c3029"/>`
    + `<rect y="452" width="640" height="28" fill="#000" opacity=".55"/><text x="12" y="471" fill="#eee" font-family="monospace" font-size="15">`
    + `DONA_0001_A  2024-09-${String(4 + (i % 20)).padStart(2, '0')} 06:${String(10 + (i % 49)).padStart(2, '0')}:12  14°C</text></svg>`)

  const subject = (i) => {
    const media = 4000000 + i
    const name = `${media}_x_R0033-DONA_0001_A_x_IMG_${1000 + i}.JPG`
    return {
      id: 98000000 + i, images: [placeholder(i)], subject_sets: [134791],
      created_at: '2026-03-12T10:20:00Z', media_id: media,
      metadata: {
        Filename: name, image_name: name, external_id: `${TRAPPER_URL}/:media:${media}`,
        link: `${TRAPPER_URL}/storage/resource/media/${media}/file/`, origin: TRAPPER_URL, license: 'CC BY-NC 4.0',
      },
    }
  }

  const now = '2026-09-27T09:41:00+00:00'
  const baseSession = { created_at: '2026-09-26T16:02:00+00:00', updated_at: now, status: '', error: null, task: 'upload', source_type: 'trapper' }

  const mock = {
    sessions: [],
    session: null,
    streamDelay: 0,
    streams: {
      '/api/trapper/upload-preview': (body) => ({
        events: [...DEPLOYMENTS.filter((d) => body.selection.deployments.some((x) => x.pk === d.pk))
          .map((d) => ({ type: 'deployment', ...counts(d), ...(body.detail ? { sequence_detail: sequenceDetail(d) } : {}) })), { type: 'done' }],
      }),
      '/api/upload/dry-run': () => ({ events: uploadEvents(true), hold: true }),
      '/api/upload/start': () => ({ events: uploadEvents(false), hold: true }),
      '/api/zooniverse/download-subject-sets': () => ({ events: downloadEvents(), hold: true }),
      '/api/validation/subject-set': () => ({ events: validationEvents() }),
      '/api/metadata/update': () => ({ events: metadataEvents() }),
      '/api/export/classifications': () => ({ events: exportEvents() }),
      '/api/export/import': (body) => ({
        events: [
          ...body.files.flatMap((path, i) => [
            { type: 'file', path, index: i + 1, total: body.files.length },
            { type: 'imported', path, message: 'Classifications import started', task_id: `c1a2-${i}` },
          ]),
          { type: 'done', imported: body.files.length, failed: 0 },
        ],
      }),
    },
    json: {
      'GET /api/health': () => ({ status: 'ok' }),
      'GET /api/version': () => ({ current: '0.1.0' }),
      'GET /api/settings': () => SETTINGS,
      'PUT /api/settings': () => SETTINGS,
      'GET /api/trapper/config': () => ({ base_url: TRAPPER_URL, user_name: 'field.team', has_password: true }),
      'POST /api/trapper/test-connection': () => ({ ok: true, research_projects_count: 3 }),
      'POST /api/trapper/research-projects': () => ({ results: [
        { pk: 2, name: 'Doñana', acronym: 'DONA' }, { pk: 5, name: 'Sierra Morena', acronym: 'SMOR' }, { pk: 7, name: 'Bavarian Forest', acronym: 'BFNP' },
      ] }),
      'POST /api/trapper/classification-projects': () => ({ results: [{ pk: 10, name: 'Doñana 2024', is_active: true }, { pk: 11, name: 'Doñana 2023', is_active: false }] }),
      'POST /api/trapper/collections': () => ({ results: [
        { pk: 33, name: 'R0033', status: 'Public', total_count: 23921, classified_count: 21870, approved_count: 20114 },
        { pk: 31, name: 'R0031', status: 'Public', total_count: 18040, classified_count: 18040, approved_count: 18040 },
      ] }),
      'POST /api/trapper/deployments': () => ({ results: DEPLOYMENTS }),
      'GET /api/zooniverse/config': () => ({ user_name: 'field.team', has_password: true }),
      'POST /api/zooniverse/test-connection': () => ({ ok: true, login: 'field.team', display_name: 'Field team' }),
      'POST /api/zooniverse/projects': () => ({ results: PROJECTS }),
      'POST /api/zooniverse/subject-sets': () => ({ results: SUBJECT_SETS }),
      'POST /api/zooniverse/workflows': () => ({ results: [
        { id: 29186, display_name: 'Species identification', active: true, exportable: true },
        { id: 29187, display_name: 'Species identification (experts)', active: true, exportable: true },
        { id: 25001, display_name: 'Tutorial', active: false, exportable: false },
      ] }),
      'POST /api/zooniverse/workflow-export': () => ({ export: { state: 'ready', updated_at: '2026-09-20T08:14:00Z' } }),
      'POST /api/zooniverse/subjects/lookup': (body) => ({ subjects: body.subject_ids.filter((id) => id !== 98999999).map((id) => subject(id - 98000000)), not_found: body.subject_ids.filter((id) => id === 98999999) }),
      'POST /api/zooniverse/subjects/page': (body) => ({ subjects: Array.from({ length: 12 }, (_, i) => subject(i + (body.page - 1) * 50)), page: body.page, page_count: 1738, count: 86878, page_size: 50 }),
      'GET /api/zooniverse/download-defaults': () => ({ output_dir: '/home/me/Documents/wildintel-zooniverse/downloads' }),
      'GET /api/export/defaults': () => ({ output_dir: '/home/me/Documents/wildintel-zooniverse/exports', classified_by: 'zooniverse@wildintel-project.org', max_file_size_mb: 1.5 }),
      'GET /api/sessions': () => mock.sessions,
      'POST /api/sessions/selection': (body) => (mock.session = { ...baseSession, task_id: body.task_id ?? '5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90', phase: 'selected', selection: body.selection }),
      'POST /api/sessions/criteria': (body) => (mock.session = { ...mock.session, phase: 'filtered', criteria: body.criteria }),
      'POST /api/sessions/destination': (body) => (mock.session = { ...mock.session, phase: 'destination', destination: body.destination }),
      'POST /api/sessions/media-lists': (body) => (mock.session = { ...mock.session, media_lists: { include: body.include, exclude: body.exclude } }),
    },
    // Unfinished runs, for the resume page.
    unfinished: [
      {
        ...baseSession, task_id: '5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90', phase: 'uploading', selection: SELECTION,
        criteria: SETTINGS.SEQUENCES,
        destination: { project: PROJECTS[0], subject_set_name: 'Doñana_2_R0033_33_2026-03' },
        upload: { subject_set_id: 134791, started_at: '2026-09-26T16:40:00+00:00', finished_at: null, uploaded: 6120, skipped: 0, failed: 4 },
      },
      {
        ...baseSession, task_id: '0b7d9e44-1c2f-4a88-b3d1-7e5a0c9f2b61', phase: 'filtered', created_at: '2026-09-22T11:15:00+00:00', updated_at: '2026-09-22T11:31:00+00:00',
        selection: { ...SELECTION, collection: { pk: 31, name: 'R0031' }, deployments: SELECTION.deployments.slice(0, 2), all_deployments: false },
        criteria: SETTINGS.SEQUENCES,
      },
    ],
  }
  window.__mock = mock

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const realFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init)
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : {}
    await sleep(30)

    const stream = mock.streams[url.pathname]
    if (stream) {
      const { events, hold } = stream(body)
      const encoder = new TextEncoder()
      const signal = init.signal
      return new Response(new ReadableStream({
        async start(controller) {
          // A few at a time: the page renders as it would with a real run.
          for (let i = 0; i < events.length; i += 200) {
            if (signal?.aborted) return
            controller.enqueue(encoder.encode(events.slice(i, i + 200).map((e) => JSON.stringify(e) + '\n').join('')))
            await sleep(mock.streamDelay)
          }
          if (!hold) controller.close()
        },
      }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
    }

    const key = `${method} ${url.pathname}`
    const handler = mock.json[key] ?? (method === 'DELETE' ? () => ({ status: 'ok' }) : null)
    if (!handler) {
      console.warn('[mock] unhandled', key)
      return new Response(JSON.stringify({ detail: `Not mocked: ${key}` }), { status: 404 })
    }
    return new Response(JSON.stringify(handler(body)), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
})()
