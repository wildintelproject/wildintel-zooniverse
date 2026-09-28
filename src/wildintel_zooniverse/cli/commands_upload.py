"""The command-line app's upload commands — wildintel-tools' estimate-upload,
analyze-sequences and import, on the web app's core: the same selection
and sampling, the same sessions (an import can be resumed, from here or
the web app, never uploading an image twice), the same pipeline."""
from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Annotated, Optional

import typer
from rich.table import Column, Table

from wildintel_zooniverse.cli.common import (
    call, console, criteria, default_subject_set_name, fail, id_list, output_path, pk_list, resolve_selection,
    trapper_credentials, zooniverse_credentials,
)
from wildintel_zooniverse.cli.render import UploadView, progress_bars, run
from wildintel_zooniverse.core.schemas.requests import ZooniverseDestination, ZooniverseProjectRef
from wildintel_zooniverse.core.services import session_store, trapper_service, upload_service, zooniverse_service

# ── Shared options ────────────────────────────────────────────────────────────

Collection = Annotated[Optional[int], typer.Argument(help="Collection pk.")]
ResearchProject = Annotated[Optional[int], typer.Option("--rp", "--research-project", help="Research project pk.")]
ClassificationProject = Annotated[Optional[int], typer.Option("--cp", "--classification-project", help="Classification project pk linked to the collection.")]
Deployments = Annotated[Optional[str], typer.Option("--deployments", "--d", help="Only these deployments (pk or deployment id, comma or space separated). Default: all of the collection's.")]
ExcludeDeployments = Annotated[Optional[str], typer.Option("--exclude-deployments", "--ed", help="Deployments to skip.")]
MaxInterval = Annotated[Optional[int], typer.Option("--max-interval", min=1, help="Max. seconds between two images of a sequence (default: settings').")]
ImagesPerSequence = Annotated[Optional[int], typer.Option("--n-images-seq", min=1, help="Images kept from each sequence (default: settings').")]
OnlyClassified = Annotated[Optional[bool], typer.Option("--only-classified/--all-images", help="Only images with an observation other than unclassified (default: settings').")]
MiddleHumans = Annotated[Optional[bool], typer.Option("--remove-middle-humans/--keep-middle-humans", help="Remove humans from middle sequences (default: settings').")]
MiddleVehicles = Annotated[Optional[bool], typer.Option("--remove-middle-vehicles/--keep-middle-vehicles", help="Remove vehicles from middle sequences (default: settings').")]
CollapseEmpty = Annotated[Optional[bool], typer.Option("--collapse-empty-sequences/--keep-empty-sequences", help="Reduce sequences with only 'empty' images to their second image (default: settings').")]


def _selection(rp, cp, collection, deployments, exclude_deployments):
    if rp is None or cp is None or collection is None:
        raise fail("Give the collection, --rp and --cp.")
    trapper = trapper_credentials()
    return trapper, resolve_selection(trapper, rp, cp, collection, pk_list(deployments), pk_list(exclude_deployments))


def _counts_table(title: str, rows: list[dict]) -> Table:
    table = Table(Column("Deployment", no_wrap=True), "Images", "Candidates", "Sequences", "Removed", "Upload",
                  title=title, title_justify="left")
    totals = dict.fromkeys(("images", "candidates", "sequences", "removed_middle", "selected"), 0)
    for r in rows:
        table.add_row(r["deployment_id"], *(f"{r[k]:,}" for k in totals))
        for k in totals:
            totals[k] += r[k]
    table.add_section()
    table.add_row("[bold]Total[/bold]", *(f"[bold]{v:,}[/bold]" for v in totals.values()))
    return table


def _preview(selection, crit, trapper, detail: bool) -> list[dict]:
    summaries = call(lambda: trapper_service.preview_stream(*trapper, selection, crit, detail=detail))
    rows: list[dict] = []
    with progress_bars() as progress:
        task = progress.add_task("Counting deployments (one at a time)", total=len(selection.deployments))

        def handle(summary: dict) -> None:
            rows.append(summary)
            progress.advance(task)

        call(lambda: run(summaries, handle))
    return rows


# ── estimate-upload ───────────────────────────────────────────────────────────

def estimate_upload(
    collection: Collection = None, rp: ResearchProject = None, cp: ClassificationProject = None,
    deployments: Deployments = None, exclude_deployments: ExcludeDeployments = None,
    max_interval: MaxInterval = None, n_images_seq: ImagesPerSequence = None, only_classified: OnlyClassified = None,
    remove_middle_humans: MiddleHumans = None, remove_middle_vehicles: MiddleVehicles = None,
    collapse_empty_sequences: CollapseEmpty = None,
) -> None:
    """Estimate how many images of each deployment an import would upload — the web app's Preview."""
    trapper, selection = _selection(rp, cp, collection, deployments, exclude_deployments)
    crit = criteria(max_interval, n_images_seq, only_classified, remove_middle_humans, remove_middle_vehicles, collapse_empty_sequences)
    rows = _preview(selection, crit, trapper, detail=False)
    console.print(_counts_table(f"Collection {selection.collection.name}", rows))


