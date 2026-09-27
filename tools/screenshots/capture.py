"""The web manual's screenshots, taken from the built frontend with its
backend faked in the page (mock_api.js) — sample data only: no Trapper, no
Zooniverse, no real account.

    uv run wzcli docs screenshots        # builds the frontend first
    uv run python tools/screenshots/capture.py [NAME …]   # only these

Needs Playwright (the dev group) and Chrome/Chromium: the system's, if
found, else Playwright's own (`uv run playwright install chromium`).
Writes docs/img/screenshots/NAME.png."""
from __future__ import annotations

import functools
import http.server
import re
import shutil
import sys
import threading
from collections.abc import Callable
from pathlib import Path

from playwright.sync_api import Locator, Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "frontend" / "dist"
OUT = ROOT / "docs" / "img" / "screenshots"
MOCK = Path(__file__).with_name("mock_api.js")
VIEWPORT = {"width": 1100, "height": 800}

SHOTS: dict[str, Callable[[Page], None]] = {}


def shot(name: str):
    def register(fn: Callable[[Page], None]):
        SHOTS[name] = fn
        return fn
    return register


def _page_y(locator: Locator, edge: str) -> float:
    return locator.evaluate(f"e => e.getBoundingClientRect().{edge} + window.scrollY")


def save(page: Page, name: str, *, top: Locator | None = None, bottom: Locator | None = None) -> None:
    """The whole page — or, for a long one, from top's element to bottom's."""
    page.wait_for_timeout(300)
    path = OUT / f"{name}.png"
    if top is None and bottom is None:
        page.screenshot(path=path, full_page=True)
    else:
        y0 = max(0, _page_y(top, "top") - 24) if top else 0
        y1 = _page_y(bottom, "bottom") + 24 if bottom else page.evaluate("document.documentElement.scrollHeight")
        page.screenshot(path=path, full_page=True, clip={"x": 0, "y": y0, "width": VIEWPORT["width"], "height": y1 - y0})
    print(f"  {name}.png")


def heading(page: Page, text: str) -> Locator:
    """A step heading — its accessible name starts with the step's number."""
    return page.get_by_role("heading", name=re.compile(rf"^\d*\s*{re.escape(text)}$")).first


# ── Pages ─────────────────────────────────────────────────────────────────────

def start(page: Page) -> None:
    page.goto("/")


@shot("welcome")
def welcome(page: Page) -> None:
    start(page)
    expect(page.get_by_role("button", name="Get Started")).to_be_visible()
    save(page, "welcome")


@shot("unfinished-runs")
def unfinished_runs(page: Page) -> None:
    page.add_init_script("window.__mock.sessions = window.__mock.unfinished")
    page.goto("/")
    expect(page.get_by_text("Unfinished runs")).to_be_visible()
    save(page, "unfinished-runs")


def to_task(page: Page) -> None:
    start(page)
    page.get_by_role("button", name="Get Started").click()
    expect(page.get_by_text("What do you want to do?")).to_be_visible()


@shot("task")
def task(page: Page) -> None:
    to_task(page)
    save(page, "task")


def to_images(page: Page) -> None:
    to_task(page)
    page.get_by_text("Upload images to Zooniverse").click()
    page.get_by_text("Trapper Instance").click()
    page.get_by_role("button", name="Test Connection").click()
    expect(page.get_by_text("research project(s) available")).to_be_visible()
    page.get_by_label("Research project").select_option("2")
    page.get_by_label("Classification project").select_option("10")
    page.get_by_label("Collection").select_option("33")
    expect(page.get_by_label("R0033-DONA_0001_A")).to_be_visible()


@shot("step-images")
def step_images(page: Page) -> None:
    to_images(page)
    save(page, "step-images")


def to_filters(page: Page) -> None:
    to_images(page)
    page.get_by_role("button", name="Next").click()
    expect(page.get_by_text("Choose which images to upload")).to_be_visible()


@shot("step-filters")
def step_filters(page: Page) -> None:
    to_filters(page)
    page.get_by_role("button", name="Analyze sequences").click()
    expect(page.get_by_text("Total", exact=True)).to_be_visible()
    page.get_by_text("R0033-DONA_0001_A").last.click()
    save(page, "step-filters")


def to_zooniverse(page: Page) -> None:
    to_filters(page)
    page.get_by_role("button", name="Next").click()
    expect(page.get_by_text("Where to upload them")).to_be_visible()
    page.get_by_role("button", name="Test Connection").click()
    expect(page.get_by_text("Connected as field.team")).to_be_visible()
    page.get_by_label("Zooniverse project").select_option("30567")


@shot("step-zooniverse")
def step_zooniverse(page: Page) -> None:
    to_zooniverse(page)
    save(page, "step-zooniverse")


def to_upload(page: Page) -> None:
    to_zooniverse(page)
    page.get_by_role("button", name="Next").click()
    expect(page.get_by_role("heading", name="Upload to Zooniverse")).to_be_visible()


@shot("step-upload")
def step_upload(page: Page) -> None:
    to_upload(page)
    save(page, "step-upload")


@shot("upload-running")
def upload_running(page: Page) -> None:
    to_upload(page)
    page.get_by_role("button", name="Upload to Zooniverse").click()
    page.get_by_role("button", name="Yes, upload").click()
    expect(page.get_by_label("R0033-DONA_0007_B in progress")).to_be_visible()
    save(page, "upload-running")


@shot("settings")
def settings(page: Page) -> None:
    start(page)
    page.get_by_role("button", name="Settings").click()
    page.get_by_role("navigation", name="Settings sections").get_by_text("Trapper").click()
    save(page, "settings")


