"""The command-line app's Zooniverse commands — wildintel-tools' export,
download_ss, update-metadata and check-* / uploaded_media, on the web
app's core (its Export page and its Utils)."""
from __future__ import annotations

from pathlib import Path
from typing import Annotated, Optional

import typer
from rich.table import Column, Table

from wildintel_zooniverse.cli.common import (
    call, console, fail, id_list, output_path, pk_list, resolve_selection, trapper_credentials, write_json,
    zooniverse_credentials,
)
from wildintel_zooniverse.cli.commands_upload import (
    ClassificationProject, CollapseEmpty, Deployments, ExcludeDeployments, ImagesPerSequence, MaxInterval,
    MiddleHumans, MiddleVehicles, OnlyClassified, ResearchProject,
)
from wildintel_zooniverse.cli.common import criteria as make_criteria
from wildintel_zooniverse.cli.render import ItemsView, progress_bars, run
from wildintel_zooniverse.core.services import (
    classifications_export_service, metadata_service, subject_download_service, trapper_import_service,
    validation_service,
)
from wildintel_zooniverse.core.services.id_lists import IdLists

CollectionOption = Annotated[Optional[int], typer.Option("--collection", "-c", help="Trapper collection pk.")]
Output = Annotated[Optional[Path], typer.Option("--output", "-o", help="The file to write (default: in the app's documents folder).")]
WhiteList = Annotated[Optional[str], typer.Option("--white-list", "--wl", help="Only these subject ids (comma/space separated, or @FILE).")]
BlackList = Annotated[Optional[str], typer.Option("--black-list", "--exclude-subjects", "--bl", help="Never these subject ids (comma/space separated, or @FILE) — wins over --white-list.")]
Yes = Annotated[bool, typer.Option("--yes", "-y", help="Don't ask for confirmation.")]
Verbose = Annotated[bool, typer.Option("--verbose", help="Show every item as it's done.")]


def _selection(rp, cp, collection, deployments=None, exclude_deployments=None, *, required: bool = True):
    """The Trapper credentials and selection — None, None when not asked for
    and not required."""
    if rp is None and cp is None and collection is None and not required:
        return None, None
    if rp is None or cp is None or collection is None:
        raise fail("Give the Trapper --rp, --cp and --collection.")
    trapper = trapper_credentials()
    return trapper, resolve_selection(trapper, rp, cp, collection, pk_list(deployments), pk_list(exclude_deployments))


def _subject_lists(white_list: str | None, black_list: str | None) -> IdLists:
    return IdLists.of(id_list(white_list, "subject", "--white-list"), id_list(black_list, "subject", "--black-list"))


def _failures(failures: list[dict], id_key: str, title: str = "Failed") -> None:
    if not failures:
        return
    table = Table(id_key.replace("_", " ").capitalize(), "Error", title=f"{title} ({len(failures)})", title_justify="left")
    for f in failures[:50]:
        table.add_row(str(f[id_key]), f.get("detail", ""))
    console.print(table)


# ── export ────────────────────────────────────────────────────────────────────

