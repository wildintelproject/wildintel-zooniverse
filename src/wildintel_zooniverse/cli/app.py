"""WildINTEL Zooniverse — the command-line app: wildintel-tools' zooniverse
commands, with the web app's improvements, on the same core (and the same
settings.toml, sessions and log).

    wildintel-zooniverse --help
"""
from __future__ import annotations

from typing import Annotated, Optional

import typer
from pydantic import ValidationError
from rich.table import Column, Table

from wildintel_zooniverse.cli import commands_upload, commands_zooniverse
from wildintel_zooniverse.cli.common import call, console, fail, id_list, trapper_credentials, zooniverse_credentials
from wildintel_zooniverse.core import config, logging_setup
from wildintel_zooniverse.core.version import current_version
from wildintel_zooniverse.core.services import session_store, subjects_service, trapper_service, zooniverse_service

app = typer.Typer(
    name="wildintel-zooniverse",
    help="WildINTEL Zooniverse — Trapper camera-trap images to Zooniverse, and its volunteers' classifications back.",
    no_args_is_help=True,
    rich_markup_mode="rich",
)


def _show_version(value: bool) -> None:
    if value:
        console.print(current_version())
        raise typer.Exit()


@app.callback()
def main(
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Show every item, and the log's messages, as it works.")] = False,
    version: Annotated[bool, typer.Option("--version", help="Show the version and exit.", is_eager=True, callback=_show_version)] = False,
) -> None:
    # The log file gets the settings' level; the terminal only warnings,
    # unless --verbose.
    logging_setup.configure(console_level="DEBUG" if verbose else "WARNING")


# ── Connections ───────────────────────────────────────────────────────────────

@app.command("test-connection")
def test_connection() -> None:
    """Test the connection to Trapper and to Zooniverse (settings.toml's accounts)."""
    trapper = trapper_credentials()
    result = call(lambda: trapper_service.test_connection(*trapper))
    console.print(f"[green]✔[/green] Trapper {trapper[0]} as {trapper[1]} — {result['research_projects_count']} research project(s)")
    zoo = zooniverse_credentials()
    me = call(lambda: zooniverse_service.test_connection(*zoo))
    console.print(f"[green]✔[/green] Zooniverse as {me['login']}")


app.command("tc", hidden=True, help="Alias for test-connection.")(test_connection)


# ── config ────────────────────────────────────────────────────────────────────

config_app = typer.Typer(help="Show or change the settings — the same settings.toml as the web app's ⚙️ page.", no_args_is_help=True)
app.add_typer(config_app, name="config")

_SECRET = ("user_password",)


@config_app.command("show")
def config_show() -> None:
    """Show every setting (passwords never shown)."""
    settings = config.load_settings()
    for section, values in settings.model_dump().items():
        table = Table(title=section, title_justify="left", show_header=False, box=None, padding=(0, 2))
        for key, value in values.items():
            shown = ("(saved)" if value else "(not set)") if key in _SECRET else ("—" if value is None else str(value))
            table.add_row(f"{section}.{key}", shown)
        console.print(table)
    console.print(f"[dim]{config.active_config_file()}[/dim]")


@config_app.command("path")
def config_path() -> None:
    """Where settings.toml, the log and the app's documents are."""
    console.print(f"Settings:  {config.active_config_file()}")
    console.print(f"Log:       {logging_setup.log_file()}")
    console.print(f"Sessions:  {config.get_sessions_dir()}")
    console.print(f"Documents: {config.get_app_documents_dir()}")


@config_app.command("set")
def config_set(
    key: Annotated[str, typer.Argument(help="SECTION.field — e.g. TRAPPER.base_url, ZOONIVERSE.user_password, GENERAL.log_level.")],
    value: Annotated[Optional[str], typer.Argument(help="The new value — asked for (hidden) if left out.")] = None,
) -> None:
    """Change one setting."""
    section, _, field = key.partition(".")
    settings = config.load_settings()
    data = settings.model_dump()
    if section not in data or field not in data[section]:
        raise fail(f"No setting {key}. See: wildintel-zooniverse config show")
    if value is None:
        value = typer.prompt(key, hide_input=field in _SECRET)
    data[section][field] = value if value != "" else None
    try:
        new = config.Settings.model_validate(data)
    except ValidationError as exc:
        raise fail(f"Invalid {key}: {exc.errors()[0]['msg']}.") from exc
    config.save_settings(new)
    console.print(f"[green]✔[/green] {key} saved.")


