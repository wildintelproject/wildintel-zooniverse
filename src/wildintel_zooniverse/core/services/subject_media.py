"""Which Trapper media a Zooniverse subject is, from its metadata — every
way the app and wildintel-tools have recorded it: the Filename/image_name
prefix ("<media id>_x_…", as update-metadata reads it) or the external_id /
origin (…:media:<id>, as validation reads it)."""
from __future__ import annotations

from wildintel_zooniverse.core.services import metadata_service, validation_service


def media_id_of(metadata: dict) -> int | None:
    return metadata_service.media_id_of(metadata) or validation_service.media_id_of(metadata)
