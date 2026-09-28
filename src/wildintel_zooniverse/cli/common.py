"""What every command of the command-line app shares: the console, friendly
errors, credentials (settings.toml's — see `config`), id options, and the
Trapper selection resolved from ids — the web wizard's own model, so both
apps run the same core with the same inputs."""
from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import TypeVar

import httpx
import requests
import typer
from panoptes_client.panoptes import PanoptesAPIException
from rich.console import Console
from trapper_client import err

from wildintel_zooniverse.core import config
from wildintel_zooniverse.core.id_parsing import IdKind, parse_ids
from wildintel_zooniverse.core.schemas.requests import DeploymentRef, NamedRef, TrapperSelection, UploadCriteria
from wildintel_zooniverse.core.services import trapper_service, zooniverse_service

console = Console()
err_console = Console(stderr=True)

T = TypeVar("T")


# ── Errors ────────────────────────────────────────────────────────────────────

def describe(exc: BaseException) -> str:
    """What went wrong, for a person — the web routers' own mapping."""
    if isinstance(exc, err.UnauthorizedError):
        return "Incorrect Trapper username or password."
    if isinstance(exc, err.ForbiddenError):
        return "You don't have permission to access this Trapper resource."
    if isinstance(exc, err.NotFoundError):
        return "Trapper resource not found."
    if isinstance(exc, httpx.ConnectError):
        return f"Could not connect to the Trapper server: {exc}"
    if isinstance(exc, httpx.TimeoutException):
        return f"Timed out connecting to the Trapper server: {exc}"
    if isinstance(exc, PanoptesAPIException) and "invalid email or password" in str(exc).lower():
        return "Incorrect Zooniverse username or password."
    if isinstance(exc, requests.ConnectionError):
        return f"Could not connect to Zooniverse: {exc}"
    if isinstance(exc, requests.Timeout):
        return f"Timed out connecting to Zooniverse: {exc}"
    return str(exc) or type(exc).__name__


def fail(message: str, code: int = 1) -> typer.Exit:
    err_console.print(f"[red]✘  {message}[/red]")
    return typer.Exit(code)


def call(fn: Callable[[], T]) -> T:
    """fn(), its errors as a clean message and exit code 1."""
    try:
        return fn()
    except typer.Exit:
        raise
    except Exception as exc:
        raise fail(describe(exc)) from exc


# ── Credentials ───────────────────────────────────────────────────────────────

def trapper_credentials(url: str | None = None) -> tuple[str, str, str]:
    try:
        return trapper_service.resolve_credentials(url, None, None)
    except ValueError as exc:
        raise fail(f"{exc} Set it with: wildintel-zooniverse config set TRAPPER.<field> …") from exc


def zooniverse_credentials() -> tuple[str, str]:
    try:
        return zooniverse_service.resolve_credentials(None, None)
    except ValueError as exc:
        raise fail(f"{exc} Set it with: wildintel-zooniverse config set ZOONIVERSE.<field> …") from exc


# ── Id options ────────────────────────────────────────────────────────────────

def id_list(value: str | None, kind: IdKind, option: str) -> list[int] | None:
    """An id list option: ids separated by commas or spaces — or @FILE, read
    as the web app reads a loaded file (a list, a CSV id column, a report).
    None when the option wasn't given."""
    if value is None:
        return None
    text = value
    if value.startswith("@"):
        path = Path(value[1:]).expanduser()
        if not path.is_file():
            raise fail(f"{option}: no such file: {path}")
        text = path.read_text(encoding="utf-8")
    ids, ignored = parse_ids(text, kind)
    if ignored:
        err_console.print(f"[yellow]⚠  {option}: {ignored} value(s) that aren't ids were ignored.[/yellow]")
    return ids


def pk_list(value: str | None) -> list[str] | None:
    """Deployments, by pk or deployment id, separated by commas or spaces."""
    if value is None:
        return None
    return [token for token in value.replace(",", " ").split() if token]