# ── sessions ──────────────────────────────────────────────────────────────────

sessions_app = typer.Typer(help="Uploads left unfinished — the same sessions as the web app's.", no_args_is_help=True)
app.add_typer(sessions_app, name="sessions")


_PHASES = {
    "selected": "Images chosen", "filtered": "Filters chosen", "destination": "Ready to upload",
    "uploading": "Upload unfinished",
}


@sessions_app.command("list")
def sessions_list() -> None:
    """Unfinished uploads, newest first — resume one with: import --resume ID."""
    sessions = session_store.list_sessions()
    if not sessions:
        console.print("No unfinished uploads.")
        return
    # The session id whole, never cut: it's what import --resume takes;
    # the rest wraps.
    table = Table(Column("Session", no_wrap=True, min_width=36), "Run")
    for s in sessions:
        selection, destination = s["selection"], s.get("destination") or {}
        count = len(selection["deployments"])
        run = (
            f"[bold]{_PHASES.get(s.get('phase'), s.get('phase', ''))}[/bold] — collection {selection['collection']['name']}, "
            f"{'all ' if selection.get('all_deployments') else ''}{count} deployment{'s' if count != 1 else ''}"
            + (f" → {destination['subject_set_name']}" if destination else "")
            + f" [dim]· {(s.get('updated_at') or s.get('created_at') or '')[:16].replace('T', ' ')}[/dim]"
        )
        table.add_row(s["task_id"], run)
    console.print(table)


@sessions_app.command("discard")
def sessions_discard(task_id: Annotated[str, typer.Argument(help="The session's id (see: sessions list).")]) -> None:
    """Forget an unfinished upload (what it uploaded stays in Zooniverse)."""
    if session_store.read_manifest(task_id) is None:
        raise fail(f"No session {task_id}.")
    session_store.discard_session(task_id)
    console.print(f"[green]✔[/green] Session {task_id} discarded.")


# ── Trapper lookups ───────────────────────────────────────────────────────────

trapper_app = typer.Typer(help="Find the Trapper ids the other commands take.", no_args_is_help=True)
app.add_typer(trapper_app, name="trapper")


def _cell(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, int) and not isinstance(value, bool):
        return f"{value:,}"
    return str(value)


def _table(title: str, columns: list[str | Column], rows: list[list]) -> None:
    """Ids are never cut: they're what the other commands take."""
    table = Table(*columns, title=title, title_justify="left")
    for row in rows:
        table.add_row(*[_cell(c) for c in row])
    console.print(table)


@trapper_app.command("research-projects")
def trapper_research_projects() -> None:
    """The research projects you can access."""
    trapper = trapper_credentials()
    rows = call(lambda: trapper_service.list_research_projects(*trapper))
    _table("Research projects", ["pk", "Name", "Acronym"], [[str(r["pk"]), r["name"], r["acronym"]] for r in rows])


@trapper_app.command("classification-projects")
def trapper_classification_projects(rp: Annotated[int, typer.Option("--rp", "--research-project", help="Research project pk.")]) -> None:
    """A research project's classification projects."""
    trapper = trapper_credentials()
    rows = call(lambda: trapper_service.list_classification_projects(*trapper, rp))
    _table("Classification projects", ["pk", "Name", "Active"], [[str(r["pk"]), r["name"], r["is_active"]] for r in rows])


@trapper_app.command("collections")
def trapper_collections(cp: Annotated[int, typer.Option("--cp", "--classification-project", help="Classification project pk.")]) -> None:
    """A classification project's collections, with their counts."""
    trapper = trapper_credentials()
    rows = call(lambda: trapper_service.list_collections(*trapper, cp))
    _table("Collections", ["pk", "Name", "Status", "Images", "Classified", "Approved"],
           [[str(r["pk"]), r["name"], r["status"], r["total_count"], r["classified_count"], r["approved_count"]] for r in rows])