def export(
    workflow: Annotated[int, typer.Option("--wf", "--workflow", help="Zooniverse workflow id (see: workflows --project).")],
    rp: ResearchProject = None, cp: ClassificationProject = None, collection: CollectionOption = None,
    deployments: Deployments = None,
    output: Annotated[Optional[Path], typer.Option("--output", "-o", help="Folder for the CSV files (default: the app's documents' exports).")] = None,
    regenerate: Annotated[bool, typer.Option("--regenerate", help="Ask Zooniverse for a new classifications export (may take a while) instead of the latest.")] = False,
    classified_by: Annotated[Optional[str], typer.Option("--classified-by", help="The CSV's classifiedBy (default: settings').")] = None,
    max_file_size: Annotated[Optional[float], typer.Option("--max-file-size", min=0.01, help="Split the CSV into files of at most this many MB — Trapper's import limit (default: settings').")] = None,
    save_zoo_annotations: Annotated[bool, typer.Option("--save-zoo-annotations/--no-save-zoo-annotations", help="Also write the volunteers' annotations, one row per annotation.")] = True,
    upload: Annotated[bool, typer.Option("--upload", help="Then import the CSV files into Trapper's classification project, by API.")] = False,
    approve: Annotated[bool, typer.Option("--approve", help="With --upload: approve the imported classifications.")] = False,
) -> None:
    """Export a workflow's classifications — the volunteers' consensus — as Trapper observation CSVs."""
    zoo = zooniverse_credentials()
    trapper, selection = _selection(rp, cp, collection, deployments)
    source = classifications_export_service.TrapperSource(*trapper, selection)
    folder = output.expanduser() if output else classifications_export_service.default_output_dir()
    events = call(lambda: classifications_export_service.export_stream(
        zoo, workflow, source, folder, regenerate=regenerate, save_zoo_annotations=save_zoo_annotations,
        classified_by=classified_by, max_file_size_mb=max_file_size,
    ))

    result: dict = {}
    with progress_bars() as progress:
        tasks: dict[str, int] = {}

        def handle(e: dict) -> None:
            kind = e["type"]
            if kind == "export":
                if "export" not in tasks:
                    tasks["export"] = progress.add_task("Zooniverse's classifications export", total=None, count="")
                if e["state"] == "ready":
                    progress.update(tasks["export"], total=1, completed=1,
                                    description=f"[green]✓[/green] Classifications export of {(e['updated_at'] or '')[:16].replace('T', ' ')}")
                else:
                    progress.update(tasks["export"], description="Zooniverse is generating the classifications export…")
            elif kind == "classifications":
                if "rows" not in tasks:
                    tasks["rows"] = progress.add_task("Downloading classifications", total=e["total_bytes"])
                mb = f"{e['bytes'] / 1e6:,.0f}" + (f"/{e['total_bytes'] / 1e6:,.0f}" if e["total_bytes"] else "")
                progress.update(tasks["rows"], completed=e["bytes"], count=f"{mb} MB",
                                description=f"Downloading classifications ({e['rows']:,} rows)")
            elif kind == "classifications_done":
                if "rows" in tasks:
                    t = progress.tasks[tasks["rows"]]
                    progress.update(tasks["rows"], total=t.completed or 1, completed=t.completed or 1)
                else:
                    tasks["rows"] = progress.add_task("", total=1, completed=1, count="")
                progress.update(tasks["rows"], description=f"[green]✓[/green] {e['rows']:,} classifications of {e['subjects']:,} subjects")
            elif kind == "trapper":
                tasks["trapper"] = progress.add_task("Trapper's observations (deployments)", total=e["total"])
            elif kind == "deployment":
                progress.advance(tasks["trapper"])
            elif kind == "subjects":
                tasks["subjects"] = progress.add_task("Voting subjects", total=e["total"])
            elif kind == "progress":
                progress.update(tasks["subjects"], completed=e["done"])
            elif kind == "done":
                result.update(e)

        finished = call(lambda: run(events, handle))
    if not finished:
        raise typer.Exit(1)

    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_row("Workflow", f"{result['workflow']['name']} ({result['workflow']['id']})")
    table.add_row("Subjects", f"{result['subjects']:,}")
    table.add_row("Exported", f"{result['exported']:,} subjects, {result['observations']:,} observations, {result['rows']:,} CSV rows")
    for reason, count in result["skipped"].items():
        if count:
            table.add_row(f"Skipped: {reason.replace('_', ' ')}", f"{count:,}")
    console.print(table)
    for f in result["files"]:
        console.print(f"[green]✔[/green] {f['path']} ({f['rows']:,} rows)")
    if result["zoo_annotations_file"]:
        console.print(f"[green]✔[/green] {result['zoo_annotations_file']['path']} (volunteers' annotations)")
    if not result["files"]:
        console.print("[yellow]No observation to export.[/yellow]")
        return

    if not upload:
        console.print(f"Import them into Trapper with --upload, or at {result['trapper_import_url']}")
        return
    files = [Path(f["path"]) for f in result["files"]]
    imports = call(lambda: trapper_import_service.import_stream(trapper, selection.classification_project.pk, files, approve=approve))
    failed = 0

    def show(e: dict) -> None:
        nonlocal failed
        if e["type"] == "file":
            console.print(f"Importing {Path(e['path']).name} ({e['index']}/{e['total']})…")
        elif e["type"] == "imported":
            console.print(f"  [green]✔[/green] {e['message'] or 'imported'}" + (f" — Trapper task {e['task_id']}" if e["task_id"] else ""))
        elif e["type"] == "failed":
            failed += 1
            console.print(f"  [red]✘ {e['detail']}[/red]")

    call(lambda: run(imports, show))
    if failed:
        raise typer.Exit(1)


