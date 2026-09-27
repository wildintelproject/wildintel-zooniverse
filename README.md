# <img src="docs/img/wildIntel_logo.webp" alt="WildINTEL Logo" height="60"> wildintel-zooniverse

![License](https://img.shields.io/badge/license-GPLv3-blue.svg)
[![WildINTEL](https://img.shields.io/badge/WildINTEL-v1.0-blue)](https://wildintel.eu/)
[![Trapper](https://img.shields.io/badge/Trapper-Server-green)](https://gitlab.com/trapper-project/trapper)
[![Zooniverse](https://img.shields.io/badge/Zooniverse-Panoptes-orange)](https://www.zooniverse.org/)

<hr>

## Brings WildINTEL camera-trap images to Zooniverse, and its volunteers' classifications back

**wildintel-zooniverse** takes camera-trap images of the [WildINTEL](https://wildintel.eu/)
project from a [Trapper](https://gitlab.com/trapper-project/trapper) collection to a
[Zooniverse](https://www.zooniverse.org/) project — choosing which images go (sequences,
sampling, humans and vehicles), with a dry run first, live progress per deployment and resumable
uploads — and brings the classifications its volunteers make back to Trapper as observations,
voted per image. It also downloads, validates and audits Zooniverse subject sets, and rewrites
their metadata. It brings the Zooniverse features of
[wildintel-tools](https://github.com/ijfvianauhu/wildintel-tools) to a guided desktop web app,
and to a command line with wildintel-tools' own commands (`wildintel-zooniverse --help`), on the
same core, settings and sessions.

## 🚀 Setup

```bash
./setup.sh
source .venv/bin/activate
```

## 📚 Documentation

**https://wildintelproject.github.io/wildintel-zooniverse/**

## 🏛️ Funding

This work is part of the [WildINTEL project](https://wildintel.eu/), funded by the
[Biodiversa+](https://www.biodiversa.eu/) Joint Research Call 2022–2023
*"Improved transnational monitoring of biodiversity and ecosystem change for science and society (BiodivMon)"*.

## 📝 License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)
