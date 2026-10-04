from fastapi.testclient import TestClient


def test_health():
    from wildintel_zooniverse.web.main import app
    assert TestClient(app).get("/api/health").json() == {"status": "ok"}


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _releases(*tags, assets=(), prerelease=()):
    return [
        {"tag_name": tag, "html_url": f"https://github.com/x/releases/{tag}", "draft": False,
         "prerelease": tag in prerelease,
         "assets": [{"name": name, "browser_download_url": f"https://dl/{tag}/{name}"} for name in assets]}
        for tag in tags
    ]


def _check(monkeypatch, *, current="0.1.0", payload=None, error=None, system="Linux"):
    import httpx
    from wildintel_zooniverse.web.api.routers import health

    monkeypatch.setattr(health, "current_version", lambda: current)
    monkeypatch.setattr(health.platform, "system", lambda: system)

    async def fake_get(self, url, **kwargs):
        if error:
            raise error
        return _FakeResponse(payload)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    from wildintel_zooniverse.web.main import app
    return TestClient(app).get("/api/version/check").json()


def test_check_offers_the_newest_release_ignoring_the_dev_prerelease(monkeypatch):
    body = _check(monkeypatch, payload=_releases("v0.2.0", "v0.10.0", "dev", "v0.3.0", "v0.11.0", prerelease=("dev", "v0.11.0")))

    assert body["latest"] == "0.10.0" and body["update_available"] is True and body["error"] is None
    assert body["release_url"].endswith("v0.10.0")


def test_check_is_up_to_date_when_nothing_newer_exists(monkeypatch):
    body = _check(monkeypatch, current="0.3.0", payload=_releases("v0.3.0", "v0.2.0"))

    assert body["latest"] == "0.3.0" and body["update_available"] is False and body["error"] is None


def test_check_download_url_is_the_asset_for_this_os(monkeypatch):
    payload = _releases("v0.2.0", assets=["z-0.2.0-linux-x86_64.AppImage", "z-0.2.0-windows-x64.exe"])

    assert _check(monkeypatch, payload=payload, system="Windows")["download_url"].endswith("windows-x64.exe")
    assert _check(monkeypatch, payload=payload)["download_url"].endswith("linux-x86_64.AppImage")
    assert _check(monkeypatch, payload=payload, system="Darwin")["download_url"].endswith("v0.2.0")  # no dmg: release page


def test_check_reports_an_error_instead_of_pretending_to_be_up_to_date(monkeypatch):
    body = _check(monkeypatch, error=RuntimeError("offline"))

    assert body["update_available"] is False and "offline" in body["error"]


def test_check_skips_the_request_in_a_development_build(monkeypatch):
    body = _check(monkeypatch, current="dev", error=RuntimeError("must not be called"))

    assert body["error"] is None and body["update_available"] is False
