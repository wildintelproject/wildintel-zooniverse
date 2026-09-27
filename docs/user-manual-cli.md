# WildINTEL Zooniverse — User Manual (command line)

The `wildintel-zooniverse` command does everything the [web app](user-manual-web.md) does, from a
terminal: upload Trapper images to Zooniverse, export the volunteers' classifications back to
Trapper, and the utilities. Its commands and options are those of
[wildintel-tools](https://github.com/ijfvianauhu/wildintel-tools)' `zooniverse` app, so
existing scripts carry over with few changes. It also has the web app's improvements: resumable
sessions, media and subject lists, progress per deployment, and more.

The command line and the web app are two faces of one application. They share **the same
settings, sessions and log**. An upload started in one can be resumed in the other, and neither
ever uploads an image twice.

---

## Table of Contents

1. [Installation](#1-installation)
2. [Getting started](#2-getting-started)
3. [Settings](#3-settings)
4. [Finding the ids](#4-finding-the-ids)
5. [Uploading images to Zooniverse](#5-uploading-images-to-zooniverse)
6. [Exporting classifications](#6-exporting-classifications)
7. [Utilities](#7-utilities)
8. [Id lists](#8-id-lists)
9. [Coming from wildintel-tools](#9-coming-from-wildintel-tools)
10. [Where the app keeps its files](#10-where-the-app-keeps-its-files)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Installation

The command line is in the same package as the web app — see the
[web manual's installation](user-manual-web.md#1-installation). Run with no arguments, the
package opens the web app; run with any, it's the command line:

<div class="termy">

```console
// Linux
$ ./wildintel-zooniverse-X.Y.Z-linux-x86_64.AppImage --help
// Windows
$ wildintel-zooniverse-X.Y.Z-windows-x64.exe --help
// macOS
$ ./wildintel-zooniverse --help
```

</div>

Rename it, or link it into your `PATH` as `wildintel-zooniverse`, to type less. This manual
writes it as `wildintel-zooniverse`.

From the source code (see the developer manual), `uv run wildintel-zooniverse …` runs it too.

Every command has its `--help`: `wildintel-zooniverse import --help`.

## 2. Getting started

<div class="termy">

```console
$ wildintel-zooniverse config set TRAPPER.base_url https://trapper.example.org
✔ TRAPPER.base_url saved.
$ wildintel-zooniverse config set TRAPPER.user_name field.team
✔ TRAPPER.user_name saved.
// The password is asked for, and not shown
$ wildintel-zooniverse config set TRAPPER.user_password
TRAPPER.user_password:
✔ TRAPPER.user_password saved.
$ wildintel-zooniverse config set ZOONIVERSE.user_name field.team
✔ ZOONIVERSE.user_name saved.
$ wildintel-zooniverse config set ZOONIVERSE.user_password
ZOONIVERSE.user_password:
✔ ZOONIVERSE.user_password saved.
$ wildintel-zooniverse test-connection
✔ Trapper https://trapper.example.org as field.team — 3 research project(s)
✔ Zooniverse as field.team
```

</div>

`test-connection` (or `tc`) checks both accounts. The accounts saved from the web app's
⚙️ page already work here — and the other way round.

Options every command has:

| Option | What it does |
|---|---|
| `--verbose`, `-v` (before the command) | Shows the log's messages in the terminal as it works — otherwise only warnings and errors. The log file gets them all anyway, at the settings' log level. |
| `--version` | The app's version. |
| `--help` | The command's options. |

Commands that change something in Zooniverse ask for confirmation first; `--yes` (`-y`) skips it,
for scripts. **Ctrl+C** stops a running command cleanly: what's done stays done.

## 3. Settings

<div class="termy">

```console
// Every setting (passwords are never shown)
$ wildintel-zooniverse config show
// Where the settings, the log and the documents are
$ wildintel-zooniverse config path
Settings:  /home/me/.config/wildintel-zooniverse/settings.toml
Log:
/home/me/.config/wildintel-zooniverse/logs/wildintel-zooniverse.log
Sessions:  /home/me/Documents/wildintel-zooniverse/sessions
Documents: /home/me/Documents/wildintel-zooniverse
// A value is checked before it is saved
$ wildintel-zooniverse config set SEQUENCES.max_interval zero
✘  Invalid SEQUENCES.max_interval: Input should be a valid integer, unable to
parse string as an integer.
```

</div>

The settings are those of the web app's ⚙️ page — see its
[Settings section](user-manual-web.md#3-settings) for what each one is. Their names here:

| Section | Fields |
|---|---|
| `GENERAL` | `log_level` (`ERROR`, `WARNING`, `INFO`, `DEBUG`) |
| `TRAPPER` | `base_url`, `user_name`, `user_password`, `download_workers`, `download_attempts`, `download_retry_delay` |
| `ZOONIVERSE` | `user_name`, `user_password`, `upload_workers`, `upload_attempts`, `upload_retry_delay`, `export_classified_by`, `export_max_file_size_mb` |
| `SEQUENCES` | `max_interval`, `images_per_sequence`, `only_classified`, `remove_middle_humans`, `remove_middle_vehicles` — the upload criteria's defaults |

A value is checked before it's saved: `config set SEQUENCES.max_interval zero` is refused.
Leaving the value out asks for it (hidden for passwords). An empty value (`""`) unsets it.

Any setting can also be given for a single run as an environment variable:
`WILDINTEL_ZOONIVERSE_TRAPPER__DOWNLOAD_WORKERS=8 wildintel-zooniverse import …`.

## 4. Finding the ids

The commands take Trapper and Zooniverse objects by id. These list them:

<div class="termy">

```console
$ wildintel-zooniverse trapper research-projects
Research projects
┏━━━━┳━━━━━━━━━━━━━━━━━┳━━━━━━━━━┓
┃ pk ┃ Name            ┃ Acronym ┃
┡━━━━╇━━━━━━━━━━━━━━━━━╇━━━━━━━━━┩
│ 2  │ Doñana          │ DONA    │
│ 5  │ Sierra Morena   │ SMOR    │
│ 7  │ Bavarian Forest │ BFNP    │
└────┴─────────────────┴─────────┘
$ wildintel-zooniverse trapper classification-projects --rp 2
Classification projects
┏━━━━┳━━━━━━━━━━━━━┳━━━━━━━━┓
┃ pk ┃ Name        ┃ Active ┃
┡━━━━╇━━━━━━━━━━━━━╇━━━━━━━━┩
│ 10 │ Doñana 2024 │ True   │
│ 11 │ Doñana 2023 │ False  │
└────┴─────────────┴────────┘
$ wildintel-zooniverse trapper collections --cp 10
Collections
┏━━━━┳━━━━━━━┳━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━┓
┃ pk ┃ Name  ┃ Status ┃ Images ┃ Classified ┃ Approved ┃
┡━━━━╇━━━━━━━╇━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━┩
│ 33 │ R0033 │ Public │ 23,921 │ 21,870     │ 20,114   │
│ 31 │ R0031 │ Public │ 18,040 │ 18,040     │ 18,040   │
└────┴───────┴────────┴────────┴────────────┴──────────┘
$ wildintel-zooniverse trapper deployments --rp 2 --collection 33
Deployments
┏━━━━┳━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━━━┓
┃ pk ┃ Deployment        ┃ Location    ┃ Images ┃ Start      ┃ End        ┃
┡━━━━╇━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━━━┩
│ 40 │ R0033-DONA_0001_A │ DONA_0001_A │ 4,812  │ 2024-09-02 │ 2024-11-10 │
│ 41 │ R0033-DONA_0003_A │ DONA_0003_A │ 3,120  │ 2024-09-03 │ 2024-11-11 │
│ 42 │ R0033-DONA_0007_B │ DONA_0007_B │ 6,254  │ 2024-09-04 │ 2024-11-12 │
│ 43 │ R0033-DONA_0012_A │ DONA_0012_A │ 1,893  │ 2024-09-05 │ 2024-11-13 │
│ 44 │ R0033-DONA_0015_B │ DONA_0015_B │ 2,740  │ 2024-09-06 │ 2024-11-14 │
│ 45 │ R0033-DONA_0021_A │ DONA_0021_A │ 5,102  │ 2024-09-07 │ 2024-11-15 │
└────┴───────────────────┴─────────────┴────────┴────────────┴────────────┘
```

</div>

<div class="termy">

```console
// Your Zooniverse projects
$ wildintel-zooniverse subjectsets
Projects (owned or collaborated on)
┏━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ id    ┃ Name                         ┃ Slug                                  ┃
┡━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ 30567 │ European Camera Trap Project │ wildintel/european-camera-trap-projec │
│       │                              │ t                                     │
│ 12188 │ Iberian Camera Trap Project  │ wildintel/iberian-camera-trap-project │
└───────┴──────────────────────────────┴───────────────────────────────────────┘
$ wildintel-zooniverse subjectsets --project 30567
Subject sets
┏━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┓
┃ id     ┃ Name                      ┃ Subjects ┃
┡━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━┩
│ 134791 │ Doñana_2_R0033_33_2026-03 │ 86,878   │
│ 131022 │ Doñana_2_R0031_31_2025-12 │ 40,211   │
│ 128950 │ Pilot — autumn 2025       │ 1,250    │
└────────┴───────────────────────────┴──────────┘
$ wildintel-zooniverse workflows --project 30567
Workflows
┏━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━┓
┃ id    ┃ Name                   ┃ Active ┃ Exportable ┃
┡━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━┩
│ 29186 │ Species identification │ True   │ True       │
│ 29187 │ Species (experts)      │ True   │ True       │
│ 25001 │ Tutorial               │ False  │ False      │
└───────┴────────────────────────┴────────┴────────────┘
```

</div>

`subjectsets` is also `ss`, and `workflows` is also `wf`.

Deployments can be given by pk or by deployment id (`R0033-DONA_0001_A`), whichever is handier.

## 5. Uploading images to Zooniverse

The upload chooses a Trapper collection's images the way the web wizard does: by sequences,
sampling and humans and vehicles. See [the web manual's Filters](user-manual-web.md#step-4-filters)
for how it chooses.

**The selection** — every upload command takes:

| Option | What it is |
|---|---|
| `COLLECTION` (argument) | The collection's pk. |
| `--rp` | Its research project's pk. |
| `--cp` | The classification project the collection is in. |
| `--deployments`, `--d` | Only these deployments — pk or deployment id, comma- or space-separated. By default, every deployment with images in the collection. |
| `--exclude-deployments`, `--ed` | Leave these out. |

**The criteria** — the settings' `SEQUENCES` values, unless given:

| Option | What it is |
|---|---|
| `--max-interval` | Max. seconds between two images of the same sequence. |
| `--n-images-seq` | Images kept from each sequence. |
| `--only-classified` / `--all-images` | Only images with an observation other than *unclassified*. |
| `--remove-middle-humans` / `--keep-middle-humans` | Humans in middle sequences. |
| `--remove-middle-vehicles` / `--keep-middle-vehicles` | Vehicles in middle sequences. |

### estimate-upload

<div class="termy">

```console
$ wildintel-zooniverse estimate-upload 33 --rp 2 --cp 10
---> 100%
  Counting deployments (one at a time) ━━━━━━━━━━━━━━━━━━━ 6/6           0:00:00
Collection R0033
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━┓
┃ Deployment        ┃ Images ┃ Candidates ┃ Sequences ┃ Removed ┃ Upload ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━┩
│ R0033-DONA_0001_A │ 4,812  │ 2,983      │ 398       │ 16      │ 1,942  │
│ R0033-DONA_0003_A │ 3,120  │ 1,934      │ 258       │ 10      │ 1,260  │
│ R0033-DONA_0007_B │ 6,254  │ 3,877      │ 517       │ 21      │ 2,522  │
│ R0033-DONA_0012_A │ 1,893  │ 1,174      │ 157       │ 6       │ 767    │
│ R0033-DONA_0015_B │ 2,740  │ 1,699      │ 227       │ 9       │ 1,108  │
│ R0033-DONA_0021_A │ 5,102  │ 3,163      │ 422       │ 17      │ 2,059  │
├───────────────────┼────────┼────────────┼───────────┼─────────┼────────┤
│ Total             │ 23,921 │ 14,830     │ 1,979     │ 79      │ 9,658  │
└───────────────────┴────────┴────────────┴───────────┴─────────┴────────┘
```

</div>

How many images of each deployment an upload would send, with its counts — the web wizard's
preview. Trapper is asked one deployment at a time; a large one takes a while.

### analyze-sequences

<div class="termy">

```console
$ wildintel-zooniverse analyze-sequences 33 --rp 2 --cp 10 --d R0033-DONA_0001_A -o sequences.csv
---> 100%
  Counting deployments (one at a time) ━━━━━━━━━━━━━━━━━━━ 1/1           0:00:00
R0033-DONA_0001_A — sequences
┏━━━┳━━━━━━━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━┳━━━━━━━━┓
┃ # ┃ Start            ┃ Seconds ┃ Images ┃ Removed ┃ Upload ┃
┡━━━╇━━━━━━━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━╇━━━━━━━━┩
│ 1 │ 2024-09-04 07:12 │ 88      │ 8      │ 0       │ 5      │
│ 2 │ 2024-09-04 08:12 │ 55      │ 5      │ 0       │ 5      │
│ 3 │ 2024-09-04 09:12 │ 132     │ 12     │ 12      │ 0      │
│ 4 │ 2024-09-04 10:12 │ 22      │ 2      │ 0       │ 2      │
│ 5 │ 2024-09-04 11:12 │ 66      │ 6      │ 0       │ 5      │
└───┴──────────────────┴─────────┴────────┴─────────┴────────┘
Totals
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━┓
┃ Deployment        ┃ Images ┃ Candidates ┃ Sequences ┃ Removed ┃ Upload ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━┩
│ R0033-DONA_0001_A │ 4,812  │ 2,983      │ 398       │ 16      │ 1,942  │
├───────────────────┼────────┼────────────┼───────────┼─────────┼────────┤
│ Total             │ 4,812  │ 2,983      │ 398       │ 16      │ 1,942  │
└───────────────────┴────────┴────────────┴───────────┴─────────┴────────┘
✔ 5 sequences written to sequences.csv
```

</div>

Every sequence of every deployment, and what becomes of each image of it. The CSV has
wildintel-tools' columns (`media_ids`: the ones uploaded) plus the images left out and why:
`not_sampled_media_ids`, `removed_human_media_ids` and `removed_vehicle_media_ids`. Without `-o`
it's written to the documents' `exports/` folder.

### import

<div class="termy">

```console
// First, a dry run: everything but the upload
$ wildintel-zooniverse import 33 --rp 2 --cp 10 --project 30567 --dry-run
---> 100%
Dry run of the upload of collection R0033 (6 deployments) → Zooniverse project
European Camera Trap Project, subject set Doñana_2_R0033_33_2026-09 — session
5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90
  Total (deployments) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6/6           0:00:00
  ✓ R0033-DONA_0001_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,942/1,942   0:00:00
  ✓ R0033-DONA_0003_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,260/1,260   0:00:00
  ✓ R0033-DONA_0007_B ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2,522/2,522   0:00:00
  ✓ R0033-DONA_0012_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 767/767       0:00:00
  ✓ R0033-DONA_0015_B ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,108/1,108   0:00:00
  ✓ R0033-DONA_0021_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2,059/2,059   0:00:00
Subject set Doñana_2_R0033_33_2026-09: would be created (new)
✔ 9,658 images would be uploaded, 0 skipped (already uploaded), 0 failed, 0 left
out by the media lists.
```

</div>

<div class="termy">

```console
$ wildintel-zooniverse import 33 --rp 2 --cp 10 --project 30567
---> 100%
Upload of collection R0033 (6 deployments) → Zooniverse project European Camera
Trap Project, subject set Doñana_2_R0033_33_2026-09 — session
5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90
This creates the subjects in Zooniverse. Go on? [y/N]: y
  Total (deployments) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6/6           0:00:00
  ✓ R0033-DONA_0001_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,942/1,942   0:00:00
  ✓ R0033-DONA_0003_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,260/1,260   0:00:00
  ✓ R0033-DONA_0007_B ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2,522/2,522   0:00:00
  ✓ R0033-DONA_0012_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 767/767       0:00:00
  ✓ R0033-DONA_0015_B ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,108/1,108   0:00:00
  ✓ R0033-DONA_0021_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2,059/2,059   0:00:00
Subject set Doñana_2_R0033_33_2026-09: #135002 (new)
Failed
┏━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Media   ┃ Deployment        ┃ Step     ┃ Error                               ┃
┡━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ 4100005 │ R0033-DONA_0003_A │ download │ Trapper answered 404: the file is   │
│         │                   │          │ missing                             │
│ 4100705 │ R0033-DONA_0003_A │ download │ Trapper answered 404: the file is   │
│         │                   │          │ missing                             │
└─────────┴───────────────────┴──────────┴─────────────────────────────────────┘
✔ 9,656 images uploaded, 0 skipped (already uploaded), 2 failed, 0 left out by
the media lists.
Resume — the images already uploaded are skipped: wildintel-zooniverse import
--resume 5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90
```

</div>

Uploads the images to a subject set of the Zooniverse project. The selection and the criteria
options apply, and also:

| Option | What it is |
|---|---|
| `--project`, `-p` | The Zooniverse project's id — one you own or collaborate on. |
| `--subject-set`, `--ss` | The subject set's name. If it exists, the images are added to it; otherwise it's created. The default is wildintel-tools' `{research project}_{pk}_{collection}_{pk}_{YYYY-MM}`. |
| `--media`, `--m` | Upload only these Trapper media ids — see [Id lists](#8-id-lists). |
| `--exclude-media`, `--em` | Never these; this wins over `--media`. |
| `--skip-in-subject-set` | Also skip the images already in the subject set, whoever uploaded them. **Slow**: every subject of the subject set is listed first, 100 per request. |
| `--dry-run` | Everything but the upload. The images are fetched and chosen exactly as they will be, and the subject set is looked up, but downloads and uploads are only simulated. |
| `--resume ID` | Resume a session — see below. |
| `--yes`, `-y` | Don't ask for confirmation. |
| `--verbose` | Print every image as it's done. |

While it runs, it shows a bar for the total (by deployments) and one per deployment. Beside each
deployment it shows the files being **↓ downloaded** from Trapper and **↑ uploaded** to
Zooniverse. At the end it prints the failures (the step and why) and the totals.

#### Sessions

Every import is a **session**, like the web wizard's. It records the selection, the criteria, the
destination, the media lists and every image uploaded, the moment it is. If an import stops
(Ctrl+C, a closed terminal, a network outage) or some images fail, it prints how to carry on:

<div class="termy">

```console
$ wildintel-zooniverse import --resume 5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90 --yes
---> 100%
Upload of collection R0033 (6 deployments) → Zooniverse project European Camera
Trap Project, subject set Doñana_2_R0033_33_2026-09 — session
5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90
  Total (deployments) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6/6           0:00:00
  ✓ R0033-DONA_0001_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,942/1,942   0:00:00
  ✓ R0033-DONA_0003_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,260/1,260   0:00:00
  ✓ R0033-DONA_0007_B ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2,522/2,522   0:00:00
  ✓ R0033-DONA_0012_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 767/767       0:00:00
  ✓ R0033-DONA_0015_B ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,108/1,108   0:00:00
  ✓ R0033-DONA_0021_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2,059/2,059   0:00:00
Subject set Doñana_2_R0033_33_2026-09: #135002
✔ 3 images uploaded, 9,655 skipped (already uploaded), 0 failed, 0 left out by
the media lists.
```

</div>

Resuming uploads only what's missing, including the images that failed. It uses the session's
own selection, criteria and destination. `--media` and `--exclude-media` replace its lists.

<div class="termy">

```console
// Unfinished uploads, the web app's too
$ wildintel-zooniverse sessions list
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Session                              ┃ Run                                   ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ 5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90 │ Ready to upload — collection R0033,   │
│                                      │ all 6 deployments →                   │
│                                      │ Doñana_2_R0033_33_2026-09 ·           │
│                                      │ 2026-09-27 10:09                      │
└──────────────────────────────────────┴───────────────────────────────────────┘
// Forget one (what it uploaded stays in Zooniverse)
$ wildintel-zooniverse sessions discard 5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90
✔ Session 5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90 discarded.
```

</div>

The web app offers the same sessions when it starts. An upload begun here can be finished there,
and the other way round.

Each subject gets the same metadata as from the web app — see
[What each subject gets](user-manual-web.md#what-each-subject-gets).

## 6. Exporting classifications

<div class="termy">

```console
$ wildintel-zooniverse export --wf 29186 --rp 2 --cp 10 --collection 33 --upload
---> 100%
  ✓ Classifications export of 2026-09-20 08:14 ━━━━━━━━━━━               0:00:00
  ✓ 412,377 classifications of 26,114 subjects ━━━━━━━━━━━ 180/180 MB    0:00:00
  Trapper's observations (deployments)         ━━━━━━━━━━━ 6/6           0:00:00
  Voting subjects                              ━━━━━━━━━━━ 26,114/26,114 0:00:00
  Workflow                             Species identification (29186)
  Subjects                             26,114
  Exported                             24,987 subjects, 26,402 observations,
                                       27,711 CSV rows
  Skipped: not in trapper              12
  Skipped: no media id                 1
  Skipped: no valid classifications    311
  Skipped: no decision                 803
✔
~/Documents/wildintel-zooniverse/exports/observations_wf29186_cp10_col33_2026092
7-101500_part001.csv (14,012 rows)
✔
~/Documents/wildintel-zooniverse/exports/observations_wf29186_cp10_col33_2026092
7-101500_part002.csv (13,699 rows)
✔
~/Documents/wildintel-zooniverse/exports/zoo_annotations_observations_wf29186_cp
10_col33_20260927-101500.csv (volunteers' annotations)
Importing observations_wf29186_cp10_col33_20260927-101500_part001.csv (1/2)…
  ✔ Classifications import started — Trapper task c1a2-0
Importing observations_wf29186_cp10_col33_20260927-101500_part002.csv (2/2)…
  ✔ Classifications import started — Trapper task c1a2-1
```

</div>

Turns a workflow's classifications into a CSV of Trapper observations. It votes each subject's
volunteers' answers into a consensus, then matches it to the Trapper collection's images and
their observations. See [How classifications are voted](user-manual-web.md#how-classifications-are-voted).

| Option | What it is |
|---|---|
| `--wf` | The workflow's id — one the app knows how to vote (`workflows --project` says which). |
| `--rp`, `--cp`, `--collection`, `--deployments` | The Trapper images the subjects were uploaded from. |
| `--output`, `-o` | The folder to write to (default: the documents' `exports/`). |
| `--regenerate` | Ask Zooniverse for a new classifications export first. The latest one doesn't have the classifications made since it was made. A new one can take several minutes. |
| `--classified-by` | The CSV's `classifiedBy` (default: the settings'). |
| `--max-file-size` | Split the CSV into files of at most this many MB, Trapper's import limit (default: the settings'). |
| `--save-zoo-annotations` / `--no-save-zoo-annotations` | Also write the volunteers' raw annotations, one row per annotation (on by default). |
| `--upload` | Then import the CSV files into the Trapper classification project (`--cp`), through its API. |
| `--approve` | With `--upload`: approve the imported classifications. |

It prints how many subjects were exported and how many were skipped, and why: not in Trapper, no
media id, no valid classifications, or no consensus. Then it lists the files it wrote. Without
`--upload`, it gives the Trapper page to import them by hand.

## 7. Utilities

### download_ss

<div class="termy">

```console
$ wildintel-zooniverse download_ss 128950 -o ~/subject-sets
---> 100%
  Pilot — autumn 2025 (128950) ━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,250/1,250   0:00:00
✔ 1,210 downloaded, 40 already there, 0 left out by the subject lists, 0 failed
— /home/me/subject-sets
```

</div>

Downloads subject sets' images into a folder per subject set; `dl_ss` is the same.
Images already there are skipped unless `--overwrite`. `--white-list` and `--black-list`
(`--exclude-subjects`) keep or leave out subjects by id — see [Id lists](#8-id-lists). Without
`-o`, it's written to the documents' `downloads/` folder.

### update-metadata

<div class="termy">

```console
$ wildintel-zooniverse update-metadata 128950 --rp 2 --cp 10 -c 33 --dry-run
---> 100%
  Trapper's media (deployments) ━━━━━━━━━━━━━━━━━━━━━━━━━━ 6/6           0:00:00
  Pilot — autumn 2025 (128950)  ━━━━━━━━━━━━━━━━━━━━━━━━━━ 1,250/1,250   0:00:00
Changes (first 50)
┏━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Subject  ┃ Field    ┃ Now          ┃ New                                     ┃
┡━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ 98000000 │ Filename │ IMG_1000.JPG │ 4000000_x_R0033-DONA_0001_A_x_IMG_1000. │
│          │          │              │ JPG                                     │
│ 98000009 │ Filename │ IMG_1009.JPG │ 4000009_x_R0033-DONA_0001_A_x_IMG_1009. │
│ …                                                                            │
└──────────┴──────────┴──────────────┴─────────────────────────────────────────┘
✔ 139 would update, 1,110 unchanged, 1 unmatched
```

</div>

Rewrites the subjects' metadata from the Trapper collection they came from, so they're as a new
upload would make them (`um` is the same). `--dry-run` only shows the changes. Without it, the
command asks for confirmation (`--yes` skips it). `--white-list` and `--black-list` limit it to
some subjects; `--deployments` limits it to some deployments' media.

### Checks

Each check goes through every subject of a subject set, prints what it found, and writes it as a
JSON report (`-o FILE`, or in the documents' `reports/` folder):

<div class="termy">

```console
$ wildintel-zooniverse check-subject-set 134791 --rp 2 --cp 10 --collection 33
---> 100%
  Listing Doñana_2_R0033_33_2026-03 (134791) ━━━━━━━━━━━━━ 9,624/9,624   0:00:00
  Trapper's selection (deployments)          ━━━━━━━━━━━━━ 6/6           0:00:00
Doñana_2_R0033_33_2026-03 (134791)
  Subjects                         9,624
  Trapper images                   9,621
  Duplicated images                3
  Subjects with no media id        1
  Subjects with metadata issues    1
  Expected from Trapper            9,658
  Missing                          37
  Not expected (extra)             1
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━┓
┃ Deployment        ┃ Expected ┃ Uploaded ┃ Missing ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━┩
│ R0033-DONA_0001_A │ 1,942    │ 1,942    │ 0       │
│ R0033-DONA_0003_A │ 1,260    │ 1,260    │ 0       │
│ R0033-DONA_0007_B │ 2,522    │ 2,485    │ 37      │
│ R0033-DONA_0012_A │ 767      │ 767      │ 0       │
│ R0033-DONA_0015_B │ 1,108    │ 1,108    │ 0       │
│ R0033-DONA_0021_A │ 2,059    │ 2,059    │ 0       │
└───────────────────┴──────────┴──────────┴─────────┘
Written to
/home/me/Documents/wildintel-zooniverse/reports/check_ss134791_20260927-
120947.json
```

</div>

| Command | What it finds |
|---|---|
| `check-subject-set SS` | Everything below at once. With `--rp`, `--cp` and `--collection` (and the criteria options) it also compares with Trapper: missing and extra images, per deployment. |
| `check-missing-media SS --rp --cp --collection` | The images an upload with these criteria would send that aren't in the subject set, and those in it that it wouldn't. |
| `check-duplicated-media SS` | Trapper images uploaded more than once. |
| `check-unmatched-subjects SS` | Subjects with no Trapper media id in their metadata. |
| `check_metadata SS` | Subjects whose metadata is incomplete or inconsistent. Fix them with `update-metadata`. |
| `uploaded_media SS` | Every Trapper image in the subject set, with its subject(s). |

A missing-media report is a media list. To upload just the missing images:

<div class="termy">

```console
$ wildintel-zooniverse check-missing-media 134791 --rp 2 --cp 10 --collection 33 -o missing.json
---> 100%
  Listing Doñana_2_R0033_33_2026-03 (134791) ━━━━━━━━━━━━━ 9,624/9,624   0:00:00
  Trapper's selection (deployments)          ━━━━━━━━━━━━━ 6/6           0:00:00
Missing: 37 of 9,658
┏━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┓
┃ Media   ┃ Deployment        ┃ File         ┃
┡━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━┩
│ 4300000 │ R0033-DONA_0007_B │ IMG_2200.JPG │
│ 4300017 │ R0033-DONA_0007_B │ IMG_2201.JPG │
│ 4300034 │ R0033-DONA_0007_B │ IMG_2202.JPG │
│ 4300051 │ R0033-DONA_0007_B │ IMG_2203.JPG │
│ …                                          │
└─────────┴───────────────────┴──────────────┘
1 image(s) in the subject set the criteria wouldn't upload.
Written to missing.json
Upload just the missing ones: import … --media @THAT_FILE
// Upload just those
$ wildintel-zooniverse import 33 --rp 2 --cp 10 --project 30567 --subject-set "Doñana_2_R0033_33_2026-03" --media @missing.json --yes
---> 100%
Upload of collection R0033 (6 deployments) → Zooniverse project European Camera
Trap Project, subject set Doñana_2_R0033_33_2026-03 — session
5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90
  Total (deployments) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6/6           0:00:00
  ✓ R0033-DONA_0001_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 0/0           0:00:00
  ✓ R0033-DONA_0003_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 0/0           0:00:00
  ✓ R0033-DONA_0007_B ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 37/37         0:00:00
  ✓ R0033-DONA_0012_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 0/0           0:00:00
  ✓ R0033-DONA_0015_B ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 0/0           0:00:00
  ✓ R0033-DONA_0021_A ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 0/0           0:00:00
Subject set Doñana_2_R0033_33_2026-03: #134791
✔ 37 images uploaded, 0 skipped (already uploaded), 0 failed, 9,621 left out by
the media lists.
```

</div>

### subjects

<div class="termy">

```console
$ wildintel-zooniverse subjects 98000004,98000005,98999999 --metadata
2 subject(s) found
┏━━━━━━━━━━┳━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Subject  ┃ Trapper media ┃ Subject sets ┃ Image                              ┃
┡━━━━━━━━━━╇━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ 98000004 │ 4000004       │ 134791       │ https://panoptes-uploads.zooniver… │
│ 98000005 │ 4000005       │ 134791       │ https://panoptes-uploads.zooniver… │
└──────────┴───────────────┴──────────────┴────────────────────────────────────┘
#98000004
  Filename: 4000004_x_R0033-DONA_0001_A_x_IMG_1004.JPG
  external_id: https://trapper.example.org/:media:4000004
  license: CC BY-NC 4.0
#98000005
  Filename: 4000005_x_R0033-DONA_0001_A_x_IMG_1005.JPG
  external_id: https://trapper.example.org/:media:4000005
  license: CC BY-NC 4.0
Not found (or not visible to you): 98999999
```

</div>

Looks up Zooniverse subjects by id — or, with `--subject-set 134791 [--page 2]`, browses a
subject set 50 at a time (`sbj` is the same).
For each subject it shows the Trapper image it is, the subject sets it's in and its image URL;
`--metadata` adds all its metadata. Ids that don't exist, or aren't visible to you, are listed
apart.

## 8. Id lists

Options that take ids — `--media`, `--exclude-media`, `--white-list`, `--black-list` and the
`subjects` command — accept them:

- **typed**: `--media 101,102,103` or `--media "101 102 103"`;
- **from a file**: `--media @ids.txt`, which reads the file as the web app's *Load file…* does:
  - a list of ids (one per line, or comma- or space-separated);
  - a CSV with an id column (`mediaID`, `media_id`, `subject_id`…), such as `analyze-sequences`';
  - a JSON report of the checks. For media, its missing images; for subjects, those it lists.

Values that aren't ids are ignored, with a warning saying how many. When both lists are given,
an id in the blacklist is always left out.

## 9. Coming from wildintel-tools

The commands and their main options are wildintel-tools' own:

| wildintel-tools | Here |
|---|---|
| `zooniverse test-connection` / `tc` | `test-connection` / `tc` |
| `zooniverse estimate-upload` | `estimate-upload` |
| `zooniverse analyze-sequences` | `analyze-sequences` |
| `zooniverse import` | `import` |
| `zooniverse export` | `export` |
| `zooniverse download_ss` / `dl_ss` | `download_ss` / `dl_ss` |
| `zooniverse update-metadata` / `um` | `update-metadata` / `um` |
| `zooniverse check-*`, `check_metadata`, `uploaded_media` | the same |
| `zooniverse subjectsets` / `ss`, `workflows` / `wf`, `subjects` / `sbj` | the same |

The differences:

- **The settings** are the app's own `settings.toml`, shared with the web app, and not
  wildintel-tools'. Set them once with `config set`.
- **Imports are sessions**: resumable with `--resume`, and never uploading an image twice.
- **Trapper is asked one deployment at a time.** This avoids the timeouts of large collections.
- **Several images at a time**, downloaded and uploaded in parallel, with retries (see the
  settings).
- **Id lists** accept files and reports (`@FILE`).
- **Deployments** can be given by deployment id as well as by pk.
- **`export --upload`** imports the CSVs into Trapper through its API.
- `trapper …`, `sessions …` and `config …` are new.

## 10. Where the app keeps its files

The same as the web app's — see [its table](user-manual-web.md#7-where-the-app-keeps-its-files),
or run `wildintel-zooniverse config path`. The command line's reports are in the documents'
`reports/` folder.

!!! warning
    `settings.toml` holds your Trapper and Zooniverse passwords, in plain text. Keep it private.

## 11. Troubleshooting

!!! tip "Reporting a problem"
    Run the command again with `--verbose` before it (`wildintel-zooniverse -v import …`), or
    set `GENERAL.log_level` to `DEBUG`. Attach the log (`config path` says where) to the report,
    with the command you ran. Passwords are never written to the log.

**"Missing Trapper URL, username, password"** — set them with `config set`.

**"No collection 33 in classification project 10."** — the ids don't match: list them with
`trapper …` (see [Finding the ids](#4-finding-the-ids)).

**An import stopped, or some images failed.** — Run the `--resume` command it printed. What was
already uploaded is skipped.

**"Workflow … can't be exported."** — The app has no extractor or voter for it yet. Ask a
developer to add one (see the developer manual).