@trapper_app.command("deployments")
def trapper_deployments(
    rp: Annotated[int, typer.Option("--rp", "--research-project", help="Research project pk.")],
    collection: Annotated[int, typer.Option("--collection", "-c", help="Collection pk.")],
) -> None:
    """The research project's deployments with images in the collection."""
    trapper = trapper_credentials()
    rows = call(lambda: trapper_service.list_deployments(*trapper, rp, collection))
    _table("Deployments", ["pk", Column("Deployment", no_wrap=True), "Location", "Images", "Start", "End"],
           [[str(r["pk"]), r["deployment_id"], r["location_id"], r["image_count"], (r["start_date"] or "")[:10], (r["end_date"] or "")[:10]] for r in rows])


# ── Zooniverse lookups ────────────────────────────────────────────────────────

@app.command("workflows")
def workflows(project: Annotated[int, typer.Option("--project", "-p", help="Zooniverse project id.")]) -> None:
    """A Zooniverse project's workflows — and whether their classifications can be exported."""
    zoo = zooniverse_credentials()
    rows = call(lambda: zooniverse_service.list_workflows(*zoo, project))
    from wildintel_zooniverse.core.services.annotations import registry

    _table("Workflows", ["id", "Name", "Active", "Exportable"],
           [[str(w["id"]), w["display_name"], w["active"], registry.supported(w["id"])] for w in rows])


app.command("wf", hidden=True, help="Alias for workflows.")(workflows)


@app.command("subjectsets")
def subjectsets(project: Annotated[Optional[int], typer.Option("--project", "-p", help="Zooniverse project id — or the projects you can upload to, if left out.")] = None) -> None:
    """A Zooniverse project's subject sets — or, without --project, your projects."""
    zoo = zooniverse_credentials()
    if project is None:
        rows = call(lambda: zooniverse_service.list_projects(*zoo))
        _table("Projects (owned or collaborated on)", ["id", "Name", Column("Slug", overflow="fold")],
               [[str(p["id"]), p["display_name"], p["slug"]] for p in rows])
        return
    rows = call(lambda: zooniverse_service.list_subject_sets(*zoo, project))
    _table("Subject sets", ["id", "Name", "Subjects"], [[str(s["id"]), s["display_name"], s["subjects_count"]] for s in rows])


app.command("ss", hidden=True, help="Alias for subjectsets.")(subjectsets)


@app.command("subjects")
def subjects(
    ids: Annotated[Optional[str], typer.Argument(help="Subject ids, separated by commas or spaces — or @FILE.")] = None,
    subject_set: Annotated[Optional[int], typer.Option("--subject-set", "--ss", help="Browse this subject set instead.")] = None,
    page: Annotated[int, typer.Option("--page", help="The subject set's page (50 subjects each).")] = 1,
    metadata: Annotated[bool, typer.Option("--metadata/--no-metadata", help="Show each subject's metadata too.")] = False,
) -> None:
    """Zooniverse subjects: by id, or a subject set's, a page at a time — with the Trapper image each is."""
    zoo = zooniverse_credentials()
    if subject_set is not None:
        result = call(lambda: subjects_service.page(zoo, subject_set, page))
        found, not_found = result["subjects"], []
        title = f"Subject set {subject_set} — page {result['page']} of {result['page_count']} ({result['count']} subjects)"
    else:
        wanted = id_list(ids, "subject", "IDS")
        if not wanted:
            raise fail("Give subject ids, or --subject-set.")
        result = call(lambda: subjects_service.lookup(zoo, wanted))
        found, not_found = result["subjects"], result["not_found"]
        title = f"{len(found)} subject(s) found"
    _table(title, ["Subject", "Trapper media", "Subject sets", "Image"],
           [[str(s["id"]), str(s["media_id"] or "—"), ", ".join(map(str, s["subject_sets"])), (s["images"] or [""])[0]] for s in found])
    if metadata:
        for s in found:
            console.print(f"[bold]#{s['id']}[/bold]")
            for key, value in s["metadata"].items():
                console.print(f"  {key}: {value}")
    if not_found:
        console.print(f"[yellow]Not found (or not visible to you): {', '.join(map(str, not_found))}[/yellow]")


app.command("sbj", hidden=True, help="Alias for subjects.")(subjects)

commands_upload.register(app)
commands_zooniverse.register(app)


def run() -> None:
    app()
