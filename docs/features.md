# Features

## Uploading images to Zooniverse

### Choosing the images

Images come from a **Trapper** instance, chosen the same way wildintel-tools' import wizard
does: research project → classification project → collection → deployments (all of them, or
some).

A collection's deployments are those of the research project that actually have images in it,
with how many each has — stricter than wildintel-tools' "deployment name starts with the
collection's" rule, which also listed deployments with no images in the collection.

### Choosing which images go

Not every image of a collection is uploaded. The same selection wildintel-tools makes, per
deployment:

1. **Candidates** — images whose file is public in Trapper and, optionally, that have at least one
   observation other than *unclassified*.
2. **Sequences** — a deployment's candidates, by time, split wherever two consecutive images are
   more than *N* seconds apart (90 by default).
3. **Middle sequences** — images with humans (and, optionally, vehicles) are removed from every
   sequence but a deployment's first and last — the camera being set up and collected. Removing
   vehicles is new: wildintel-tools only removed humans.
4. **Sampling** — each sequence keeps a few evenly spaced images (5 by default), first and last
   included; shorter ones are kept whole.

A **preview** counts, deployment by deployment, how many images each step keeps — before
anything is uploaded. **Analyze sequences** goes further — wildintel-tools' `analyze-sequences`,
with the very criteria the upload will use: every sequence of every deployment, and what becomes
of each of its images (uploaded, not sampled, removed as a human or a vehicle), also as a CSV.

### The destination

A Zooniverse project you own or collaborate on, and a subject set by name —
wildintel-tools' own default name, `{research project}_{pk}_{collection}_{pk}_{YYYY-MM}`. An
existing subject set with that name gets the new subjects; otherwise it's created.

### Dry run and upload

A **dry run** goes through exactly the same steps as the upload — the images are fetched from
Trapper and sampled, the subject set is looked up — but only simulates downloading and uploading
each image. It shows what would be uploaded, and whether the subject set would be created.

The **upload** itself, deployment by deployment:

- each image is downloaded from Trapper, uploaded to Zooniverse as a subject, then deleted — never
  "download everything, then upload": only the images in flight are on disk;
- downloads and uploads run on pools of threads of their own (4 each by default), a download
  handing its file to the uploads as soon as it's on disk;
- each step retries with exponential backoff (5 attempts by default), a missing file or a
  Zooniverse quota error excepted;
- each uploaded image is recorded in the session right away, so **stopping, closing the app or
  a failure never uploads an image twice**: uploading again skips what's already there.

**Media lists** narrow it down further, by Trapper media id: upload only some images, or never
some — loaded from a file (a list, a CSV, or a validation report's missing images).

Optionally, the images **already in the subject set** — uploaded by wildintel-tools or another
session — are skipped too: slow, since the subject set's subjects are listed from Zooniverse first,
100 per request.

Progress is shown per deployment, with the files being downloaded (↓) and uploaded (↑) at each
moment, and a total.

### Subject metadata

Each subject gets wildintel-tools' own metadata: `external_id`, `preview`, `link`, `thumbnail`,
`origin`, `license`, `image_name` and `Filename` — the last two named
`{media id}_x_{file}`, so a subject can be traced back to its Trapper image.
(wildintel-tools' upload used the original file name there, which its `update-metadata`
command then had to fix.)

### Sessions

Every upload is kept in a **session** — its selection, criteria, destination, and what was
uploaded — under `Documents/wildintel-zooniverse/sessions/`. Unfinished sessions are offered back
when the app starts, to resume or discard. Sessions never store passwords.

## Retrieving classifications

A workflow's Zooniverse classifications become a CSV Trapper's classification import reads:

1. the workflow's **classifications export** is downloaded — the latest one, or a new one made
   first;
2. the chosen Trapper collection's **observations** are fetched;
3. each subject's classifications go through the workflow's **extractor and voter** — the
   volunteers' answers turned into observations: species, and the median of their counts;
4. each voted observation is written once per Trapper observation of its image, with that
   observation's `_id` — the one the import updates.

Big exports are split into several CSVs (1.5 MB each by default — Trapper's import has a size
limit), and the volunteers' raw answers can be saved alongside.

Workflows 17553, 29186 and 29187 can be exported. Compared with wildintel-tools, three voting
errors are fixed: workflow 17553's voter works (wildintel-tools' couldn't be loaded), and humans
are voted as *Homo sapiens* in every workflow; workflows 29186/17553 keep the *k* most voted
species (wildintel-tools kept *k+1*); and "no animal" votes are ignored when volunteers saw
several species, as intended.

The CSVs are then imported into Trapper through its API — as expert classifications, approved
only if asked — right away if asked, or from the result, file by file. (wildintel-tools filled in
Trapper's web form with a browser instead.)

## Utilities

### Download subject sets

Downloads the images of one or more subject sets to a folder, one folder per subject set, each
image named `{subject id}_{original name}`. Images already there are skipped, so running it again
only downloads what's missing; a stopped download never leaves a truncated file.

### Validation & audit

Checks a subject set — its subjects read straight from Zooniverse, no export needed:

- **duplicated media** — a Trapper image in more than one subject;
- **unmatched subjects** — no Trapper media id in their metadata;
- **metadata issues** — required fields missing and, compared with Trapper, fields that differ
  from what an upload would set;

and, compared with a Trapper collection and criteria, **missing** and **extra** images, with
per-deployment counts. The full report can be downloaded as JSON.

### Subjects

Zooniverse subjects looked up by id, or a subject set's browsed a page at a time — each with its
image, the Trapper image it is, its subject sets and its metadata.

### Update metadata

Rewrites a subject set's metadata from the Trapper collection it was uploaded from — what an
upload would set today, only the fields that differ, the rest kept. A **dry run** shows every
change (old → new) without making it.

## Settings

Trapper and Zooniverse accounts, how many images are transferred at once and how they retry,
the classifications export's defaults, and the sequence criteria new uploads start from — all in
the app's own `settings.toml`, editable from the ⚙️ page.

## Command line

Everything above is also a command of `wildintel-zooniverse` — wildintel-tools' `zooniverse`
commands and options, on the same core as the web app: the same selection and sampling, the
same pipeline, the same settings, and the same sessions, so an upload started in one can be
resumed in the other. Progress is shown as rich progress bars (a total, one per deployment, and
the files in flight); Ctrl+C stops cleanly. Id options take files and the checks' reports
(`@FILE`), and the checks write JSON reports. See the [command-line manual](user-manual-cli.md).