# ── download_ss ───────────────────────────────────────────────────────────────

def download_ss(
    subject_sets: Annotated[str, typer.Argument(help="Subject set ids, separated by commas or spaces.")],
    output: Annotated[Optional[Path], typer.Option("--output", "-o", help="Folder to download into — a subfolder per subject set (default: settings').")] = None,
    overwrite: Annotated[bool, typer.Option("--overwrite", help="Download again the images already in the folder.")] = False,
    white_list: WhiteList = None, black_list: BlackList = None, verbose: Verbose = False,
) -> None:
    """Download subject sets' images."""
    ids = id_list(subject_sets, "subject", "SUBJECT_SETS")
    if not ids:
        raise fail("Give the subject set ids.")
    zoo = zooniverse_credentials()
    folder = output.expanduser() if output else subject_download_service.default_output_dir()
    events = call(lambda: subject_download_service.download_stream(
        zoo, ids, folder, overwrite=overwrite, subjects=_subject_lists(white_list, black_list),
    ))
    result: dict = {}
    with progress_bars() as progress:
        view = ItemsView(progress, verbose)

        def handle(e: dict) -> None:
            if e["type"] == "subject_set":
                view.group(e["id"], f"{e['name']} ({e['id']})", e["total"])
            elif e["type"] == "subject":
                view.item(e["subject_set_id"], e["status"], e, e["file_name"])
            elif e["type"] == "done":
                result.update(e)

        call(lambda: run(events, handle))
    _failures(view.failures, "subject_id")
    if result:
        console.print(
            f"[green]✔[/green] {result['downloaded']:,} downloaded, {result['existing']:,} already there, "
            f"{result['filtered_out']:,} left out by the subject lists, {result['failed']:,} failed — {result['output_dir']}"
        )
    if view.failures:
        raise typer.Exit(1)


# ── update-metadata ───────────────────────────────────────────────────────────

def update_metadata(
    subject_set: Annotated[int, typer.Argument(help="Subject set id.")],
    rp: ResearchProject = None, cp: ClassificationProject = None, collection: CollectionOption = None,
    deployments: Deployments = None,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Only show what would change.")] = False,
    white_list: WhiteList = None, black_list: BlackList = None, yes: Yes = False, verbose: Verbose = False,
) -> None:
    """Rewrite subjects' metadata (#mediaID, #deploymentID, #fileName, Trapper link) from the Trapper collection they came from."""
    zoo = zooniverse_credentials()
    trapper, selection = _selection(rp, cp, collection, deployments)
    if not dry_run and not yes and not typer.confirm(f"This changes the metadata of subject set {subject_set}'s subjects. Go on?"):
        raise typer.Exit()
    events = call(lambda: metadata_service.update_stream(
        zoo, subject_set, metadata_service.TrapperSource(*trapper, selection), dry_run=dry_run,
        subjects=_subject_lists(white_list, black_list),
    ))
    changes: list[dict] = []
    result: dict = {}
    with progress_bars() as progress:
        view = ItemsView(progress, verbose)

        def handle(e: dict) -> None:
            kind = e["type"]
            if kind == "trapper":
                view.group("trapper", "Trapper's media (deployments)", e["total"])
            elif kind == "deployment":
                progress.advance(view.tasks["trapper"])
            elif kind == "subjects":
                view.group("subjects", f"{e['name']} ({e['id']})", e["total"])
            elif kind == "subject":
                view.item("subjects", e["status"], e, f"#{e['subject_id']}")
                if e["status"] in ("would_update", "updated") and len(changes) < 50:
                    changes.append(e)
            elif kind == "done":
                result.update(e)

        call(lambda: run(events, handle))
    if changes:
        table = Table("Subject", "Field", Column("Now", overflow="fold"), Column("New", overflow="fold"), title="Changes" + (" (first 50)" if len(changes) >= 50 else ""), title_justify="left")
        for e in changes:
            for c in e["changes"]:
                table.add_row(str(e["subject_id"]), c["field"], str(c["old"]), str(c["new"]))
        console.print(table)
    _failures(view.failures, "subject_id")
    counts = {k: v for k, v in view.counts.items() if v}
    console.print("[green]✔[/green] " + (", ".join(f"{v:,} {k.replace('_', ' ')}" for k, v in counts.items()) or "No subjects."))
    if view.failures:
        raise typer.Exit(1)


