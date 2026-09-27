# Changelog

WildINTEL project provides up-to-date release notes for the WildINTEL Zooniverse application on
all supported platforms. This document contains information about recent changes, including new
features, bug fixes, and improvements. It is intended to help users and developers understand the
evolution of the project over time.

You can download the latest version of WildINTEL Zooniverse from the
[releases page](https://github.com/wildintelproject/wildintel-zooniverse/releases).

To report a bug or request a new feature, please open an
[issue](https://github.com/wildintelproject/wildintel-zooniverse/issues).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Upcoming release

### Added
- **Upload images to Zooniverse** wizard: Trapper research project → classification project →
  collection → deployments; sequence criteria with a per-deployment preview; Zooniverse project and
  subject set (reused if it exists).
- **Dry run** of the upload: every read is real, downloading and uploading are simulated.
- The **upload** itself: download → upload → delete per image, on separate download and upload
  thread pools, with retries (tenacity), live progress per deployment and the files in flight.
- Resumable **sessions**: every uploaded image is recorded as it's uploaded, so stopping or
  closing the app never uploads an image twice.
- **Retrieve classifications**: a workflow's Zooniverse classifications, voted into
  observations, written as a CSV for Trapper's classification import (split by size) — and
  **imported into Trapper** through its API, from the result or right when the export ends.
  Workflows 17553, 29186 and 29187.
- **Utils**: *Download subject sets*, *Validation & audit* (duplicated, unmatched, missing and
  extra images, metadata — and every image uploaded, downloadable as a list of media ids),
  *Update metadata* (with a dry run) and *Subjects* (look subjects up by id, or browse a subject
  set's). *Download subject sets* and *Update metadata* take subject lists: only some subjects,
  or never some.
- **Settings** page (⚙️): Trapper and Zooniverse accounts, parallel transfers and retries, the
  export's defaults, and the sequence criteria new uploads start from.
- Option to also remove **vehicles** from middle sequences.
- **Analyze sequences** on the filters step: each deployment's sequences and what becomes of each
  image (uploaded, not sampled, removed as a human or a vehicle), with a CSV download —
  wildintel-tools' `analyze-sequences`, with the upload's own criteria.
- **Media lists** for the upload: only these images, and never these — typed in or loaded from a
  file (a list of ids, a CSV, or a validation report's missing images), kept in the session.
- Option to **skip the images already in the subject set**, whoever uploaded them — slow: the
  subject set's subjects are listed first.
- **Logging**: a log file next to `settings.toml` (rotated), a log level set from the settings'
  new *General* section — applied without restarting — and a *Download log* button. At *Debug*,
  each step of every operation and full error tracebacks.
- **Command line** (`wildintel-zooniverse`): wildintel-tools' `zooniverse` commands —
  `test-connection`, `estimate-upload`, `analyze-sequences`, `import`, `export`, `download_ss`,
  `update-metadata`, the `check-*` commands, `uploaded_media`, `subjectsets`, `workflows`,
  `subjects` — on the web app's core, with its improvements: resumable sessions shared with the
  web app (`import --resume`), media and subject lists from files (`@FILE`), progress bars per
  deployment, and `export --upload` into Trapper. Also `config`, `sessions` and `trapper`
  lookups. The release packages run it when given arguments.
- User documentation for the web app — with screenshots, regenerated from sample data by
  `wzcli docs screenshots` — and for the command line, with animated terminals of its real
  output (termynal, as in Typer's documentation), developer documentation, CI, and
  release packages: Linux AppImage, Windows portable
  .exe and macOS .dmg.

### Fixed (compared with wildintel-tools)
- Subjects' `Filename`/`image_name` are `{media id}_x_{deployment}_x_{file}` from the upload on —
  no `update-metadata` pass needed to trace them back to Trapper.
- *Update metadata* saves the metadata (panoptes-client only saves assigned attributes), and
  takes each image's deployment from Trapper instead of guessing it from its name.
- Workflow 17553's voter can be loaded, and votes humans as *Homo sapiens*.
- Workflows 29186/17553 keep the *k* most voted species, not *k+1*.
- "No animal" votes are ignored when volunteers saw several species.
- Humans are *Homo sapiens* in every workflow (29187 wrote *Homo Sapiens*).
- A subject whose classifications were all discarded no longer stops the whole export.

## Released

**Note:** The information in past release notes may have been superseded by newer releases.
Please refer to the latest release for the most up-to-date information.

*No release yet.*