# ── analyze-sequences ─────────────────────────────────────────────────────────

SHOWN_SEQUENCES = 100

SEQUENCE_FIELDS = [
    "deploymentID", "sequence_n", "total_images", "media_ids", "first_date", "last_date", "duration_s",
    "not_sampled_media_ids", "removed_human_media_ids", "removed_vehicle_media_ids", "collapsed_empty_media_ids",
]


def sequences_csv(rows: list[dict]) -> str:
    """wildintel-tools' analyze-sequences columns (media_ids: the uploaded
    ones), plus why the other images aren't — the web app's CSV."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(SEQUENCE_FIELDS)
    for d in rows:
        for s in d.get("sequence_detail") or []:
            writer.writerow([
                d["deployment_id"], s["number"], s["images"], "|".join(map(str, s["uploaded"])), s["start"], s["end"],
                s["duration_s"], "|".join(map(str, s["not_sampled"])), "|".join(map(str, s["removed_human"])),
                "|".join(map(str, s["removed_vehicle"])), "|".join(map(str, s["collapsed_empty"])),
            ])
    return buf.getvalue()


def analyze_sequences(
    collection: Collection = None, rp: ResearchProject = None, cp: ClassificationProject = None,
    deployments: Deployments = None, exclude_deployments: ExcludeDeployments = None,
    max_interval: MaxInterval = None, n_images_seq: ImagesPerSequence = None, only_classified: OnlyClassified = None,
    remove_middle_humans: MiddleHumans = None, remove_middle_vehicles: MiddleVehicles = None,
    collapse_empty_sequences: CollapseEmpty = None,
    output: Annotated[Optional[Path], typer.Option("--output", "-o", help="The CSV to write (default: in the app's documents folder).")] = None,
) -> None:
    """Every sequence of every deployment, and what becomes of each image — to a CSV."""
    trapper, selection = _selection(rp, cp, collection, deployments, exclude_deployments)
    crit = criteria(max_interval, n_images_seq, only_classified, remove_middle_humans, remove_middle_vehicles, collapse_empty_sequences)
    rows = _preview(selection, crit, trapper, detail=True)
    path = output_path(output, "exports", f"sequences_col{selection.collection.pk}_", ".csv")
    path.write_text(sequences_csv(rows), encoding="utf-8")

    # A table per deployment, the first SHOWN_SEQUENCES sequences in all —
    # the CSV has every one.
    shown = total = 0
    for d in rows:
        sequences = d.get("sequence_detail") or []
        total += len(sequences)
        if shown >= SHOWN_SEQUENCES or not sequences:
            continue
        table = Table("#", Column("Start", no_wrap=True), "Seconds", "Images", "Removed", "Upload",
                      title=f"{d['deployment_id']} — sequences", title_justify="left")
        for s in sequences[:SHOWN_SEQUENCES - shown]:
            table.add_row(str(s["number"]), s["start"][:16].replace("T", " "), str(s["duration_s"]), str(s["images"]),
                          str(len(s["removed_human"]) + len(s["removed_vehicle"])), str(len(s["uploaded"])))
        shown += min(len(sequences), SHOWN_SEQUENCES - shown)
        console.print(table)
    if total > shown:
        console.print(f"[dim]The first {shown:,} of {total:,} sequences — the CSV has them all.[/dim]")
    console.print(_counts_table("Totals", rows))
    console.print(f"[green]✔[/green] {total:,} sequences written to {path}")


# ── import ────────────────────────────────────────────────────────────────────

def _new_session(selection, crit, destination, media, exclude_media) -> str:
    task_id = session_store.new_task_id()
    session_store.write_selection_phase(task_id, task="upload", source_type="trapper", selection=selection.model_dump())
    session_store.write_criteria_phase(task_id, criteria=crit.model_dump())
    session_store.write_destination_phase(task_id, destination=destination.model_dump())
    if media is not None or exclude_media:
        session_store.write_media_lists(task_id, include=media, exclude=exclude_media or [])
    return task_id


def importation(
    collection: Collection = None, rp: ResearchProject = None, cp: ClassificationProject = None,
    deployments: Deployments = None, exclude_deployments: ExcludeDeployments = None,
    max_interval: MaxInterval = None, n_images_seq: ImagesPerSequence = None, only_classified: OnlyClassified = None,
    remove_middle_humans: MiddleHumans = None, remove_middle_vehicles: MiddleVehicles = None,
    collapse_empty_sequences: CollapseEmpty = None,
    project: Annotated[Optional[int], typer.Option("--project", "-p", help="Zooniverse project id.")] = None,
    subject_set: Annotated[Optional[str], typer.Option("--subject-set", "--ss", help="Subject set name — an existing one gets the images; default: wildintel-tools' {research project}_{pk}_{collection}_{pk}_{YYYY-MM}.")] = None,
    media: Annotated[Optional[str], typer.Option("--media", "--m", help="Only these Trapper media ids (comma/space separated, or @FILE).")] = None,
    exclude_media: Annotated[Optional[str], typer.Option("--exclude-media", "--em", help="Never these media ids (comma/space separated, or @FILE) — wins over --media.")] = None,
    skip_in_subject_set: Annotated[bool, typer.Option("--skip-in-subject-set", help="Also skip images already in the subject set, whoever uploaded them. SLOW: lists every subject of it first.")] = False,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Do everything but upload: images are fetched and chosen, downloads and uploads simulated.")] = False,
    resume: Annotated[Optional[str], typer.Option("--resume", help="Resume this session (see: sessions list) — its own selection, criteria and destination.")] = None,
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Don't ask for confirmation.")] = False,
    verbose: Annotated[bool, typer.Option("--verbose", help="Show every image as it's done.")] = False,
) -> None:
    """Import (upload) a Trapper collection's images to a Zooniverse subject set."""
    zoo = zooniverse_credentials()
    if resume:
        manifest = session_store.read_manifest(resume)
        if manifest is None or not manifest.get("destination"):
            raise fail(f"No session {resume} ready to upload (see: sessions list).")
        task_id = resume
        if media is not None or exclude_media is not None:
            session_store.write_media_lists(task_id, include=id_list(media, "media", "--media"),
                                            exclude=id_list(exclude_media, "media", "--exclude-media") or [])
    else:
        if project is None:
            raise fail("Give the Zooniverse --project.")
        trapper, selection = _selection(rp, cp, collection, deployments, exclude_deployments)
        crit = criteria(max_interval, n_images_seq, only_classified, remove_middle_humans, remove_middle_vehicles, collapse_empty_sequences)
        projects = call(lambda: zooniverse_service.list_projects(*zoo))
        found = next((p for p in projects if p["id"] == project), None)
        if found is None:
            raise fail(f"Zooniverse project {project} isn't one you own or collaborate on.")
        destination = ZooniverseDestination(
            project=ZooniverseProjectRef(id=found["id"], name=found["display_name"], slug=found["slug"]),
            subject_set_name=subject_set or default_subject_set_name(selection),
        )
        task_id = _new_session(selection, crit, destination, id_list(media, "media", "--media"),
                               id_list(exclude_media, "media", "--exclude-media"))

    run_ = upload_service.load_run(task_id)
    trapper = trapper_credentials(run_.selection.url)
    console.print(
        f"{'[bold]Dry run[/bold] of the upload' if dry_run else '[bold]Upload[/bold]'} of collection "
        f"[bold]{run_.selection.collection.name}[/bold] ({len(run_.selection.deployments)} deployments) → Zooniverse "
        f"project [bold]{run_.destination.project.name}[/bold], subject set [bold]{run_.destination.subject_set_name}[/bold]"
        f" — session {task_id}"
    )
    if not dry_run and not yes and not typer.confirm("This creates the subjects in Zooniverse. Go on?"):
        raise typer.Exit()

    events = call(lambda: upload_service.run_stream(
        run_, trapper, zoo, dry_run=dry_run, skip_in_subject_set=skip_in_subject_set,
    ))
    with progress_bars() as progress:
        view = UploadView(progress, [d.deployment_id for d in run_.selection.deployments], verbose)
        finished = call(lambda: run(events, view))

    if view.subject_set:
        ss = view.subject_set
        console.print(f"Subject set {ss['name']}: " + (f"#{ss['id']}" if ss["id"] else "would be created") + ("" if ss["exists"] else " (new)"))
    if view.failures:
        table = Table("Media", Column("Deployment", no_wrap=True), "Step", "Error", title="Failed", title_justify="left")
        for f in view.failures[:50]:
            table.add_row(str(f["media_id"]), f["deployment_id"], f.get("step", ""), f.get("detail", ""))
        console.print(table)
    if view.totals:
        t = view.totals
        verb = "would be uploaded" if dry_run else "uploaded"
        console.print(
            f"[green]✔[/green] {t['uploaded']:,} images {verb}, {t['skipped']:,} skipped (already uploaded), "
            f"{t['failed']:,} failed, {t.get('filtered_out', 0):,} left out by the media lists."
        )
    if not dry_run and (not finished or (view.totals and view.totals["failed"])):
        console.print(f"Resume — the images already uploaded are skipped: [bold]wildintel-zooniverse import --resume {task_id}[/bold]")


def register(app: typer.Typer) -> None:
    app.command("estimate-upload")(estimate_upload)
    app.command("analyze-sequences")(analyze_sequences)
    app.command("import")(importation)
