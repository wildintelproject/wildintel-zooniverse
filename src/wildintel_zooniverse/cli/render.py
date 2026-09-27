"""The command-line app's progress: the core's event streams (the very
events the web app shows as panels) rendered as rich progress bars — a
total, one per deployment or subject set, and the files in flight."""
from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager

from rich.progress import BarColumn, Progress, ProgressColumn, SpinnerColumn, Task, TaskID, TextColumn, TimeElapsedColumn
from rich.table import Column
from rich.text import Text

from wildintel_zooniverse.cli.common import console, err_console


class CountColumn(ProgressColumn):
    """done/total, with thousands separators — or the task's own "count"
    field, for what isn't a count (e.g. bytes downloaded)."""

    def render(self, task: Task) -> Text:
        if "count" in task.fields:
            return Text(task.fields["count"], style="progress.download")
        total = f"{int(task.total):,}" if task.total is not None else "?"
        return Text(f"{int(task.completed):,}/{total}", style="progress.download")


@contextmanager
def progress_bars() -> Iterator[Progress]:
    progress = Progress(
        SpinnerColumn(), TextColumn("{task.description}"), BarColumn(bar_width=None),
        # Counts whole: the bar gives way first.
        CountColumn(table_column=Column(no_wrap=True, min_width=13)), TimeElapsedColumn(),
        console=console,
    )
    with progress:
        yield progress


def run(events: Iterator[dict], handle: Callable[[dict], None]) -> bool:
    """Feeds each event to handle. Ctrl+C closes the stream — the core then
    stops the work cleanly (what's done stays done). Returns whether it ran
    to the end. An {"type": "error"} can't come from the core itself (only
    the web routers make those), so errors raise as exceptions."""
    try:
        for event in events:
            handle(event)
    except KeyboardInterrupt:
        close = getattr(events, "close", None)
        if close:
            close()
        err_console.print("[yellow]Stopped.[/yellow]")
        return False
    return True


class UploadView:
    """upload_service.run_stream's events: one bar per deployment (its images,
    once it's fetched), with the files being downloaded (↓) and uploaded (↑),
    and a total by deployment."""

    def __init__(self, progress: Progress, deployment_ids: list[str], verbose: bool = False):
        self.progress = progress
        self.verbose = verbose
        self.total = progress.add_task("[bold]Total[/bold] (deployments)", total=len(deployment_ids))
        self.tasks: dict[str, TaskID] = {}
        self.selected: dict[str, int] = {}
        self.done: dict[str, int] = {}
        self.in_flight: dict[str, dict[int, str]] = {}
        self.checking: TaskID | None = None
        self.subject_set: dict | None = None
        self.failures: list[dict] = []
        self.totals: dict | None = None

    def _describe(self, deployment_id: str) -> None:
        flying = self.in_flight.get(deployment_id) or {}
        tail = "  " + "  ".join(f"{arrow} {name}" for name, arrow in list(flying.items())[-2:]) if flying else ""
        self.progress.update(self.tasks[deployment_id], description=f"{deployment_id}[dim]{tail}[/dim]")

    def _finish_if_done(self, deployment_id: str) -> None:
        if self.done[deployment_id] >= self.selected.get(deployment_id, 0):
            self.progress.update(self.tasks[deployment_id], description=f"[green]✓[/green] {deployment_id}")
            self.progress.advance(self.total)

    def __call__(self, event: dict) -> None:
        kind = event["type"]
        if kind == "start":
            self.subject_set = event["subject_set"]
        elif kind == "checking":
            if self.checking is None:
                self.checking = self.progress.add_task("Listing the subject set's subjects (slow)…", total=event["total"])
            self.progress.update(self.checking, completed=event["done"])
        elif kind == "checked":
            self.progress.update(self.checking, completed=event["subjects"],
                                 description=f"[green]✓[/green] {event['media']} Trapper images already in the subject set")
        elif kind == "fetching":
            d = event["deployment_id"]
            self.tasks[d] = self.progress.add_task(f"{d} [dim]fetching images from Trapper…[/dim]", total=None)
            self.done[d] = 0
        elif kind == "deployment":
            d = event["deployment_id"]
            self.selected[d] = event["selected"]
            self.progress.update(self.tasks[d], total=event["selected"], description=d)
            self._finish_if_done(d)
        elif kind == "step":
            d = event["deployment_id"]
            self.in_flight.setdefault(d, {})[event["file_name"]] = "↓" if event["step"] == "download" else "↑"
            self._describe(d)
        elif kind == "image":
            d = event["deployment_id"]
            (self.in_flight.get(d) or {}).pop(event["file_name"], None)
            self.done[d] += 1
            self.progress.advance(self.tasks[d])
            if event["status"] == "failed":
                self.failures.append(event)
            if self.verbose:
                self.progress.console.print(f"  {event['status']:9} {event['file_name']}" + (f" — {event['detail']}" if event.get("detail") else ""))
            self._describe(d)
            self._finish_if_done(d)
        elif kind == "done":
            self.totals = event


class ItemsView:
    """A stream of items under groups (subject sets, deployments…): a bar per
    group, advanced by each item's event, and the failures kept."""

    def __init__(self, progress: Progress, verbose: bool = False):
        self.progress = progress
        self.verbose = verbose
        self.tasks: dict = {}
        self.failures: list[dict] = []
        self.counts: dict[str, int] = {}
        self.result: dict | None = None

    def group(self, key, label: str, total: int | None) -> None:
        self.tasks[key] = self.progress.add_task(label, total=total)

    def item(self, key, status: str, event: dict, label: str) -> None:
        self.counts[status] = self.counts.get(status, 0) + 1
        if key in self.tasks:
            self.progress.advance(self.tasks[key])
        if status == "failed":
            self.failures.append(event)
        if self.verbose:
            self.progress.console.print(f"  {status:12} {label}" + (f" — {event['detail']}" if event.get("detail") else ""))