# ── Checks ────────────────────────────────────────────────────────────────────

def _validate(subject_set: int, trapper=None, selection=None, crit=None) -> dict:
    zoo = zooniverse_credentials()
    comparison = (validation_service.TrapperComparison(*trapper, selection, crit) if selection is not None else None)
    events = call(lambda: validation_service.validate_stream(zoo, subject_set, comparison))
    report: dict = {}
    with progress_bars() as progress:
        tasks: dict[str, int] = {}

        def handle(e: dict) -> None:
            kind = e["type"]
            if kind == "subjects":
                tasks["subjects"] = progress.add_task(f"Listing {e['name']} ({e['id']})", total=e["total"])
            elif kind == "progress":
                progress.update(tasks["subjects"], completed=e["done"])
            elif kind == "trapper":
                tasks["trapper"] = progress.add_task("Trapper's selection (deployments)", total=e["total"])
            elif kind == "deployment":
                progress.advance(tasks["trapper"])
            elif kind == "report":
                report.update(e)

        finished = call(lambda: run(events, handle))
    if not finished:
        raise typer.Exit(1)
    return report


def _save(report_part, output: Path | None, name: str, subject_set: int) -> None:
    path = output_path(output, "reports", f"{name}_ss{subject_set}_", ".json")
    write_json(path, report_part)
    console.print(f"Written to {path}")


def check_subject_set(
    subject_set: Annotated[int, typer.Argument(help="Subject set id.")],
    rp: ResearchProject = None, cp: ClassificationProject = None, collection: CollectionOption = None,
    deployments: Deployments = None, exclude_deployments: ExcludeDeployments = None,
    max_interval: MaxInterval = None, n_images_seq: ImagesPerSequence = None, only_classified: OnlyClassified = None,
    remove_middle_humans: MiddleHumans = None, remove_middle_vehicles: MiddleVehicles = None,
    collapse_empty_sequences: CollapseEmpty = None,
    output: Output = None,
) -> None:
    """Every check at once: duplicated media, unmatched subjects, metadata — and, with the Trapper collection, missing and extra images."""
    trapper, selection = _selection(rp, cp, collection, deployments, exclude_deployments, required=False)
    crit = (
        make_criteria(max_interval, n_images_seq, only_classified, remove_middle_humans, remove_middle_vehicles, collapse_empty_sequences)
        if selection else None
    )
    report = _validate(subject_set, trapper, selection, crit)
    table = Table(show_header=False, box=None, padding=(0, 2), title=f"{report['subject_set']['name']} ({subject_set})", title_justify="left")
    table.add_row("Subjects", f"{report['subjects']:,}")
    table.add_row("Trapper images", f"{report['media']:,}")
    table.add_row("Duplicated images", f"{len(report['duplicated']):,}")
    table.add_row("Subjects with no media id", f"{len(report['unmatched']):,}")
    table.add_row("Subjects with metadata issues", f"{len(report['metadata_issues']):,}")
    if report["compared"]:
        table.add_row("Expected from Trapper", f"{report['expected']:,}")
        table.add_row("Missing", f"{len(report['missing']):,}")
        table.add_row("Not expected (extra)", f"{len(report['extra']):,}")
    console.print(table)
    if report["compared"]:
        per = Table(Column("Deployment", no_wrap=True), "Expected", "Uploaded", "Missing", title_justify="left")
        for d in report["deployments"]:
            per.add_row(d["deployment_id"], f"{d['expected']:,}", f"{d['uploaded']:,}", f"{d['missing']:,}")
        console.print(per)
    else:
        console.print("[dim]Give --rp, --cp and --collection to compare with Trapper too (missing and extra images).[/dim]")
    _save({k: v for k, v in report.items() if k != "type"}, output, "check", subject_set)


