# WildINTEL Zooniverse

![WildINTEL](img/wildIntel_logo.webp){ style="display: block; margin: 0 auto;" }

**WildINTEL Zooniverse** is an open-source desktop web application that takes the WildINTEL
project's camera-trap images from [Trapper](https://gitlab.com/trapper-project/trapper) to
[Zooniverse](https://www.zooniverse.org/), and brings its volunteers' classifications back.

It brings the Zooniverse features of
[wildintel-tools](https://github.com/ijfvianauhu/wildintel-tools) to a guided web interface that
runs on your own computer — and to a command line with wildintel-tools' own commands, for
terminals and scripts:

- **Upload images to Zooniverse** — choose a Trapper collection, decide which images of it go
  (sequences, sampling, humans and vehicles), try it as a dry run, and upload it as a subject
  set, with live progress per deployment and resumable sessions.
- **Retrieve classifications** — turn a workflow's Zooniverse classifications into a CSV of
  observations for Trapper's classification import.
- **Utilities** — download subject sets, validate and audit a subject set against its Trapper
  collection, and rewrite subjects' metadata.

## Documentation Map

### [User Manual — web app](user-manual-web.md)

Installation, settings, and a step-by-step guide to every task in the web interface: uploading
images, retrieving classifications and the utilities.

### [User Manual — command line](user-manual-cli.md)

The `wildintel-zooniverse` command: every task from a terminal or a script, with
wildintel-tools' commands and options.

### [Developer Manual](developer-manual.md)

Architecture, development setup, backend and frontend structure, API reference, how to add a
Zooniverse workflow, testing, building executables, documentation and the release process.

### [Features](features.md)

What the application does, in detail — and how it differs from wildintel-tools.

### [Changelog](changelog.md)

What changed in each release.

### [About](about.md)

The WildINTEL project and its funding.
