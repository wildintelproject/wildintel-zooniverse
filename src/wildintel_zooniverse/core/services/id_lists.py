"""A whitelist and a blacklist of ids — Trapper media ids for an upload,
Zooniverse subject ids for the utilities — as wildintel-tools' --media /
--exclude-media and --white-list / --black-list: with a whitelist, only its
ids; never the blacklist's, even when they're in the whitelist."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class IdLists:
    # Only these — None: no whitelist.
    include: frozenset[int] | None = None
    exclude: frozenset[int] = frozenset()

    @classmethod
    def of(cls, include: Iterable[int] | None, exclude: Iterable[int] | None = None) -> IdLists:
        return cls(
            include=frozenset(include) if include is not None else None,
            exclude=frozenset(exclude or ()),
        )

    @classmethod
    def from_manifest(cls, data: dict | None) -> IdLists:
        data = data or {}
        return cls.of(data.get("include"), data.get("exclude"))

    @property
    def active(self) -> bool:
        return self.include is not None or bool(self.exclude)

    def keeps(self, item_id: int) -> bool:
        return (self.include is None or item_id in self.include) and item_id not in self.exclude