def check_missing_media(
    subject_set: Annotated[int, typer.Argument(help="Subject set id.")],
    rp: ResearchProject = None, cp: ClassificationProject = None, collection: CollectionOption = None,
    deployments: Deployments = None, exclude_deployments: ExcludeDeployments = None,
    max_interval: MaxInterval = None, n_images_seq: ImagesPerSequence = None, only_classified: OnlyClassified = None,
    remove_middle_humans: MiddleHumans = None, remove_middle_vehicles: MiddleVehicles = None,
    collapse_empty_sequences: CollapseEmpty = None,
    output: Output = None,
) -> None:
    """The images an import with these criteria would upload that aren't in the subject set — and those in it it wouldn't."""
    trapper, selection = _selection(rp, cp, collection, deployments, exclude_deployments)
    crit = make_criteria(max_interval, n_images_seq, only_classified, remove_middle_humans, remove_middle_vehicles, collapse_empty_sequences)
    report = _validate(subject_set, trapper, selection, crit)
    table = Table("Media", Column("Deployment", no_wrap=True), "File", title=f"Missing: {len(report['missing']):,} of {report['expected']:,}", title_justify="left")
    for m in report["missing"][:100]:
        table.add_row(str(m["media_id"]), m["deployment_id"], m["file_name"])
    console.print(table)
    if report["extra"]:
        console.print(f"[yellow]{len(report['extra']):,} image(s) in the subject set the criteria wouldn't upload.[/yellow]")
    _save({"subject_set": report["subject_set"], "expected": report["expected"], "missing": report["missing"],
           "extra": report["extra"], "deployments": report["deployments"]}, output, "missing", subject_set)
    console.print("[dim]Upload just the missing ones: import … --media @THAT_FILE[/dim]")


def check_duplicated_media(
    subject_set: Annotated[int, typer.Argument(help="Subject set id.")], output: Output = None,
) -> None:
    """Trapper images uploaded more than once to the subject set."""
    report = _validate(subject_set)
    table = Table("Media", "Subjects", title=f"Duplicated: {len(report['duplicated']):,}", title_justify="left")
    for d in report["duplicated"][:100]:
        table.add_row(str(d["media_id"]), ", ".join(map(str, d["subject_ids"])))
    console.print(table)
    _save({"subject_set": report["subject_set"], "duplicated": report["duplicated"]}, output, "duplicated", subject_set)


def check_unmatched_subjects(
    subject_set: Annotated[int, typer.Argument(help="Subject set id.")], output: Output = None,
) -> None:
    """Subjects with no Trapper media id in their metadata."""
    report = _validate(subject_set)
    console.print(f"Unmatched: {len(report['unmatched']):,}" + (f" — {', '.join(map(str, report['unmatched'][:100]))}" if report["unmatched"] else ""))
    _save({"subject_set": report["subject_set"], "unmatched": report["unmatched"]}, output, "unmatched", subject_set)


def check_metadata(
    subject_set: Annotated[int, typer.Argument(help="Subject set id.")], output: Output = None,
) -> None:
    """Subjects whose metadata is incomplete or inconsistent — fix them with update-metadata."""
    report = _validate(subject_set)
    table = Table("Subject", "Media", "Issues", title=f"Metadata issues: {len(report['metadata_issues']):,}", title_justify="left")
    for i in report["metadata_issues"][:100]:
        table.add_row(str(i["subject_id"]), str(i["media_id"] or "—"), "; ".join(i["issues"]))
    console.print(table)
    _save({"subject_set": report["subject_set"], "metadata_issues": report["metadata_issues"]}, output, "metadata", subject_set)


def uploaded_media(
    subject_set: Annotated[int, typer.Argument(help="Subject set id.")], output: Output = None,
) -> None:
    """Every Trapper image in the subject set, with its subject(s)."""
    report = _validate(subject_set)
    console.print(f"{report['media']:,} Trapper images in {report['subjects']:,} subjects.")
    _save({"subject_set": report["subject_set"], "uploaded": report["uploaded"]}, output, "uploaded", subject_set)


def register(app: typer.Typer) -> None:
    app.command("export")(export)
    app.command("download_ss")(download_ss)
    app.command("dl_ss", hidden=True, help="Alias for download_ss.")(download_ss)
    app.command("update-metadata")(update_metadata)
    app.command("um", hidden=True, help="Alias for update-metadata.")(update_metadata)
    app.command("check-subject-set")(check_subject_set)
    app.command("check-missing-media")(check_missing_media)
    app.command("check-duplicated-media")(check_duplicated_media)
    app.command("check-unmatched-subjects")(check_unmatched_subjects)
    app.command("check_metadata")(check_metadata)
    app.command("uploaded_media")(uploaded_media)