# ── The Trapper selection ─────────────────────────────────────────────────────

def _pick(items: list[dict], pk: int, what: str, where: str) -> dict:
    found = next((i for i in items if i["pk"] == pk), None)
    if found is None:
        raise fail(f"No {what} {pk}{where}.")
    return found


def resolve_selection(
    trapper: tuple[str, str, str], research_project: int, classification_project: int, collection: int,
    deployments: list[str] | None = None, exclude_deployments: list[str] | None = None,
) -> TrapperSelection:
    """The wizard's own selection, from ids: the research project,
    classification project and collection by pk, and their deployments — all
    of the collection's (those with images in it), or those given by pk or
    deployment id, minus the excluded ones."""
    rp = _pick(call(lambda: trapper_service.list_research_projects(*trapper)), research_project,
               "research project", " you can access")
    cp = _pick(call(lambda: trapper_service.list_classification_projects(*trapper, research_project)),
               classification_project, "classification project", f" in research project {research_project}")
    col = _pick(call(lambda: trapper_service.list_collections(*trapper, classification_project)),
                collection, "collection", f" in classification project {classification_project}")
    available = call(lambda: trapper_service.list_deployments(*trapper, research_project, collection))

    def matches(d: dict, token: str) -> bool:
        return token == str(d["pk"]) or token.lower() == d["deployment_id"].lower()

    chosen = available
    if deployments:
        missing = [t for t in deployments if not any(matches(d, t) for d in available)]
        if missing:
            raise fail(f"Deployment(s) with no images in collection {collection}: {', '.join(missing)}")
        chosen = [d for d in available if any(matches(d, t) for t in deployments)]
    if exclude_deployments:
        chosen = [d for d in chosen if not any(matches(d, t) for t in exclude_deployments)]
    if not chosen:
        raise fail("No deployment left to work on.")
    return TrapperSelection(
        url=trapper[0],
        research_project=NamedRef(pk=rp["pk"], name=rp["name"]),
        classification_project=NamedRef(pk=cp["pk"], name=cp["name"]),
        collection=NamedRef(pk=col["pk"], name=col["name"]),
        deployments=[DeploymentRef(pk=d["pk"], deployment_id=d["deployment_id"], image_count=d["image_count"]) for d in chosen],
        all_deployments=len(chosen) == len(available),
    )


def criteria(
    max_interval: int | None, n_images_seq: int | None, only_classified: bool | None,
    remove_middle_humans: bool | None, remove_middle_vehicles: bool | None,
    collapse_empty_sequences: bool | None = None,
) -> UploadCriteria:
    """The settings' own criteria (SEQUENCES), with what the options change."""
    base = config.load_settings().SEQUENCES.model_dump()
    given = {
        "max_interval": max_interval, "images_per_sequence": n_images_seq, "only_classified": only_classified,
        "remove_middle_humans": remove_middle_humans, "remove_middle_vehicles": remove_middle_vehicles,
        "collapse_empty_sequences": collapse_empty_sequences,
    }
    return UploadCriteria(**{**base, **{k: v for k, v in given.items() if v is not None}})


def default_subject_set_name(selection: TrapperSelection, now: datetime | None = None) -> str:
    """wildintel-tools' own: {research project}_{pk}_{collection}_{pk}_{YYYY-MM}
    — the web wizard's default too."""
    now = now or datetime.now()
    rp, col = selection.research_project, selection.collection
    return f"{rp.name}_{rp.pk}_{col.name}_{col.pk}_{now:%Y-%m}"


def output_path(given: Path | None, folder: str, prefix: str, suffix: str) -> Path:
    """Where a command writes its file: the one given, or a new one in the
    app's documents folder."""
    if given is not None:
        given.expanduser().parent.mkdir(parents=True, exist_ok=True)
        return given.expanduser()
    directory = config.get_app_documents_dir() / folder
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{prefix}{datetime.now():%Y%m%d-%H%M%S}{suffix}"


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