def pick_trapper(page: Page) -> None:
    """A Trapper selection form on the page: connect, and pick R0033."""
    page.get_by_role("button", name="Test Connection").last.click()
    expect(page.get_by_text("research project(s) available")).to_be_visible()
    page.get_by_label("Research project").select_option("2")
    page.get_by_label("Classification project").select_option("10")
    page.get_by_label("Collection", exact=True).select_option("33")
    expect(page.get_by_label("R0033-DONA_0001_A")).to_be_visible()


def connect_zooniverse(page: Page) -> None:
    page.get_by_role("button", name="Test Connection").first.click()
    expect(page.get_by_text("Connected as field.team")).to_be_visible()
    page.get_by_label("Zooniverse project").select_option("30567")


@shot("export")
def export(page: Page) -> None:
    to_task(page)
    page.get_by_text("Retrieve classifications").click()
    connect_zooniverse(page)
    page.get_by_label("Workflow", exact=True).select_option("29186")
    pick_trapper(page)
    page.get_by_role("button", name="Export CSV").click()
    expect(page.get_by_role("button", name="Import into Trapper")).to_be_visible()
    save(page, "export", top=heading(page, "Export"), bottom=page.get_by_role("button", name="Back", exact=True))


def to_util(page: Page, title: str) -> None:
    to_task(page)
    page.get_by_role("button", name="Utils").click()
    page.get_by_text(title, exact=True).click()


@shot("utils")
def utils(page: Page) -> None:
    to_task(page)
    page.get_by_role("button", name="Utils").click()
    save(page, "utils")


@shot("download-subject-sets")
def download_subject_sets(page: Page) -> None:
    to_util(page, "Download subject sets")
    connect_zooniverse(page)
    page.get_by_text("Pilot — autumn 2025").click()
    page.get_by_text("Doñana_2_R0031_31_2025-12").click()
    page.get_by_role("button", name="Download", exact=True).click()
    expect(page.get_by_label("Doñana_2_R0031_31_2025-12 in progress")).to_be_visible()
    save(page, "download-subject-sets", top=heading(page, "Download"), bottom=page.get_by_role("button", name="Back", exact=True))


@shot("validation")
def validation(page: Page) -> None:
    to_util(page, "Validation & audit")
    connect_zooniverse(page)
    page.get_by_label("Subject set", exact=True).select_option("134791")
    pick_trapper(page)
    page.get_by_role("button", name="Validate", exact=True).click()
    expect(page.get_by_role("button", name="Download report (JSON)")).to_be_visible()
    save(page, "validation", top=heading(page, "Validate"), bottom=page.get_by_role("button", name="Back", exact=True))


@shot("update-metadata")
def update_metadata(page: Page) -> None:
    to_util(page, "Update metadata")
    connect_zooniverse(page)
    page.get_by_label("Subject set", exact=True).select_option("134791")
    pick_trapper(page)
    page.get_by_role("button", name="Dry run", exact=True).click()
    expect(page.get_by_role("button", name="Download log (JSON)")).to_be_visible()
    save(page, "update-metadata", top=heading(page, "Update"), bottom=page.get_by_role("button", name="Back", exact=True))


@shot("subjects")
def subjects(page: Page) -> None:
    to_util(page, "Subjects")
    connect_zooniverse(page)
    page.get_by_label("Subject ids", exact=True).fill("98000004, 98000005\n98999999")
    page.get_by_role("button", name="Look up").click()
    page.get_by_text("Metadata (6 fields)").first.click()
    save(page, "subjects", top=heading(page, "Look up subjects by id"), bottom=page.get_by_role("button", name="Back", exact=True))


# ── Main ──────────────────────────────────────────────────────────────────────

def _browser(p):
    chrome = next((c for c in ("google-chrome", "chromium", "chromium-browser") if shutil.which(c)), None)
    return p.chromium.launch(executable_path=shutil.which(chrome) if chrome else None)


def main(names: list[str]) -> None:
    if not (DIST / "index.html").is_file():
        sys.exit("No frontend/dist — build the frontend first (cd frontend && npm run build).")
    unknown = set(names) - SHOTS.keys()
    if unknown:
        sys.exit(f"No such screenshot: {', '.join(sorted(unknown))}. Known: {', '.join(SHOTS)}")
    OUT.mkdir(parents=True, exist_ok=True)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

    handler = functools.partial(Handler, directory=str(DIST))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    failed: list[str] = []
    for stale in OUT.glob("_failed-*.png"):
        stale.unlink()
    with sync_playwright() as p:
        browser = _browser(p)
        for name in names or SHOTS:
            context = browser.new_context(base_url=base, viewport=VIEWPORT, color_scheme="dark", device_scale_factor=1,
                                          locale="en-GB", timezone_id="Europe/Madrid")
            context.add_init_script(path=str(MOCK))
            page = context.new_page()
            page.set_default_timeout(8000)
            page.on("console", lambda m: print(f"    [console] {m.text}") if m.type in ("warning", "error") else None)
            try:
                SHOTS[name](page)
            except Exception as exc:
                failed.append(name)
                page.screenshot(path=OUT / f"_failed-{name}.png", full_page=True)
                print(f"  ✘ {name}: {str(exc).splitlines()[0]}")
            context.close()
        browser.close()
    server.shutdown()
    if failed:
        sys.exit(f"Failed: {', '.join(failed)} — see docs/img/screenshots/_failed-*.png")


if __name__ == "__main__":
    main(sys.argv[1:])
